# Text styles and gradients

Stencil keeps text as native SVG text. Italic, underline, an outline or a shadow
change its appearance while preserving the words, line positions and alignment.
The same artwork can be used for the canvas, SVG download and the raster output
used by PNG, JPEG and PDF exports.

Each text layer has these style fields:

| Field | Values | Default |
| --- | --- | --- |
| `italic` | `true` or `false` | `false` |
| `underline` | `true` or `false` | `false` |
| `effect` | `none`, `shadow`, `outline` | `none` |
| `effectColour` | A six-digit hex colour | `#232a27` |
| `effectSize` | A number from 0 to 20 | 4 |

An effect size of zero hides the effect. The outline is drawn behind the filled
letters with rounded joins. A shadow uses a local SVG filter: its horizontal and
vertical offset are half the size, and its blur is a quarter of the size. The
filter region extends beyond the text bounds. Effects create no extra text copy
and need no external images, services or HTML.

A gradient is either `null`, which uses the existing solid colour, or an object
with `from`, `to` and `angle` fields. Both colours use six-digit hex values; the
angle runs from 0 to 360 degrees. Zero runs left to right, 90 runs top to bottom,
180 runs right to left and 270 runs bottom to top. A diagonal joins opposite
edges of the artwork's bounding box. As the shape changes size, the gradient
stretches with it; it is not a canvas-wide light direction.

`src/typography.js` has no DOM, document-model or network dependencies. Its public
helpers are:

- `defaultTextStyles()` returns a fresh default object for document creation and
  migrations. Gradient defaults belong to the document model separately.
- `validateTextStyles(element)` checks all five complete style fields without
  changing the element. Other element fields are checked by the document model.
- `validateGradient(gradient)` checks a null value or an exact three-field object.
- `gradientSVG(id, gradient)` returns a local `<defs>` block, or an empty string
  for a solid fill.
- `fillReference(id, solid, gradient)` returns the solid colour or a reference to
  the matching gradient definition. The caller includes that definition.
- `renderStyledText(element, wrappedLines, escapeXML)` returns native text and
  its local gradient/filter definitions. Wrapping, transforms, selection targets
  and allowed font names remain the model's responsibility. `escapeXML` is the
  caller's trusted escaping function; a safe default is also available.

The renderer accepts completely absent style fields for a standalone legacy
element. Partially missing new fields fail validation. Document migrations should
add the complete defaults and `gradient: null` before a v5 document is stored.
Definition IDs use separate namespaces for text gradients and shadows. Font
names and text are escaped; numeric values, colours and references are bounded.
Validators inspect own property descriptors before reading values, so getter
properties are rejected without being executed.

These controls apply to an entire text layer. They do not add mixed formatting
within a paragraph, curved text or editable letter outlines. PDF text export is
handled separately by `pdf-text.js`; see the [download guide](consumer-design.md#save-a-copy-and-download).
Installed font files and their licences are maintained by the font catalogue.
