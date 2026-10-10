# Release verification

## 0.5 blank design, drawing and layers — 10 October 2026

The 0.5 JavaScript and model passed **138 Node tests**. The final production build and **96 actual Chromium checks** passed on Fedora with Node.js 24.14.0: 34 consumer-workflow checks, seven v3-preservation checks, eleven phone-panel checks, 35 storage/recovery checks, six keyboard checks and three built-app checks. These totals include rendering, layout, error and source-stability gates.

The consumer run starts with zero layers, creates a custom-size blank design, adds and precisely edits native shapes, and uses real pointer drag and resize. It draws a retained brush stroke and dot, checks one-gesture Undo and cancellation, drags a visible grouped layer row with trusted native drag events, and then moves both selected members on the canvas. It also checks hide/show, front/back, effective group locks, unlocking a table editor, named recovery before New, save/reload, and downloaded JSON, SVG, PNG, JPEG and PDF. A painted horizontal line is checked through actual hit testing, movement, resizing and exported image pixels; its zero-height SVG geometry box is not used as the visibility test.

Native keyboard copy/paste between two isolated Stencil tabs preserves editable shapes, brush points, styles and relative geometry with fresh IDs and one Undo. These checks use known synthetic content and explicit local-origin clipboard permission. Layout checks cover 1,440px, 768px, 390px and 320px widths; the phone brush controls and New dialog close button have measured 44px targets. A trusted pointer click on the Background label activates its native colour input. No uncaught page errors, console errors, failed requests or external requests occurred in these runs.

The migration run loads a complete released-v3 fixture, compares the exact original-byte backup, edits and reloads it, and opens it through the actual JSON file chooser. Exported v4 retains the existing pages, guides, groups, images and source data. Recovery checks inject storage refusal and fill the declared twenty-design library, then verify that refused New/save actions retain the old bytes and leave backup downloads usable. Present-empty and corrupt saved data remain protected when their recovery writer fails.

Native Tab and Space reach and toggle Lock, and editing controls reflect its accepted state. Inspector rebuilding returns focus to the document body; subsequent Tab navigation reaches its controls, but focus continuity and a complete accessibility certification remain unverified. Derived stroke dimensions can display a long fractional value; exact model and exported geometry are retained. These are recorded follow-up advisories.

The [desktop design](screenshots/design-tools-0.5.png), [phone canvas](screenshots/design-tools-mobile-0.5.png), [phone layers](screenshots/layers-mobile-0.5.png) and [New design dialog](screenshots/new-design-0.5.png) show actual synthetic artwork and ordinary editor states. The [consumer design contract](consumer-design.md) records geometry, drawing, recovery and layer limits. These are local Fedora results; the exact commit's [Linux/macOS workflow](https://github.com/tylerbuilds/stencil-studio/actions/workflows/verify.yml) records remote platform and deployment qualification. The sections below retain earlier release evidence and their original scope.

## Historical 0.4 local clipboard and file workflows — 10 October 2026

The 0.4 source passed **26 actual Chromium workflow checks** on Fedora with Node.js 24.14.0. These exercise real keyboard and button clipboard transfers between tabs, editable chart/table/group data, external text and images after an internal copy, ordinary form pasting, multiple-file chooser insertion, browser file-drop coordinates and atomic Undo. Separate checks cover stale asynchronous drafts, direct JSON opening, permission denial and a real PNG download fallback. No page errors, console errors or unrelated failed requests occurred.

The file-drop checks use actual browser File/DataTransfer APIs and controlled event coordinates; they do not automate a physical file-manager drag. Clipboard checks use fresh synthetic browser contexts and explicit user actions. Supported types and limits are in [the clipboard and intake guide](research/core-workflows.md).

Independent review of current desktop, tablet, 390px and 320px captures found no unresolved material layout issue at normal text size. The editor retains its charcoal, warm-paper and orange palette, with a focused canvas and native controls. [Editable layers](screenshots/editable-layers-0.4.png) and [phone layout](screenshots/editable-layers-mobile-0.4.png) show synthetic example content.

The current commit's [Linux/macOS workflow](https://github.com/tylerbuilds/stencil-studio/actions/workflows/verify.yml) is the authority for platform, built-browser and deployment status. Publication requires both platform jobs to pass. The earlier broad parity inventory below remains a dated 0.3 snapshot; it is not a new full-parity claim.

## Historical 0.3 qualification — 10 October 2026

The 0.3.0 source was checked on Fedora with Node.js 24.14.0 and system Chrome. **110 Node tests**, **20 existing browser workflow checks** and **20 layout/data browser checks** passed against recorded source hashes, with no uncaught page or console errors or unrelated failed requests.

The new checks exercise persistent page order, ruler/guide edits, actual guide dragging, configurable snapping and Alt bypass, transparent PNG/SVG and JPEG flattening, retained tables and bar/line/pie data, literal grid/CSV edits and exact migration backups. They also cover sequential dimensions and styles, CRLF/BOM and leading blank lines, deferred imports and Undo/Delete while pointer previews are held.

A ten-check UI pass covers keyboard controls, desktop, tablet, 390px and 320px layouts. Independent screenshot review checks the original charcoal/orange studio, new artboards and real data/guide dialogs. Text-only enlargement is simulated; native browser zoom and a complete accessibility certification remain unverified. [Desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png) captures use synthetic example content; [retained data and guides](screenshots/data-and-guides.png) share the same editor.

Configured model writing and persistent shared-workspace workflows passed separate eight-check and thirteen-check integrations. Two explicit model requests cover review/Apply/Undo and cancellation. These services require the Node server; the static demo provides local design workflows. Real page video checks decode scene pixels, timestamps and non-silent Opus audio; cancellation releases resources and a new export succeeds. A separate media receipt binds the unchanged video module, while the current whole-source browser gate also exercises video export.

The [Linux/macOS workflow](https://github.com/tylerbuilds/stencil-studio/actions/workflows/verify.yml) runs the current commit's Node tests, production build, real Chromium browser smoke and static-server checks on Ubuntu and macOS. GitHub Pages publication requires both platform jobs to pass. Its exact commit run status is the authority for remote qualification; local checks do not substitute for a macOS run. These are browser apps, with no native installer.

[All-tier feature comparison](research/feature-comparison.md) records delivered workflows, explicit gaps, primary sources and sanitised proof metadata. Colour-key image removal remains a scoped local tool. Original authenticated target behaviour and proprietary algorithm equivalence remain unverified. No full commercial feature parity is claimed.
