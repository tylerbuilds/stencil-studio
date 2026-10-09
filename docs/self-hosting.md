# Optional AI and shared designs

Run `npm ci`, then `npm start`. Local design editing, colour-key image editing, PDF/image exports and browser-supported scene video exports work without an external provider. The GitHub Pages demo does not provide an AI or collaboration server.

Enable the persistent shared workspace service with a private directory outside the repository and static build:

```sh
npm start -- --data-dir /absolute/private/stencil-data
```

Create uploads the current design. Owner, editor and viewer links use separate access tokens in URL fragments. Revocation invalidates old links; re-enabling creates new links. Comments, revisions and permission changes persist to disk. Watch polls real server state. Conflicts retain local edits for explicit recovery. Browser save files and downloaded design JSON do not contain collaboration tokens.

The server binds to `127.0.0.1` by default. A deliberate remote deployment requires an HTTPS reverse proxy, an explicit `--public-origin https://your-app.example` and an operator-managed access layer. This service provides capability-link permissions; it does not provide OAuth identities, enterprise SSO, team billing or a managed cloud account. Back up the private directory independently. A single-writer lock prevents competing servers. After a crash, confirm the recorded process is dead before removing its lock.

For real writing assistance, configure an OpenAI-compatible chat-completions provider using a native environment or private file outside the repository:

```sh
npm start -- --ai-env-file /absolute/private/ai.env \
  --ai-base-url http://127.0.0.1:8000/v1 --ai-model your-local-model \
  --data-dir /absolute/private/stencil-data
```

Supported keys are `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` and existing native `FEDORA_VLLM_API_KEY`/`VLLM_API_KEY`. Remote providers require HTTPS. Only the source/context visible in the AI dialog is sent when Generate is clicked. Review the returned copy before Apply; Undo remains available. Design plans are written advice. No AI image/video generation or semantic segmentation provider is included.

Colour-key removal edits real pixels connected to an image edge (or all matching pixels when selected), using your chosen colour and tolerance. It preserves enclosed matching subject pixels in edge mode and supports up to four million decoded pixels. It does not identify a subject with an AI model. Video export records real local canvas frames and optional uploaded audio, subject to browser codec support; see [video.md](video.md).
