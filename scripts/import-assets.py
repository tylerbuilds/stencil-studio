#!/usr/bin/env python3
"""Verify Stencil's committed asset library, or rebuild it from pinned publishers.

Normal builds never run this importer or request an upstream asset service.
Python 3.10+ and its standard library are enough; no package installation is needed.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
import xml.etree.ElementTree as ET

PROJECT = Path(__file__).resolve().parents[1]
PUBLIC = PROJECT / "public"
OUTPUT = PUBLIC / "assets"
TABLER_VERSION = "3.49.0"
TABLER_COMMIT = "bbed884d15354b5cebf2493371f20dc2d5e83eaf"
TABLER_ARCHIVE = f"https://registry.npmjs.org/@tabler/icons/-/icons-{TABLER_VERSION}.tgz"
TABLER_INTEGRITY = "sha512-l+GnSkFETx0U26icxv1VUFnxxiTqXfCcVRiRAnyMwibupM2S2L/hSaZ9gmSgz01rkrsH/93NvLsxykqdanc6lw=="
FLUENT_COMMIT = "1ffb34c752ecf5d402f04cfb4b392c77f57c54bc"
DOODLES_BASE = "https://opendoodles.s3-us-west-1.amazonaws.com/"
SVG_NAMESPACE = "http://www.w3.org/2000/svg"
MAX_DOWNLOAD_BYTES = 25_000_000
MAX_SVG_BYTES = 256_000
EXPECTED_COUNTS = {"tabler": 5827, "fluent": 1285, "doodles": 33}
NOTICE_PINS = {
    "tabler": ("tabler-MIT.txt", "b740a1d46122672da62833e97f7e7c8a13fa85cbc7445b584b297cc00dde93db", 1073),
    "fluent": ("fluent-MIT.txt", "c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383", 1141),
    "doodles": ("doodles-CC0.txt", "a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499", 7048),
}

# Open Doodles has no official Git release. These are the original SVGs linked
# by the publisher on 10 October 2026, pinned by byte length and SHA256.
DOODLES_PINS = {
    "Doggie.svg": (75175, "902bc544f1edb1131c9a56dcbdb07a6a8c30427c70e3243a49164adf592c3f7b"),
    "ballet.svg": (57105, "9e9446cdad7b39b76dff2111a9b7352c8cb432b96ef93e92798902bcf0091d2d"),
    "bikini.svg": (48968, "c47f102612bcb3c8bd52f6e663457faab522a3acabf52fd937ec06b5414967a9"),
    "chilling.svg": (33432, "bd2d45ec903eb4ed3eb87109098a079ec63d021ed8ff8a3e9d057307e4ed5e04"),
    "clumsy.svg": (209597, "75ce995657fdd723be79059e129e05093d2b4cb537f4a817da301b034a870c70"),
    "coffee.svg": (43758, "b3d514f21436095dcb0a82673f43d347b428515c141acbaf47f98d2142ad69d6"),
    "dancing.svg": (104088, "595e589dfd0927cb3cf71174543c05a940ca3743dd99a3dcdd1f3cb757168edf"),
    "dog-jump.svg": (65226, "e523b5af8328bc18e9ca6216ab0102b115bd955c3f46527da61428a0cdf6158d"),
    "float.svg": (98410, "e4d4f06ffc6b2795a69f2e5b1e12cd9425f517705ba29c053999829b9897d587"),
    "groovy.svg": (41345, "12c591694ce270e464ebe99b61b5d0a638326b13c47876aba39eeb716258792d"),
    "ice-cream.svg": (43056, "3a0d637d9e17b8e7d212f6d0c4586d0b62da5cd90610f598bee39967866f2820"),
    "jumping.svg": (37037, "3e92d083e118f3ea00c852a0e718a0549708685da44dabf2472a9411013c9a39"),
    "laying.svg": (30526, "1d6d130d58a185b55adbe6464fc926cf3ebe60375b3d0ff37059f8a14eae53fc"),
    "levitate.svg": (25476, "c5f7a30e08fa3bde8c8d346ef3e957cc0d7f9f2f9541cbfa5ff8011941fc78d6"),
    "loving.svg": (21041, "ec2530045eace13aa9d9f10ffc091cab561233ec57564f04f045e6ec53bbd62a"),
    "meditating.svg": (79925, "fbd94062293864a062428c2d7ba1fb5eb4c6b01681c27ff5e27220368a1ea74d"),
    "moshing.svg": (55555, "d391bbe1c7499fa8a5b31d6d18f6b5d66ce8a9560c344bac9533ca76dac33179"),
    "petting.svg": (100896, "39fa8760f02e5db4858d2daff5ee09ba2a39b4e6804b8c829c8cd3525b1ddb83"),
    "plant.svg": (200522, "9ba5faae5233f4fac4e9dc120b68ee4855a49757180910729ccb5227961aa91b"),
    "reading-side.svg": (60495, "bc98d93429c03fe206050649841d0cecab51c928fcb6f7e842ff4af6a5585593"),
    "reading.svg": (86780, "902934889ec6599d4820d3ff7d47f7a6a1d0cbe01362f60f6548c2d1b1894550"),
    "roller-skating.svg": (56374, "0aa5aae7151041845d881e91770dfa677474749d10324f596b245f785919e8ed"),
    "rolling.svg": (44154, "b72df1f609039586c5c2490de3deae24d09533cc1cb53c222f38cb6f9d0156bd"),
    "running.svg": (35896, "316d030f281cfd434ddcf115bea04ec3a9f176298f6e8f488307d6c40d02c3e7"),
    "selfie.svg": (51263, "54865e02673b21f88e4ff1ad60d3eeb4e67c137ec586ee57d02bb7b0ce94ddc9"),
    "sitting-reading.svg": (80309, "957f2c9047d12fed332378f307609990934403b4e2421f49d027d6793faa81d5"),
    "sitting.svg": (54781, "6245f1c3b2b2a9ce37ec7a6e58c8e3ccd0d2dc3445116a9329c3fdd47062d062"),
    "sleek.svg": (55431, "d0cf2e8b1319e1621ea10c68869cebc2db8b089355b72478ea7f8345b7f0dc5a"),
    "sprinting.svg": (42228, "de4c130718c40ec50599361df3ba3db12e1d199dc8d26302f95c8b2cf03e5af0"),
    "strolling.svg": (49510, "b8e031d834dc3106969d8a6dbf74e47c487bab39e97c4ff600d270c98230909e"),
    "swinging.svg": (168397, "adf4d5a57b937d61ba7b31e16d8a88984abee2a8ba9e4b47613d34c879932303"),
    "unboxing.svg": (86742, "2baafd8c17ef5046318397bb5f08f25f6e613e7e56553c5741362cca87d33586"),
    "zombieing.svg": (42383, "d2c516a46dacba43900f7a2ea027001dcca5da7b6030ee048f1e93cb175cad15"),
}

ALLOWED_ELEMENTS = {
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "title", "desc",
}
ALLOWED_ATTRIBUTES = {
    "width", "height", "viewBox", "version", "class", "id", "d", "x", "y", "x1", "x2", "y1", "y2",
    "cx", "cy", "r", "rx", "ry", "points", "fill", "fill-rule", "fill-opacity", "stroke",
    "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
    "stroke-dashoffset", "stroke-opacity", "opacity", "transform", "clip-path", "clip-rule", "mask",
    "maskUnits", "maskContentUnits", "gradientUnits", "gradientTransform", "spreadMethod",
    "offset", "stop-color", "stop-opacity", "preserveAspectRatio",
}
RECOMMENDED = [
    "tabler-outline-heart", "tabler-outline-star", "tabler-outline-sparkles", "tabler-outline-flower",
    "tabler-outline-leaf", "tabler-outline-sun", "tabler-outline-arrow-right", "tabler-outline-circle-check",
    "tabler-filled-heart", "tabler-filled-star", "tabler-outline-music", "tabler-outline-camera",
    "fluent-party-popper", "fluent-sunflower", "fluent-red-heart", "fluent-dog-face", "fluent-sparkles",
    "fluent-smiling-face-with-heart-eyes", "fluent-rocket", "fluent-rainbow", "fluent-birthday-cake",
    "doodles-coffee", "doodles-plant", "doodles-reading", "doodles-doggie", "doodles-loving",
]


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def verify_blob(body: bytes, entry: dict) -> None:
    digest = hashlib.sha1(f"blob {len(body)}\0".encode() + body).hexdigest()
    if len(body) != entry["size"] or digest != entry["sha"]:
        raise ValueError(f"Upstream Git blob does not match its pin: {entry['path']}")


class Downloader:
    def __init__(self, cache: Path):
        self.cache = cache
        self.cache.mkdir(parents=True, exist_ok=True)
        self.bytes_downloaded = 0
        self.request_count = 0
        self.lock = threading.Lock()

    def fetch(self, url: str, limit: int = MAX_SVG_BYTES, check=None) -> bytes:
        target = self.cache / (sha256(url.encode()) + ".bin")
        if target.is_file():
            body = target.read_bytes()
            if len(body) > limit:
                raise ValueError(f"Cached download exceeds its size limit: {url}")
            if check:
                check(body)
            return body
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "StencilStudio-pinned-asset-importer/1"})
                with urllib.request.urlopen(request, timeout=35) as response:
                    body = response.read(limit + 1)
                if len(body) > limit:
                    raise ValueError(f"Upstream download exceeds its size limit: {url}")
                if check:
                    check(body)
                with self.lock:
                    self.bytes_downloaded += len(body)
                    self.request_count += 1
                    if self.bytes_downloaded > MAX_DOWNLOAD_BYTES:
                        raise ValueError("Import exceeded its 25 MB network budget")
                write_atomic(target, body)
                return body
            except urllib.error.HTTPError as error:
                if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                    raise
            except (TimeoutError, urllib.error.URLError):
                if attempt == 2:
                    raise
            time.sleep(attempt + 1)
        raise RuntimeError(f"Could not download {url}")


def write_atomic(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.read_bytes() == body:
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".asset-import-", delete=False) as temporary:
        temporary.write(body)
        temporary_name = temporary.name
    os.replace(temporary_name, path)


def safe_name(name: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not result or len(result) > 120:
        raise ValueError(f"Unsafe or overlong asset identifier: {name}")
    return result


def title(name: str) -> str:
    words = name.replace("-", " ").replace("_", " ")
    return words[:1].upper() + words[1:]


def fold_search(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(character for character in value if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def validate_svg(body: bytes, source: str, inventory: dict) -> None:
    if len(body) > MAX_SVG_BYTES or re.search(br"<!\s*(DOCTYPE|ENTITY)\b", body, re.I):
        raise ValueError(f"Unsafe XML or oversized SVG: {source}")
    root = ET.fromstring(body)
    if root.tag != f"{{{SVG_NAMESPACE}}}svg":
        raise ValueError(f"File is not an SVG: {source}")
    for element in root.iter():
        if not element.tag.startswith("{" + SVG_NAMESPACE + "}"):
            raise ValueError(f"Unexpected XML namespace in {source}: {element.tag}")
        tag = element.tag.split("}", 1)[1]
        if tag not in ALLOWED_ELEMENTS:
            raise ValueError(f"Unsupported SVG element in {source}: {tag}")
        inventory["elements"].add(tag)
        for attribute, value in element.attrib.items():
            if attribute not in ALLOWED_ATTRIBUTES:
                raise ValueError(f"Unsupported SVG attribute in {source}: {attribute}")
            inventory["attributes"].add(attribute)
            if re.search(r"(?:https?:|javascript:|data:|//)", value, re.I):
                raise ValueError(f"External or executable SVG attribute in {source}: {attribute}")
            if "url(" in value and not re.fullmatch(r"url\(#[a-zA-Z0-9_.:-]+\)", value):
                raise ValueError(f"Non-local SVG reference in {source}: {attribute}")
    dimensions = root.attrib.get("viewBox", "").split()
    if len(dimensions) != 4 or not all(re.fullmatch(r"-?(?:\d+(?:\.\d*)?|\.\d+)", part) for part in dimensions):
        raise ValueError(f"Invalid SVG viewBox in {source}")
    if float(dimensions[2]) <= 0 or float(dimensions[3]) <= 0:
        raise ValueError(f"Non-positive SVG viewBox in {source}")


def asset(collection: str, key: str, name: str, category: str, tags: list[str], source_path: str, body: bytes) -> dict:
    # Tabler encodes some useful aliases as integers (911, 360, 420). Keep
    # them searchable as strings; JSON null and other values are not keywords.
    tags = list(dict.fromkeys(str(tag).strip().lower() for tag in tags
                             if (isinstance(tag, str) or type(tag) is int) and str(tag).strip()))
    if len(tags) > 40 or any(len(tag) > 80 for tag in tags):
        raise ValueError(f"Unexpected publisher search metadata: {source_path}")
    # Search already scans names and categories. Removing duplicate keywords
    # keeps every word searchable while reducing the optional mobile download.
    label = fold_search(f"{name} {category}")
    tags = [tag for tag in tags if not all(word in label for word in fold_search(tag).split())]
    return {
        "id": f"{collection}-{key}", "name": name, "collection": collection,
        "category": category, "tags": tags, "path": f"assets/svg/{collection}/{key}.svg",
        "sha256": sha256(body), "bytes": len(body), "sourcePath": source_path,
    }


def collect_tabler(downloader: Downloader) -> tuple[list[tuple[dict, bytes]], bytes]:
    def check_archive(body):
        integrity = "sha512-" + base64.b64encode(hashlib.sha512(body).digest()).decode()
        if integrity != TABLER_INTEGRITY:
            raise ValueError("Tabler package does not match its pinned npm integrity")
    body = downloader.fetch(TABLER_ARCHIVE, 2_000_000, check_archive)
    result = []
    with tarfile.open(fileobj=io.BytesIO(body), mode="r:gz") as archive:
        metadata = json.load(archive.extractfile("package/icons.json"))
        licence = archive.extractfile("package/LICENSE").read()
        for entry in archive.getmembers():
            path = entry.name.removeprefix("package/")
            if not re.fullmatch(r"icons/(outline|filled)/[a-z0-9-]+\.svg", path):
                continue
            if not entry.isfile():
                raise ValueError(f"Unexpected non-file SVG in Tabler package: {path}")
            style, filename = path.split("/")[1:]
            name = filename.removesuffix(".svg")
            if name.startswith("brand-"):
                continue
            svg = archive.extractfile(entry).read()
            info = metadata[name]
            key = f"{style}-{name}"
            displayed_name = title(name) + (" (filled)" if style == "filled" else "")
            result.append((asset("tabler", key, displayed_name, info["category"], info["tags"] + [style], path, svg), svg))
    if len(result) != EXPECTED_COUNTS["tabler"]:
        raise ValueError("Tabler package no longer has the approved asset count")
    return result, licence


def collect_fluent(downloader: Downloader, workers: int) -> tuple[list[tuple[dict, bytes]], bytes]:
    tree_url = f"https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/{FLUENT_COMMIT}?recursive=1"
    tree = json.loads(downloader.fetch(tree_url, 9_000_000))
    if tree.get("truncated") is not False:
        raise ValueError("Fluent source tree is truncated")
    by_path = {entry["path"]: entry for entry in tree["tree"]}
    selected = [entry for entry in tree["tree"] if entry["type"] == "blob" and
                len(entry["path"].split("/")) == 4 and entry["path"].split("/")[0] == "assets" and
                entry["path"].split("/")[2] == "Flat" and entry["path"].endswith(".svg")]
    if len(selected) != EXPECTED_COUNTS["fluent"]:
        raise ValueError("Fluent source tree no longer has the approved asset count")
    raw_base = f"https://raw.githubusercontent.com/microsoft/fluentui-emoji/{FLUENT_COMMIT}/"

    def collect(entry):
        path = entry["path"]
        svg = downloader.fetch(raw_base + urllib.parse.quote(path, safe="/"), check=lambda b: verify_blob(b, entry))
        metadata_path = "/".join(path.split("/")[:2]) + "/metadata.json"
        metadata_entry = by_path[metadata_path]
        metadata_body = downloader.fetch(raw_base + urllib.parse.quote(metadata_path, safe="/"), 16_000,
                                         check=lambda b: verify_blob(b, metadata_entry))
        metadata = json.loads(metadata_body)
        name = metadata["cldr"]
        # Original filenames are unique and stable even when publisher labels
        # share a name. Removing the format suffix produces short useful ids.
        key = safe_name(Path(path).stem.removesuffix("_flat"))
        record = asset("fluent", key, title(name), metadata["group"], metadata["keywords"], path, svg)
        record["sourceGitBlob"] = entry["sha"]
        record["metadataGitBlob"] = metadata_entry["sha"]
        return record, svg

    result = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(collect, entry) for entry in selected]
        for future in concurrent.futures.as_completed(futures):
            result.append(future.result())
            if len(result) % 100 == 0 or len(result) == len(selected):
                print(f"Fluent SVGs and metadata checked: {len(result)}/{len(selected)}", flush=True)
    licence = downloader.fetch(raw_base + "LICENSE", 4_000,
                              check=lambda b: verify_blob(b, by_path["LICENSE"]))
    return result, licence


def collect_doodles(downloader: Downloader, workers: int) -> tuple[list[tuple[dict, bytes]], bytes]:
    def collect(filename):
        expected_bytes, expected_sha = DOODLES_PINS[filename]
        def check(body):
            if len(body) != expected_bytes or sha256(body) != expected_sha:
                raise ValueError(f"Open Doodles changed since its approved snapshot: {filename}")
        body = downloader.fetch(DOODLES_BASE + filename, check=check)
        key = safe_name(filename.removesuffix(".svg"))
        return asset("doodles", key, title(key), "People", [key.replace("-", " "), "person", "sketch", "doodle"], filename, body), body
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        result = list(pool.map(collect, sorted(DOODLES_PINS)))
    licence = downloader.fetch("https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt", 10_000)
    return result, licence


def collections() -> list[dict]:
    result = [
        {"id": "tabler", "name": "Tabler Icons", "kind": "icon", "license": "MIT",
         "source": "https://github.com/tabler/tabler-icons", "revision": TABLER_VERSION},
        {"id": "fluent", "name": "Fluent Emoji", "kind": "sticker", "license": "MIT",
         "source": "https://github.com/microsoft/fluentui-emoji", "revision": FLUENT_COMMIT},
        {"id": "doodles", "name": "Open Doodles", "kind": "illustration", "license": "CC0-1.0",
         "source": "https://www.opendoodles.com", "revision": "official-svg-snapshot-2026-10-10"},
    ]
    for collection in result:
        filename, digest, length = NOTICE_PINS[collection["id"]]
        collection.update({"noticePath": f"assets/licenses/{filename}", "noticeSha256": digest, "noticeBytes": length})
    return result


def provenance_sources() -> list[dict]:
    return [
        {"id": "tabler", "type": "official-npm-publication", "version": TABLER_VERSION,
         "release": f"https://github.com/tabler/tabler-icons/releases/tag/v{TABLER_VERSION}",
         "commit": TABLER_COMMIT, "archive": TABLER_ARCHIVE, "archiveIntegrity": TABLER_INTEGRITY,
         "licenseURL": f"https://raw.githubusercontent.com/tabler/tabler-icons/{TABLER_COMMIT}/LICENSE",
         "copyright": "Copyright (c) 2020-2026 Paweł Kuna",
         "selection": "All icons/outline and icons/filled SVGs except filenames beginning brand-.",
         "note": "Official package SVGs include generated class/canvas metadata; their bytes differ from Git source SVGs."},
        {"id": "fluent", "type": "pinned-git-files", "commit": FLUENT_COMMIT,
         "sourceBase": f"https://raw.githubusercontent.com/microsoft/fluentui-emoji/{FLUENT_COMMIT}/",
         "licenseURL": f"https://raw.githubusercontent.com/microsoft/fluentui-emoji/{FLUENT_COMMIT}/LICENSE",
         "copyright": "Copyright (c) Microsoft Corporation.",
         "selection": "Exactly assets/<name>/Flat/<file>.svg; no nested skin variants, High Contrast, Color or 3D files."},
        {"id": "doodles", "type": "dated-publisher-snapshot", "date": "2026-10-10", "author": "Pablo Stanley",
         "sourceBase": DOODLES_BASE, "collectionURL": "https://www.opendoodles.com/",
         "licenseEvidence": "https://www.opendoodles.com/about",
         "creatorEvidence": "https://www.pablostanley.com/work/open-doodles",
         "licenseURL": "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt",
         "selection": "All 33 SVGs linked by the official collection page on the snapshot date."},
    ]


def import_library(cache: Path, workers: int) -> dict:
    downloader = Downloader(cache)
    gathered = {}
    print("Checking the pinned Tabler package", flush=True)
    gathered["tabler"] = collect_tabler(downloader)
    print("Fetching only the approved Fluent flat SVGs and their metadata", flush=True)
    gathered["fluent"] = collect_fluent(downloader, workers)
    print("Checking the pinned Open Doodles snapshot", flush=True)
    gathered["doodles"] = collect_doodles(downloader, workers)
    assets = []
    bodies = {}
    svg_inventory = {key: {"elements": set(), "attributes": set()} for key in EXPECTED_COUNTS}
    for collection_id, (items, notice) in gathered.items():
        filename, expected_sha, expected_bytes = NOTICE_PINS[collection_id]
        if len(notice) != expected_bytes or sha256(notice) != expected_sha:
            raise ValueError(f"Publisher notice does not match its approved pin: {collection_id}")
        for entry, body in items:
            validate_svg(body, entry["sourcePath"], svg_inventory[collection_id])
            if entry["id"] in bodies:
                raise ValueError(f"Duplicate asset id: {entry['id']}")
            assets.append(entry)
            bodies[entry["id"]] = body
    recommendations = {key: position for position, key in enumerate(RECOMMENDED)}
    assets.sort(key=lambda entry: (recommendations.get(entry["id"], len(recommendations)), entry["name"].casefold(), entry["id"]))
    runtime_fields = {"id", "name", "collection", "category", "tags", "path", "sha256", "bytes"}
    runtime_assets = [{key: value for key, value in entry.items() if key in runtime_fields} for entry in assets]
    catalogue = {"version": 1, "collections": collections(), "assets": runtime_assets}
    catalogue_body = (json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    provenance_assets = []
    for entry in assets:
        record = {"id": entry["id"], "sourcePath": entry["sourcePath"]}
        if entry["collection"] == "fluent":
            record.update({"gitBlob": entry["sourceGitBlob"], "metadataGitBlob": entry["metadataGitBlob"]})
        if entry["collection"] == "doodles":
            record.update({"snapshotSha256": entry["sha256"], "snapshotBytes": entry["bytes"]})
        provenance_assets.append(record)
    provenance = {"version": 1, "catalogueSha256": sha256(catalogue_body), "originalSvgBytesUnmodified": True,
                  "sources": provenance_sources(), "assets": provenance_assets}
    # All remote downloads and checks finish before changing product files.
    for entry in assets:
        write_atomic(PUBLIC / entry["path"], bodies[entry["id"]])
    for collection_id, (_, notice) in gathered.items():
        write_atomic(OUTPUT / "licenses" / NOTICE_PINS[collection_id][0], notice)
    write_atomic(OUTPUT / "catalogue.json", catalogue_body)
    write_atomic(OUTPUT / "provenance.json", (json.dumps(provenance, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    result = verify_library()
    result["network"] = {"requests": downloader.request_count, "downloadedBytes": downloader.bytes_downloaded}
    return result


def verify_library() -> dict:
    catalogue_body = (OUTPUT / "catalogue.json").read_bytes()
    catalogue = json.loads(catalogue_body)
    if catalogue.get("version") != 1 or catalogue.get("collections") != collections():
        raise ValueError("Catalogue collection metadata does not match the approved pins")
    collection_counts = {key: 0 for key in EXPECTED_COUNTS}
    collection_bytes = {key: 0 for key in EXPECTED_COUNTS}
    inventory = {key: {"elements": set(), "attributes": set()} for key in EXPECTED_COUNTS}
    seen_ids, seen_paths = set(), set()
    for entry in catalogue["assets"]:
        collection = entry["collection"]
        key = entry["id"].removeprefix(collection + "-")
        path = entry["path"]
        if collection not in EXPECTED_COUNTS or entry["id"] != collection + "-" + key or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key):
            raise ValueError("Unexpected asset identifier or collection")
        if path != f"assets/svg/{collection}/{key}.svg" or entry["id"] in seen_ids or path in seen_paths:
            raise ValueError("Unexpected or duplicate asset path")
        seen_ids.add(entry["id"])
        seen_paths.add(path)
        body = (PUBLIC / path).read_bytes()
        if len(body) != entry["bytes"] or sha256(body) != entry["sha256"]:
            raise ValueError(f"Committed asset does not match its catalogue pin: {path}")
        validate_svg(body, path, inventory[collection])
        collection_counts[collection] += 1
        collection_bytes[collection] += len(body)
    if collection_counts != EXPECTED_COUNTS:
        raise ValueError(f"Unexpected asset counts: {collection_counts}")
    actual_paths = {str(path.relative_to(PUBLIC)) for path in (OUTPUT / "svg").rglob("*") if path.is_file()}
    if actual_paths != seen_paths:
        raise ValueError("The committed asset tree contains extra or missing files")
    for collection, (filename, digest, length) in NOTICE_PINS.items():
        notice = (OUTPUT / "licenses" / filename).read_bytes()
        if len(notice) != length or sha256(notice) != digest:
            raise ValueError(f"Committed licence notice does not match its pin: {collection}")
    provenance_body = (OUTPUT / "provenance.json").read_bytes()
    provenance = json.loads(provenance_body)
    if (provenance.get("version") != 1 or provenance.get("catalogueSha256") != sha256(catalogue_body) or
            provenance.get("sources") != provenance_sources() or provenance.get("originalSvgBytesUnmodified") is not True):
        raise ValueError("The source provenance does not match this catalogue")
    if len(provenance["assets"]) != len(seen_ids) or {entry["id"] for entry in provenance["assets"]} != seen_ids:
        raise ValueError("The source provenance has duplicate or missing asset identifiers")
    for record in provenance["assets"]:
        if record["id"].startswith("doodles-"):
            if DOODLES_PINS.get(record["sourcePath"]) != (record["snapshotBytes"], record["snapshotSha256"]):
                raise ValueError("Open Doodles source provenance no longer matches its approved snapshot")
    all_files = [path for path in OUTPUT.rglob("*") if path.is_file()]
    return {"version": 1, "counts": collection_counts, "svgBytes": collection_bytes,
            "totalSvgBytes": sum(collection_bytes.values()), "catalogueBytes": len(catalogue_body),
            "catalogueSha256": sha256(catalogue_body), "provenanceBytes": len(provenance_body),
            "provenanceSha256": sha256(provenance_body), "totalShippedBytes": sum(path.stat().st_size for path in all_files),
            "totalShippedFiles": len(all_files), "licencePins": collections(),
            "svgInventory": {key: {kind: sorted(values) for kind, values in entry.items()} for key, entry in inventory.items()}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--verify", action="store_true", help="check committed files without making any network requests (default)")
    action.add_argument("--import", dest="do_import", action="store_true", help="fetch the fixed approved publishers and write the asset library")
    parser.add_argument("--cache-dir", type=Path, help="optional download cache outside the tracked project")
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=6, metavar="1..8")
    parser.add_argument("--receipt", type=Path, help="write the verification result as JSON to this path")
    arguments = parser.parse_args()
    if arguments.do_import:
        if arguments.cache_dir:
            result = import_library(arguments.cache_dir, arguments.workers)
        else:
            with tempfile.TemporaryDirectory(prefix="stencil-asset-import-") as temporary:
                result = import_library(Path(temporary), arguments.workers)
    else:
        result = verify_library()
    if arguments.receipt:
        write_atomic(arguments.receipt, (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode())
    print(json.dumps({key: value for key, value in result.items() if key not in {"svgInventory", "licencePins"}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
