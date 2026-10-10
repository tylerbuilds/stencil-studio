# Release checks

## 0.5.1 clearer wording

All **138 existing Node tests** and the build passed on Fedora with Node.js 24.14.0. Fresh Chrome checks covered a new custom-size design, shapes, freehand drawing, layers, exports and reloads. Separate checks deliberately damaged a saved design to test the recovery instructions and downloads. All **16 browser checks** passed. The phone check opened File, Tools and Download at 320, 390 and 700 pixels wide; their options fit on screen with 44-pixel action targets.

The [desktop](screenshots/design-tools-0.5.1.png) and [phone](screenshots/design-tools-mobile-0.5.1.png) captures show the revised editor. Earlier results below describe their own releases.

## Platform and publication checks

Use the run for the release’s exact commit in the [Linux/macOS workflow](https://github.com/tylerbuilds/stencil-studio/actions/workflows/verify.yml). It runs Node tests, the build, real Chromium browser checks and static-server checks on Ubuntu and macOS. Both platform jobs must pass before GitHub Pages publication. A Fedora run does not show whether macOS passed. Stencil runs in a browser and has no native installer.

## Recorded 0.5 checks: 10 October 2026

The 0.5 release passed **138 Node tests** and **96 Chromium checks** on Fedora with Node.js 24.14.0. The browser total includes 34 design-workflow checks, seven checks that version 3 data is kept, eleven phone-panel checks, 35 save/recovery checks, six keyboard checks and three built-app checks. These cover rendering, layout, errors and whether the tested source stayed unchanged.

The design checks start with a blank canvas, create a custom-size design, add and edit shapes, and drag and resize them. They draw a stroke and dot, check Undo and cancellation, drag a grouped layer row and move both members on the canvas. They also check hide/show, layer order, group locks, an unlocked table editor, the backup before New design, saving and reloading, and JSON, SVG, PNG, JPEG and PDF downloads. A horizontal line is checked by clicking, moving and resizing it, then inspecting exported pixels. Its zero-height SVG geometry box alone is not treated as proof that it is visible.

Keyboard copy and paste between two separate Stencil tabs keeps shapes, brush points, styles and relative positions, with new IDs and one Undo step. The content is synthetic and the browser contexts have explicit local-origin clipboard permission. Layout checks cover widths of 1,440, 768, 390 and 320 pixels. Phone brush controls and the New design close button have measured 44-pixel targets. Clicking the Background label opens its colour input. These runs had no page errors, console errors, failed requests or external requests.

The older-save checks load a complete version 3 fixture, compare its original backup bytes, edit and reload it, and open it through the JSON chooser. Version 4 exports keep the existing pages, guides, groups, images and data. Recovery checks refuse storage writes and fill the twenty-design library, then check that a refused New design or save keeps the old data and leaves backup downloads available. Empty or corrupt saved data is also kept if its recovery backup cannot be written.

Tab and Space can reach and toggle Lock. Rebuilding the inspector returns focus to the page body; later Tab presses reach the controls. Continuous focus and a full accessibility audit are not verified. Stroke dimensions can display a long fraction, while the saved and exported geometry stays exact. These remain follow-up items.

[Desktop](screenshots/design-tools-0.5.png), [phone canvas](screenshots/design-tools-mobile-0.5.png), [phone layers](screenshots/layers-mobile-0.5.png) and [New design](screenshots/new-design-0.5.png) screenshots show synthetic artwork in the editor. The [design guide](consumer-design.md) explains the tools and limits. These checks ran on Fedora. Earlier results below keep their original scope.

## Historical 0.4 local clipboard and file workflows — 10 October 2026

The 0.4 source passed **26 actual Chromium workflow checks** on Fedora with Node.js 24.14.0. These exercise real keyboard and button clipboard transfers between tabs, editable chart/table/group data, external text and images after an internal copy, ordinary form pasting, multiple-file chooser insertion, browser file-drop coordinates and atomic Undo. Separate checks cover stale asynchronous drafts, direct JSON opening, permission denial and a real PNG download fallback. No page errors, console errors or unrelated failed requests occurred.

The file-drop checks use actual browser File/DataTransfer APIs and controlled event coordinates; they do not automate a physical file-manager drag. Clipboard checks use fresh synthetic browser contexts and explicit user actions. Supported types and limits are in [the clipboard and intake guide](research/core-workflows.md).

Independent review of current desktop, tablet, 390px and 320px captures found no unresolved material layout issue at normal text size. The editor retains its charcoal, warm-paper and orange palette, with a focused canvas and native controls. [Editable layers](screenshots/editable-layers-0.4.png) and [phone layout](screenshots/editable-layers-mobile-0.4.png) show synthetic example content.

The broader feature comparison below remains a dated 0.3 snapshot. These 0.4 checks do not claim the full Canva feature set.

## Historical 0.3 checks — 10 October 2026

The 0.3.0 source was checked on Fedora with Node.js 24.14.0 and system Chrome. **110 Node tests**, **20 existing browser workflow checks** and **20 layout/data browser checks** passed against recorded source hashes, with no uncaught page or console errors or unrelated failed requests.

The new checks exercise persistent page order, ruler/guide edits, actual guide dragging, configurable snapping and Alt bypass, transparent PNG/SVG and JPEG flattening, retained tables and bar/line/pie data, literal grid/CSV edits and exact migration backups. They also cover sequential dimensions and styles, CRLF/BOM and leading blank lines, deferred imports and Undo/Delete while pointer previews are held.

A ten-check UI pass covers keyboard controls, desktop, tablet, 390px and 320px layouts. Independent screenshot review checks the original charcoal/orange studio, new artboards and real data/guide dialogs. Text-only enlargement is simulated; native browser zoom and a complete accessibility certification remain unverified. [Desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png) captures use synthetic example content; [retained data and guides](screenshots/data-and-guides.png) share the same editor.

Configured model writing and persistent shared-workspace workflows passed separate eight-check and thirteen-check integrations. Two explicit model requests cover review/Apply/Undo and cancellation. These services require the Node server; the static demo provides local design workflows. Real page video checks decode scene pixels, timestamps and non-silent Opus audio; cancellation releases resources and a new export succeeds. Separate test notes identify the unchanged video module. The browser checks also cover video export.

[All-tier feature comparison](research/feature-comparison.md) lists the tools, remaining gaps, original sources and test notes with private details removed. Background removal works by removing a selected colour. Canva’s signed-in behaviour and private algorithms have not been checked against Stencil. These results do not claim the full Canva feature set.
