# REA investigation provenance

This initial implementation was investigated with [REA (Reverse Engineer Anything)](https://github.com/morluto/rea), the repository starred by tylerbuilds. REA is MIT licensed. The cloned source revision was `6ce3288f3bd65a886e47905455ed5c9b661015e6`; the local CLI package was `rea-agents@6.2.0`, executed with Node.js 24.14.0 and system Chromium on Linux. No global agent or MCP configuration was changed.

## Scope

The investigation used anonymous public browser capture of [Canva](https://www.canva.com/help/editing-designing/). REA recorded the rendered DOM, accessibility representation, browser viewport, URL and browser events. Raw target captures are retained separately and are not distributed in this repository. The code, layouts and assets in this project were written independently.

Public product descriptions and browser observations support the feature map. They do not establish the private implementation, authenticated application behaviour, proprietary algorithms or complete feature parity. See [feature-map.md](feature-map.md) for implemented behaviour and known gaps.

## Reproduce a public observation

Use a supported REA runtime (Node.js 22.19, 24.11 or a version accepted by the pinned package), and install `rea-agents@6.2.0` in a separate research directory. Run its `capture-browser-scenario` command against a scenario describing an anonymous public URL. See REA's [browser investigation documentation](https://github.com/morluto/rea/tree/main/docs). Set the browser executable to your local Chrome or Chromium installation. Keep private account state and credentials outside this repository.

## Recorded outcomes

- [Public editing and designing help catalogue](https://www.canva.com/help/editing-designing/): `observed`; REA evidence `ev_9e26d1b1e7b89b01f14a064013732a63476b749707bf7ffe0ed0da4100fbd979`.
- [Anonymous public homepage JavaScript bundle metadata](https://www.canva.com/): `scoped-static-analysis-complete`; REA evidence `ev_056d76d9d7c4880c962b88c0d8937e246217f8cf6f4a6828ea7fec2424ecfde5`.

See [rea-findings.json](rea-findings.json) for sanitised tool versions, receipt digests, public observations, static inferences and explicit unknowns. Raw third-party content is excluded.
