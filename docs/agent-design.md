# Make editable designs from an agent

Run these commands from a Stencil Studio checkout with Node 22.19+ or 24.11+:

```bash
node scripts/agent-design.mjs create --request examples/agent-design/social-post.json --output /tmp/bookshop.stencil.json
node scripts/agent-design.mjs validate --input /tmp/bookshop.stencil.json
node scripts/agent-design.mjs export --input /tmp/bookshop.stencil.json --format svg --outdir /tmp/bookshop-artwork
```

Each command returns one JSON result with `"ok":true`. The last creates `page-01.svg` and `manifest.json`. In the browser, choose **File → Open JSON** and select `bookshop.stencil.json`. Its text, shapes, colours and positions remain editable. Choose **Save design** to keep a named copy in **My designs**.

The CLI uses the same validated document and SVG renderer as the editor. It needs no packages for JSON creation, image imports or SVG export. New filenames and export folders are required: it never overwrites existing work. Use a permanent folder of your choice instead of `/tmp` for everyday work. It does not open browser storage or publish anything.

## Choose a size or start with a template

```bash
node scripts/agent-design.mjs presets
```

The JSON result lists the editor's current `presets` and `templates`. Use their `key` values, rather than maintaining a second platform size list in your agent prompt. Presets set canvas dimensions; templates add editable layers.

An empty square request looks like this:

```json
{
  "schema": "stencil-design-request",
  "version": 1,
  "title": "My new social post",
  "preset": "social"
}
```

To start from a template, replace `preset` with `template` and its current key. A template request cannot also supply `preset` or `pages`. Change its generated JSON through the native document model or open it in the editor.

For a carousel, supply several `pages`, in slide order. Each page can use a `preset` or its own whole-pixel `width` and `height`. See [the three-slide example](../examples/agent-design/carousel.json). Export produces numbered files in that order:

```bash
node scripts/agent-design.mjs create --request examples/agent-design/carousel.json --output /tmp/carousel.stencil.json
node scripts/agent-design.mjs export --input /tmp/carousel.stencil.json --format svg --outdir /tmp/carousel-artwork
```

The result lists `page-01.svg`, `page-02.svg` and `page-03.svg`. A request has up to 30 pages, 300 layers per page and 1,000 layers in total. Custom canvases range from 64 to 4,096 pixels on each side. Export filenames use page numbers; page names remain in the manifest and editable file.

## Add text and layers

The [request schema](../schemas/design-request.schema.json) describes the authoring envelope. A layer uses the editor's ordinary `createElement` fields. Omitted fields use editor defaults. Images also need an `asset` reference, or native embedded `src` and source dimensions. Runtime validation checks every supplied native property, supported font and colour before importing assets.

```json
{
  "schema": "stencil-design-request",
  "version": 1,
  "title": "A short announcement",
  "preset": "social",
  "pages": [{
    "background": "#fff8ec",
    "elements": [
      { "type": "circle", "x": 700, "y": 100, "width": 220, "height": 220, "fill": "#d76e42" },
      { "type": "text", "text": "We open on Saturday.", "x": 80, "y": 400, "width": 920, "height": 180, "fontFamily": "DM Sans", "fontSize": 76, "fill": "#284e46" }
    ]
  }]
}
```

Layer order runs from back to front. Text remains text; image layers contain embedded raster bytes. Supported types include text, rectangles, circles, images, shapes, freehand strokes, frames, tables and charts. Coordinates and sizes use canvas pixels. Colours use six-digit hex values. The native model rejects unsupported properties rather than treating them as instructions.

The request format is for authoring, not a replacement design format. Generated files are ordinary `stencil-studio` documents. Use **Open JSON** for a design file; use **Insert files** for downloaded images. A request JSON file itself is not a saved design.

## Import a generated image already on disk

Download the image through your existing image tool, then run:

