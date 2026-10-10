# Add free artwork to a design

Open **Assets** to find icons, colour stickers and hand-drawn illustrations. Search for a subject such as “flower”, “party” or “coffee”, choose a collection, then select the artwork to add it to your canvas.

For icons, choose **Icon colour before adding** first. Added artwork becomes a transparent image: move it, resize it, rotate it, crop it or arrange it in **Layers**. The longest side is at most 2,048 pixels. Use **Elements** or **Draw** when you want to edit individual shapes or draw your own lines.

Added images stay inside your saved design, including their licence notices. They don't depend on a link to the original artist's website. **Credits** shows the collection licences; **Download design asset credits** gives you a text copy to keep with artwork you share.

## Choose from three collections

| Collection | Artwork | Licence |
| --- | ---: | --- |
| [Tabler Icons](https://github.com/tabler/tabler-icons) by Paweł Kuna and contributors | 5,827 outline and filled icons | [MIT](../public/assets/licenses/tabler-MIT.txt) |
| [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) by Microsoft | 1,285 colour stickers | [MIT](../public/assets/licenses/fluent-MIT.txt) |
| [Open Doodles](https://www.opendoodles.com/) by Pablo Stanley | 33 hand-drawn illustrations | [CC0 1.0](../public/assets/licenses/doodles-CC0.txt) |

You can use these collections in personal and commercial designs. MIT requires its copyright and permission notices to stay with copies of the artwork. Stencil carries those notices in saved images and in PNG, JPG, SVG and PDF exports; it doesn't add a visible watermark. Keep the downloaded credits if another service strips image metadata or when sharing a video. Open Doodles needs no credit under [the creator's CC0 release](https://www.opendoodles.com/about).

Tabler brand icons are excluded. The library doesn't grant rights to use someone else's trademark or imply an artist or company endorses your design.

## Keep the download small

The library contains 7,145 original SVG files, about 8.7 MB of artwork. Its optional search list is about 2.3 MB, and the complete library with source records and licence text is about 11.8 MB. These figures come from the committed files, not an estimate of a download's compression.

The editor loads the library when you open **Assets** and shows a limited page of previews. It doesn't download all the artwork on startup. Source records are kept separately and aren't loaded by the asset browser. All artwork is served with Stencil itself: no stock service account, API key or request to the publishers is needed.

The original SVGs are in `public/assets/svg/`. The search list is `public/assets/catalogue.json`; the exact source paths and upstream pins are in `public/assets/provenance.json`. Neither the app's build nor the editor fetches new assets from upstream.

## Check the bundled files

Maintainers can check every image, catalogue entry and licence without making a network request:

```sh
python3 scripts/import-assets.py --verify
```

This needs Python 3.10 or newer, with no extra packages. A successful check prints `tabler: 5827`, `fluent: 1285` and `doodles: 33` in the JSON result, plus file sizes and catalogue hashes. A missing file, changed image, unsupported SVG or changed licence stops the check.

To rebuild this exact library from its pinned publishers:

```sh
python3 scripts/import-assets.py --import --cache-dir /tmp/stencil-assets-3.49.0
```

This command downloads files. It uses at most eight workers, verifies each upstream pin and writes the product files only after every collection passes. The optional cache lets a later attempt reuse already checked downloads. Normal builds don't run it.

The pins are [Tabler 3.49.0](https://github.com/tabler/tabler-icons/releases/tag/v3.49.0), Microsoft's [Fluent commit `1ffb34c`](https://github.com/microsoft/fluentui-emoji/commit/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc), and the 33 Open Doodles SVGs linked on 10 October 2026. Doodles has no official Git release, so its snapshot is pinned by each file's SHA256 and byte length.

Tabler includes both styles except files named `brand-*`. Fluent includes only `assets/<name>/Flat/<file>.svg`; nested skin variants, 3D images and other formats are left out to save space. The importer preserves the original SVG bytes and keeps useful publisher search tags. It removes duplicate tags already searchable through an item's name or subject.

## If an asset won't load

Choose **Try loading again**. If the file is still unavailable, keep your design open and try a different asset. Stencil checks downloaded artwork against its catalogue and refuses a changed or unsupported file rather than inserting it.

Library assets are kept as images once added. You can continue editing an existing design even when an unvisited part of the library isn't available offline.
