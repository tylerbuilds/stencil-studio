# Release verification

The expanded 0.2.0 working source was checked on Fedora with Node.js 24.14.0 and system Chrome. **79 Node tests** and **20 independent browser workflow checks** passed. The browser runs recorded application hashes and reported no uncaught page or console errors or unrelated failed requests.

Grouping, snapping, locked layers, saved designs, page history, tables, CSV bulk work, raster/SVG/PDF exports and local colour-key processing. Real page videos were decoded to inspect scene pixels, timestamps and non-silent Opus audio; cancellation releases tracks and a fresh retry succeeds.

A separate ten-check UI pass exercised keyboard controls, desktop, tablet, 390px and 320px layouts, and a text-only enlargement simulation. Independent screenshot review checked the original visual identity, readability and control placement. The enlargement simulation is not native browser zoom or a complete accessibility certification. [Desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png) captures use synthetic example content.

Configured model writing and persistent shared-workspace workflows have separate integration checks. These services require the Node server; the static demo provides local design workflows.

The [Linux/macOS workflow](https://github.com/tylerbuilds/stencil-studio/actions/workflows/verify.yml) runs the current commit's Node tests, production build, real Chromium browser smoke and static-server checks on Ubuntu and macOS. GitHub Pages publication requires both platform jobs to pass. Its run status is the authority for remote qualification; local checks do not substitute for a macOS run.

[All-tier feature comparison](research/feature-comparison.md) records delivered workflows, explicit gaps, primary sources and sanitised proof metadata. Original authenticated target behaviour and proprietary algorithm equivalence remain unverified. No full commercial feature parity is claimed.