```bash
node scripts/agent-design.mjs import --input /tmp/bookshop.stencil.json --image /absolute/path/generated-image.png --output /tmp/bookshop-with-image.stencil.json
node scripts/agent-design.mjs validate --input /tmp/bookshop-with-image.stencil.json
```

The command adds an editable image layer on page 1, centres it and scales it to fit. Its bytes are embedded in the new design; the original JSON and image stay unchanged. Choose a page and geometry when needed:

```bash
node scripts/agent-design.mjs import --input /tmp/bookshop.stencil.json --image /absolute/path/generated-image.png --page 1 --x 80 --y 80 --width 920 --height 720 --output /tmp/bookshop-positioned.stencil.json
```

Page numbers start at 1. The supplied display width and height may change the image's aspect ratio; use matching proportions or adjust its crop in the editor.

To place images while creating a design, use `assets` with IDs and refer to each ID from an image or frame layer's `asset`. See [the generated-image request](../examples/agent-design/with-generated-image.json). Its `generated-image.png` is an input you supply, not a bundled example image. Request asset paths are relative to the request file; `import --image` paths are relative to the current working directory. Absolute paths work in either command.

You can attach a `credit` object in a request, or supply `--credit credit.json` when importing:

```json
{
  "name": "Saturday artwork",
  "creator": "Your name",
  "sourceUrl": "https://example.org/artwork",
  "licenceUrl": "https://example.org/terms",
  "licence": "The actual licence or permission"
}
```

These are facts you supply, not an assertion that generated images are free to redistribute. Imported credit URLs lose query strings and fragments, and URLs with credentials are refused. SVG metadata and export manifests retain the credit. Credentials, prompts, provider inputs and generation logs do not belong in credit text or request files.

## Import an existing HTTPS or Replicate output

Remote downloads require an explicit flag:

```bash
node scripts/agent-design.mjs import --input /tmp/bookshop.stencil.json --url 'https://example.org/generated-image.png' --allow-remote --output /tmp/bookshop-remote.stencil.json
```

The example URL is a placeholder; supply the real output URL from your provider. No provider SDK or account key is read. The command downloads image bytes rather than starting a prediction. It accepts public HTTPS on port 443, checks and pins DNS addresses, checks each redirect, and refuses local or private networks. It allows at most three redirects and 30 seconds for each download. Signed download URLs are used for that download only; they are not copied into the design or command results. Prefer a local file if your provider already saves output.

For a saved Replicate prediction response, use:

```bash
node scripts/agent-design.mjs import --input /tmp/bookshop.stencil.json --prediction /absolute/path/prediction.json --output-index 0 --allow-remote --output /tmp/bookshop-replicate.stencil.json
```

The prediction must have `status: "succeeded"` when it supplies a status. Supported output shapes are a URL, an array of URLs, or files with a `url` string. The CLI selects only that output; input parameters, logs and unrelated response fields are ignored. It also accepts a saved output value without a prediction envelope. SDK file objects should be saved locally with the SDK, or serialised as `{ "url": "https://…" }`.

