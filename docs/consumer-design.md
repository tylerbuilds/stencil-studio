# Blank design, drawing and layers

Stencil Studio 0.5 starts with an empty white canvas. **New design** is available in the header. Custom sizes are 64–4,096 canvas pixels per side; presets are conveniences, not templates. A new design contains one blank page and no seeded elements.

Before New design or a template replaces current work, the full current document is copied into the local library under a distinct Recovery name. This never updates an existing saved entry. An untouched initial blank can be replaced directly. A failed recovery leaves the current design and library intact; Save current JSON downloads a portable backup. Library capacity is twenty entries and 18 MiB; browser quota may be smaller. Recovery does not guarantee protection from clearing browser data. Undo is session-only.

## Native elements and gestures

Rectangles, circles, triangles, diamonds, stars, lines and arrows have validated numeric geometry. Filled shapes have fill and outline controls; lines use Line colour and outline width. Native freehand strokes use a brush colour and 1–80 pixel width, 1–2,000 ordinary normalised points, and the same x/y/width/height/rotation/opacity and hide/lock fields as other elements. The document still permits at most 300 elements per page, 1,000 total and 12 MiB formatted UTF-8 JSON. There is no arbitrary path string, external SVG, script or remote image field.

Brush mode starts with Draw or B. Pointer movement renders a temporary preview; pointer release adds exactly one element in one history commit. A click is a dot. Long gestures progressively simplify samples within the point limit, retaining the first and most recent endpoints. A cancelled pointer, Escape, window blur, an accepted edit, Undo, a page switch or a design replacement cancels the pending preview. A stale asynchronous file operation cannot overwrite a committed drawing. Exporters receive only committed, validated elements.

Select or V exits drawing. Strokes can be moved, resized, rotated, recoloured, copied between Stencil tabs, duplicated, grouped and exported without flattening their stored points. SVG is vector artwork; PNG/JPEG and the existing raster PDF/video routes render the same safe SVG. This is one solid round brush, without pressure sensitivity, an eraser, markers, ShapeAssist or commercial-editor parity.

## Layer authority

The last element in the page array is frontmost. Layers displays that order in reverse. Drag a row above/below a target group, use arrow buttons, or select layers and choose Bring to front / Send to back. Groups move atomically and keep internal order. A locked member protects all members from geometry/style edits, removal and ordering; hide/show and unlocking remain available. Hidden content remains in JSON and clipboard payloads but is absent from canvas and exports. Locked content remains visible.

## Schema and rollback

Document schema is v4. Import validates the original v1/v2/v3 allowlist before migrating. v3 migration changes only version; existing data, guides, transparency, page order, groups and image settings are unchanged. Exact old active and library JSON is durably retained before overwrite; backup failure blocks that write. Recovery data can be downloaded when offered. Older v3 applications reject new v4 saves, so use the preserved original for rollback. Clipboard envelope version 1 remains stable, but older applications reject unsupported new native element types rather than flattening or executing them.

Node tests and actual browser receipts are separate qualification layers. The coordinator records browser workflows, screenshot review and Linux/macOS CI; this document describes the implementation contract and does not substitute for those receipts.
