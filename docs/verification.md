# Initial verification

The initial Linux build was checked with Node.js 24.14.0. All 9 model tests passed and the static build completed. Independent system-Chromium browser checks passed 15 checks with no page, console or failed-request errors. The browser checks exercised editing, persistence, validated JSON round-tripping and real exports, with desktop and mobile captures.

[The live GitHub workflow](https://github.com/tylerbuilds/stencil-studio/actions/workflows/verify.yml) is the current authority for platform checks. It runs model tests, builds and real built-app browser smoke on Ubuntu and macOS. The public demo deploys after both platforms pass.

This is an initial independent implementation. See [research provenance](research/rea-provenance.md) for what REA observed and what remains unknown.