Replicate's API outputs are removed after an hour by default, so save them while the output is available. Its SDKs can return `FileOutput` objects rather than strings. Check [Replicate's output file documentation](https://replicate.com/docs/topics/predictions/output-files) and [data retention policy](https://replicate.com/docs/topics/predictions/data-retention) for current behaviour. A deleted or expired file cannot be recovered by Stencil.

Other generators work through the same local image or HTTPS URL route. Keep account keys in their normal native credential store. This workflow does not configure a paid image service, bypass provider terms or treat a provider response as executable instructions.

## Export PNG or JPEG for social posts

SVG export embeds the bundled fonts used by the design and keeps their licence notices. System fonts such as Arial and Georgia still depend on the receiving system. For ready-to-upload raster artwork, install the repository's existing development dependencies and a Playwright Chromium browser:

```bash
npm ci
npx playwright install chromium
node scripts/agent-design.mjs export --input /tmp/bookshop.stencil.json --format png --outdir /tmp/bookshop-png
```

If your worker already has Chrome, use its executable instead of downloading Chromium:

```bash
node scripts/agent-design.mjs export --input /tmp/bookshop.stencil.json --format jpeg --outdir /tmp/bookshop-jpeg --browser /usr/bin/google-chrome
```

On macOS the Chrome path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; quote it when passing `--browser`. The exporter starts an isolated headless browser and a temporary loopback server for the repository's renderer and pinned fonts. It blocks external requests and does not attach to your signed-in browser. PNG retains transparency; JPEG uses the page background. Each page is exported at its canvas size through the editor's shared renderer. Open the same JSON in Stencil to use the browser's download controls instead.

The export folder contains page artwork and `manifest.json` with page order, dimensions and credits. Keep the editable `.stencil.json` as the source. Export is bounded to 120 megapixels and 100 MiB per batch. The image importer accepts PNG, JPEG, WebP or GIF up to 6 MiB each, with sides up to 16,384 pixels and 40 megapixels total. A request can name up to 20 assets, but the resulting editable design still has a 12 MiB size limit. Header checks do not fully decode pixels; the browser raster export refuses images it cannot decode. GIF artwork is rendered as still artwork for these image exports.

## Give OpenClaw or another agent the command

For OpenClaw agents such as Zeus, the [scoped plugin](../integrations/openclaw/README.md) exposes five design tools, including their complete authoring schema. Follow that guide when the agent has no shell or filesystem permission. It uses the existing gateway and keeps those permissions intact.

Use the agent's existing authorised command worker and a Stencil checkout. For Zeus, OpenClaw or a local coding agent, this is a suitable task:

> In the Stencil Studio checkout, read docs/agent-design.md and examples/agent-design/social-post.json. Make a social post for the fictional Cedar Street Bookshop, with editable headline, details and coloured shapes. Save the request as JSON, run the create and validate commands, and export SVG. Return the editable .stencil.json and exported artwork paths. Use the existing tool permissions. Do not post to a social network, call an image provider or change gateway settings.

For generated artwork, let the existing authorised provider tool save an image, then pass its local path to `import --image`. You do not need another OpenClaw gateway, scheduled job, dedicated MCP server or access to a signed-in browser. A checkout must exist on the execution worker; a checkout on your laptop is not automatically available on a remote agent host. Review the artwork before publishing it.

## Check results and failed commands

Commands exit with 0 on success and 1 on failure. Successful commands return one JSON object. Failed commands return one JSON error to stderr and keep existing output files unchanged. For example:

```json
{"ok":false,"code":"invalid-request","message":"Output already exists. Choose a new filename; existing work was kept."}
```

`--dry-run` on create, import or export validates and prepares the result without writing output. It still reads inputs; with `--allow-remote`, it also downloads explicit remote images. PNG/JPEG dry runs launch the isolated renderer to check artwork decoding. Press Ctrl+C to stop a running command. Files are not imported into your browser until you choose **Open JSON**.

If a command fails, check the specific message:

| Message | Action |
| --- | --- |
| Output or export folder already exists | Choose a new filename or folder. |
| Remote assets need `--allow-remote` | Import the local image, or explicitly allow that output download. |
| HTTP error or expired output | Download a fresh output through the provider's existing tool. |
| Native model validation error | Fix the stated size, font, colour or layer property in the request. |
| File unavailable | Check the input and output parent directories and permissions. |
| PNG/JPEG needs the development package | Run `npm ci`, or export SVG. |
| Browser executable unavailable | Install Playwright Chromium, or provide an existing Chrome path. |

The source exports `validateAgentRequest`, `buildAgentDesign`, `imageAssetFromBytes`, `sanitiseAgentCredit` and `predictionImageURL` from [src/agent-design.js](../src/agent-design.js). The pure helper performs no file, network or storage operations. `tests/agent-design.test.js` checks editable round trips, native validation before I/O, embedded image limits, signed URL removal, DNS/redirect boundaries, public examples, ordered carousel export and preservation of existing output.
