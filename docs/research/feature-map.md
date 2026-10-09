# Public Canva feature observations and Stencil Studio scope

Research date: **9 October 2026**. Source: publicly accessible official Canva Help Center pages. This is a bounded behavioural feature study; it does not inspect private account data, bypass access controls, reproduce proprietary assets or recover Canva source code.

## Distinguish observations from implementation choices

An **observation** below means a capability described in public documentation. It does not prove that the authenticated product was exercised. The **initial scope** column records Stencil Studio's independent implementation contract; runtime checks and platform receipts are recorded separately. **Gaps** describe work outside this release. Proposed behaviour is an implementation choice, not evidence of Canva's internal architecture.

Canva's [editing and designing help index](https://www.canva.com/help/editing-designing/) groups templates, elements, images, text, page settings and layers. That public organisation informed this small editor's feature study; its interface, template artwork and state format are original.

The companion toolkit is [REA](https://github.com/morluto/rea), with the coordinating investigation pinned to `6ce3288`. REA supports evidence-oriented inspection of application and website behaviour. This map itself records public documentation research; [REA investigation provenance](rea-provenance.md) records the tool-specific scope. Any REA execution, browser observations, failures and limitations require their own verification receipts.

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

The implementation uses a document containing pages, each with an artboard and an ordered collection of elements. The browser renders and edits this state locally. This is a design decision for Stencil Studio; the research makes no claim about Canva's document model, renderer, APIs, persistence implementation or source code.

Keeping fonts local avoids an external dependency but can change text appearance across Linux and macOS. Local browser persistence avoids a service dependency but requires JSON export for transfer or backup. Exporting an imported image as part of an SVG does not turn that raster image into a vector image. Large artboards and images remain subject to browser memory and storage limits.

The initial product deliberately keeps the work local: no backend, tracking, accounts, network asset fetches or proprietary catalogue content. Research documents belong in this public repository only when they are safe to publish. Raw authenticated captures, credentials and private designs do not.

## Verify independently written behaviour

Before claiming a feature works, record a reproducible check of that feature in Stencil Studio. The minimum functional path is: choose a template, add/edit each element type, drag and nudge an element, change the artboard, reorder/delete layers, add/duplicate/switch/delete pages, undo/redo, reload a saved design, reject invalid JSON without losing the current document, round-trip valid JSON, and open SVG/PNG exports of the current page.

Run `npm test` for state behaviour and `npm run build` for the static package. Browser execution and OS-specific CI are separate evidence. This feature map is a source and scope record, not a substitute for those receipts. Native Linux/macOS desktop packaging and complete Canva parity are outside the initial release.
