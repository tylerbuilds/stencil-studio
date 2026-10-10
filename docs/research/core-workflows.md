# Add files and use the clipboard

Choose **Image** to add pictures, or **File → Insert files** to add pictures and text files. You can also drop files onto the canvas. A drop inside the page places them near the pointer; a drop in the space around it uses the page centre. Drop outside the canvas and Stencil tells you where to try again.

Files keep their order and appear as selected layers. **Undo** removes the whole batch. Stencil checks and reads every file before adding anything, so one bad file leaves the design unchanged.

## Choose supported files

Images can be PNG, JPEG, WebP or GIF. Text files must be UTF-8 `.txt` files. SVG, HTML-only content, PDF, office files, folders and other media are not accepted. A file needs a valid image signature and must open in the browser; changing its extension does not make it an image.

Text stays text, including URLs, markup, Unicode and line breaks. Stencil does not open pasted URLs or insert imported HTML or SVG into the page.

You can add up to 20 files with a combined size of 8 MiB. Each image can be up to 6 MiB, 16,384 pixels per side and 40 megapixels. Text can have up to 10,000 characters. Existing page and storage limits still apply. If the browser cannot save the result, the design stays open and Stencil asks you to download JSON.

## Open a saved design

**File → Open JSON** opens a Stencil design directly. Dropping or inserting one `.json` file asks before replacing the current design; it cannot be mixed with other files. **Undo** brings the previous design back. JSON uses the design's 12 MiB UTF-8 limit and is checked before opening.

Loading is cancelled if you switch designs or pages, make an edit, change a field, open a window or choose another batch. You can also choose **Cancel insertion**. These checks stop a file that finishes loading late from replacing newer work.

## Copy and paste

Select layers and press **Cmd/Ctrl-C**, then paste them into another Stencil tab with **Cmd/Ctrl-V**. Click the canvas before pasting text or an image from another app. Input fields and open form windows keep their normal copy and paste behaviour.

A paste first looks for copied Stencil layers, then image files, then plain text. An earlier layer copy does not override new content on your clipboard. Relative positions, groups, crops and table/chart values are kept, with new identities for the pasted layers.

**Tools → Copy layers**, **Paste** and **Copy page as PNG** use your browser's clipboard controls after a click. The browser may require a secure page and permission. If a button is blocked, Stencil suggests the keyboard shortcut. If it cannot copy a PNG, it downloads the image instead. Clipboard access is never polled or read automatically.

Other apps receive Stencil's copied layers as JSON text. Use **Copy page as PNG** when you want a picture instead. These clipboard controls cannot read proprietary Canva projects or turn HTML, SVG or office documents into a design.

## Clipboard format and checks

Stencil uses `application/x-stencil-studio+json` where the browser supports custom types. Its plain-text fallback starts with `STENCIL_STUDIO_CLIPBOARD_V1` and a newline. Both contain a checked, versioned record of the source page size and layers. Paste creates independent copies of the layer data and calculates their bounds from the layers, rather than trusting imported bounds.

Browser clipboard tests, controlled File/DataTransfer drops and physical file-manager drags are different checks. [Release checks](../verification.md) record what was tested and on which platform. The behaviour described here alone does not establish a macOS run or a deployed release.

## Sources

Canva's public help describes choosing several files, dragging them from a folder and adding uploaded media to a design. Stencil adds local images and text; it has no cloud upload catalogue or conversion service. Canva supports more file types. These pages were checked on 10 October 2026: [upload workflow](https://www.canva.com/help/upload-media/), [file formats](https://www.canva.com/help/upload-formats-requirements/).

Browser clipboard permissions and user-activation rules vary. See the [Clipboard API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API) and [WebKit clipboard notes](https://webkit.org/blog/10855/async-clipboard-api/). This is Stencil's own format, not Canva's internal clipboard protocol or a full feature-parity claim.
