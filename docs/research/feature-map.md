# Initial Canva feature study (v0.1.0)

This is the first release’s feature study. The [expanded behaviour ledger](parity-ledger.md) covers the later free and premium study. The gaps below describe the first release, not everything missing from the current app.

Research date: **9 October 2026**. Source: publicly accessible official Canva Help Center pages. This study covers public behaviour only. It does not inspect private accounts, bypass access controls, copy proprietary assets or recover Canva source code.

## Distinguish observations from implementation choices

An **observation** is a feature described in public documentation, not proof that it was tested in Canva’s signed-in editor. **Initial scope** says what Stencil planned to build; browser and platform results are separate. **Gaps** are features outside that release. Stencil’s design choices do not reveal Canva’s internal architecture.

Canva’s [editing and designing help index](https://www.canva.com/help/editing-designing/) groups templates, elements, images, text, page settings and layers. Those public categories informed the study. Stencil’s interface, templates and file format are original.

The companion toolkit is [REA](https://github.com/morluto/rea), with the coordinating investigation pinned to `6ce3288`. REA can inspect app and website behaviour. This map records public documentation; [REA research notes](rea-provenance.md) explain how the tool was used. REA runs, browser observations, failures and limits need their own recorded checks.

| Feature | Public observation and source | Stencil Studio initial scope | Gaps |
| --- | --- | --- | --- |
| Templates | Templates and layouts provide a starting point for a design. [Templates and layouts](https://www.canva.com/help/templates-layouts/) | Three original layouts: poster, square social graphic and card. | No Canva template files, template marketplace, bulk creation or AI design generation. |
| Shapes and element controls | The element help covers adding and moving elements and changing their colours and dimensions. [Elements](https://www.canva.com/help/elements/) | Rectangles and circles; pointer dragging; inspector position, size and fill; deletion. | No frames, arbitrary paths, grouping, locking, gradients, snapping or interactive elements. |
| Text | Canva documents adding text and changing text size, formatting and effects. [Text and fonts](https://www.canva.com/help/text-fonts/) | Editable text content, font family, font size and colour. | No rich text spans, curved text, text effects, translation or AI writing. |
| Photos | Canva documents adding and editing images and backgrounds. [Images and photos](https://www.canva.com/help/images-photos/) | Upload local PNG/JPEG/WebP/GIF images up to 6 MB and position/resize them on the artboard; set a solid background colour. | No stock-photo catalogue, cloud uploads, retouching, filters, background removal, generated images or animated export. |
| Dimensions | Public help describes custom design sizes. [Resize designs and size limits](https://www.canva.com/help/resize/) | Edit the artboard width and height in pixels. | No automatic reflow, print units, aspect-ratio presets across multiple pages or product-specific resizing parity. |
| Layers | Canva documents selecting elements from a layer list and changing their order. [Finding and arranging layers](https://www.canva.com/help/finding-and-arranging-layers/) | Select, reorder and delete individual elements through a layer list. | No multi-selection, grouped layers or shared layer editing. |
| Pages | Canva documents adding, duplicating and deleting pages. [Page settings, guides and layers](https://www.canva.com/help/pages-guides-layers/) | Add a blank page, duplicate the current page, switch pages and delete pages while retaining at least one. | No batch page downloads, cross-document copying, guides, margins or page numbering. |
| History | Canva documents reviewing and restoring saved design versions. [Review and restore older versions](https://www.canva.com/help/version-history/) | Local editing undo/redo and persistence of the current design. | Session undo is not durable version history; no named snapshots, cloud history or collaborative attribution. |
| Downloads | Canva documents image export formats including PNG and SVG. [Choose the right download file type](https://www.canva.com/help/download-file-types/) | SVG and PNG downloads of the current page. | No PDF/PPTX, video/audio export, print colour profiles, bleed, crop marks, batch export or claimed rendering parity. |
| Portable project files | This research does not establish a public editable Canva interchange format. | A Stencil Studio versioned JSON format containing all pages, limited to 12 MB with validation before replacing the current document. | JSON is specific to Stencil Studio; it cannot open or reconstruct Canva projects. |

## Record the inferences and boundaries

Stencil stores a design as pages, each with a canvas and ordered layers. The browser draws and edits them locally. That is Stencil’s own design choice; it does not describe Canva’s document model, renderer, APIs, storage or source code.

System fonts can look different on Linux and macOS. Designs save in the browser; download JSON to back them up or move them elsewhere. An image inside an SVG is still an image, not converted vector artwork. Large canvases and images can exceed the browser’s memory or storage.

The first release kept work local, with no backend, tracking, accounts, remote assets or proprietary catalogue. Public research belongs in this repository; private account captures, credentials and designs do not.

## Verify independently written behaviour

Before describing a feature as working, record how it was checked. Cover templates, each element type, dragging and keyboard movement, canvas changes, layer and page order, deletion, Undo/Redo, saving and reloading, invalid JSON rejection, valid JSON export/import and opening SVG/PNG downloads.

Run `npm test` for state behaviour and `npm run build` for the static package. Browser runs and platform CI need separate results. This feature map records sources and scope; it does not replace those checks. Native desktop packages and full Canva parity were outside the first release.
