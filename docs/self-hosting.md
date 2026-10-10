# Set up sharing and AI writing

Run `npm ci`, then `npm start` to use Stencil on your computer. Design tools, image adjustments and downloads work without another service. Sharing and AI writing need the server settings below; they are unavailable on the GitHub Pages demo.

To enable sharing, choose a private folder outside the project:

```sh
npm start -- --data-dir /absolute/private/stencil-data
```

Create a shared design to upload the current design. Owner, editor and viewer links have separate access tokens in the part of the URL after `#`. Revoking access stops old links working; enabling it again creates new links. Designs, comments, saved versions and permissions are stored on disk. The editor checks for updates; if someone saves before you, it keeps your edits and asks you to refresh. Access tokens are not included in browser save files or downloaded JSON.

The server uses `127.0.0.1` by default, so it is available only on your computer. To share it remotely, use an HTTPS reverse proxy, set `--public-origin https://your-app.example` and add an access layer you control. Anyone with a link can use its permission. There are no OAuth accounts, enterprise SSO or team billing. Back up the private directory separately. A lock stops two servers writing at once; after a crash, check that the recorded process has stopped before removing its lock.

To enable AI writing, configure an OpenAI-compatible chat-completions service through your environment or a private file outside the repository:

```sh
npm start -- --ai-env-file /absolute/private/ai.env \
  --ai-base-url http://127.0.0.1:8000/v1 --ai-model your-local-model \
  --data-dir /absolute/private/stencil-data
```

Supported keys are `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` and the existing `FEDORA_VLLM_API_KEY`/`VLLM_API_KEY`. Remote services require HTTPS. Choosing Write a draft sends only the text and direction shown in the AI window. Read or edit the result before applying it; Undo brings the earlier text back. Design ideas are suggestions, not finished layouts. This setup does not provide AI images, video generation or subject-aware background removal.

Remove a background colour uses the chosen colour and tolerance, starting at the image edges. Matching areas enclosed inside the subject stay intact in edge mode. The tool supports up to four million decoded pixels and does not detect the subject with AI. Video export records the canvas with optional local audio, using the formats your browser supports. See [making a video](video.md).
