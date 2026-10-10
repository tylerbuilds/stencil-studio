# Native clipboard and local file intake

This extension addresses the ordinary upload, insert, drop and copy/paste paths. It retains the existing original studio, document schema, guides, native datasets, local saves and optional configured sharing. It is not full Canva parity. Native-browser receipts and release qualification belong in [verification](../verification.md); the source behaviours below do not establish macOS browser or deployment execution by themselves.

Canva documents choosing multiple local files, dragging files from a computer folder, then using uploaded media in a design. Its upload formats include more media and document types than this application. Stencil implements local raster/text insertion rather than a cloud upload catalogue or conversion service. [Canva upload workflow](https://www.canva.com/help/upload-media/), [file formats](https://www.canva.com/help/upload-formats-requirements/). These official pages were checked on 10 October 2026.

## Delivered transport

The Image chooser accepts several raster images. File → Insert files and the Elements chooser accept PNG, JPEG, WebP, GIF and UTF-8 `.txt`; one strictly validated Stencil `.json` design can be opened separately after confirmation. The intentional File → Open JSON picker opens directly, with Undo and the same stale-draft guards. A canvas drop maps the pointer through the SVG artboard coordinates. Files dropped outside the artboard are placed at the current page centre; a file dropped outside the canvas is rejected while browser navigation is prevented. Files retain their input order, appear as selected native layers, persist through the document model and undo in one step.

All files in a batch are classified, bounded, read and decoded before any model write. Images require matching raster signatures, supported dimensions and a successful browser decode. SVG, HTML-only content, PDFs, office files, folders and unsupported media are rejected. Text remains text, including literal URLs, markup, Unicode and line breaks. No imported URL is fetched and no HTML/SVG source is inserted into the DOM.

Limits are twenty files, 8 MiB combined image/text input, 6 MiB per raster, 16,384 source pixels per side and 40 megapixels. Text has at most 10,000 characters; JSON retains the model's 12 MiB UTF-8 limit. Existing page/document element and storage limits still apply. If a validated insertion cannot be saved to browser storage, it remains available in memory and JSON export with an error rather than a saved-success message.

Pending work is tied to its design, page, cloud generation, accepted-edit revision and property draft. An edit, Undo/Redo, page/design replacement, newer intake, cancellation or changed editing draft prevents a stale completion from writing into later work. Open modal drafts are not replaced by a late intake. The visible Cancel insertion action aborts preparation; the design stays intact.

## System clipboard boundary

Copy and paste listen to real browser clipboard events. Text fields, contenteditable fields and open dialog forms retain native copy/paste. A canvas-owned paste prioritises a valid Stencil vector envelope, then actual clipboard files, then literal plain text. Prior internal selection data cannot override fresh external clipboard content: there is no separate tab-local object clipboard.

Selected layers use `application/x-stencil-studio+json` when the browser preserves custom types. A portable plain-text representation begins with `STENCIL_STUDIO_CLIPBOARD_V1` and a newline. Both carry a strict versioned envelope with the source page dimensions and validated native layers. Pasting regenerates element/group identities, preserves relative geometry and independently clones crops, image data and native datasets. Bounds are derived from the layers rather than trusted from imported metadata. Other applications see JSON text; use Copy page as PNG for an actual image.

The explicit Copy layers, Paste and Copy page as PNG actions use secure clipboard APIs only after a click. A denied or unsupported read leaves the design intact and directs the user to keyboard paste. An unsupported PNG clipboard write downloads the page image instead. No clipboard permission probing, polling or automatic read occurs. Browser permission and user-activation behaviour differ across implementations. [Clipboard API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API), [WebKit clipboard behaviour](https://webkit.org/blog/10855/async-clipboard-api/).

The clipboard format is an independent Stencil interchange format. It cannot decode proprietary Canva project objects, does not claim Canva's internal clipboard protocol, and does not convert HTML, SVG, office or connected-cloud documents. Native browser clipboard checks, synthetic DataTransfer checks and real operating-system file-manager drag gestures must be reported separately.
