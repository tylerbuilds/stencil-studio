# Build Stencil designs with OpenClaw

This plugin gives an OpenClaw agent five tools for making editable social artwork. It runs Stencil's JavaScript directly, so an agent such as Zeus can create designs without shell or general filesystem access.

After the operator installs and enables the plugin, check it through the existing Gateway:

```bash
openclaw gateway call tools.invoke --params '{"name":"stencil_presets","args":{},"sessionKey":"agent:main:main"}'
```

The tool result must contain `"ok":true`, the current presets and templates, and the configured release SHA. This is a direct tool call; it does not ask a language model to run a command. Keep Gateway authentication in its existing native configuration.

## Install a pinned public runtime

Use Stencil Studio `v0.9.1` or later for this OpenClaw integration, and OpenClaw 2026.9.9 or later with the Node version required by that OpenClaw release. Stencil's portable CLI supports Node 22.19+ or 24.11+. Install on the machine that runs the existing OpenClaw Gateway, as the same service user. A checkout on a laptop is not available automatically on a remote agent host.

The plugin needs a complete pinned Stencil runtime, not a copy of this directory alone. Its runtime manifest covers the plugin, authoring schemas, the CLI's source dependencies, the bundled fonts and their licences. Set the required `runtimeDirectory` to the builder's absolute runtime path. On every tool call it checks that configured runtime's release SHA and manifest hash against the installed files.

The runtime directory must be named with the full, lowercase, 40-character released Git SHA. It and the separate output directory must belong to the service user and have mode `0700`. Neither directory nor its ancestors may be symlinks. Create an `incoming` directory inside the output directory, also with mode `0700`; it holds image and prediction files supplied by an authorised operator or an existing approved integration.

Clone the public source into a new checkout, then select a published release. This example pins `v0.9.1`; choose another published tag when updating:

```bash
git clone --filter=blob:none https://github.com/tylerbuilds/stencil-studio.git "$HOME/stencil-studio-openclaw"
cd "$HOME/stencil-studio-openclaw"
stencil_release_sha="$(git rev-parse 'v0.9.1^{commit}')"
git checkout --detach "$stencil_release_sha"
stencil_runtime_parent="$HOME/.local/share/stencil-studio/runtime"
stencil_output="$HOME/.local/share/stencil-studio/designs"
install -d -m 700 "$stencil_runtime_parent" "$stencil_output" "$stencil_output/incoming"
node integrations/openclaw/package-runtime.mjs --revision "$stencil_release_sha" --output "$stencil_runtime_parent/$stencil_release_sha"
```

The builder returns JSON with `releaseSha`, `manifestSha256`, `runtimeDirectory`, `pluginDirectory`, `files` and `bytes`. Copy the actual hashes, runtime directory and plugin path into the configuration below. `runtimeDirectory` is the complete release folder; `pluginDirectory` is the plugin package inside it. It reads the selected Git revision and writes a new runtime directory; an existing destination is refused. No package installation or provider key is needed.

Run these steps as the Gateway service user. If its home or intended destination has symlink ancestors, choose another absolute path that satisfies the directory checks. Keep the installed runtime unchanged. See the [published releases](https://github.com/tylerbuilds/stencil-studio/releases) when choosing an update.

## Add the plugin to the existing Gateway

Merge the following fragment into the existing OpenClaw configuration. Use the runtime builder's actual absolute paths and hashes; the angle-bracket values below are placeholders. Keep other plugin paths, entries and permissions.

```json
{
  "plugins": {
    "load": {
      "paths": ["/absolute/runtime/<release-sha>/integrations/openclaw"]
    },
    "entries": {
      "stencil-studio": {
        "enabled": true,
        "config": {
          "runtimeDirectory": "/absolute/runtime/<release-sha>",
          "releaseSha": "<40-character-release-sha>",
          "manifestSha256": "<64-character-manifest-sha256>",
          "outputDirectory": "/absolute/private/stencil-designs",
          "allowedAgentIds": ["main"]
        }
      }
    }
  }
}
```

Keep `runtimeDirectory` pointing to the unchanged release folder named by `releaseSha`. OpenClaw can capture plugin code into a managed directory when registering its tools. The plugin ships its authoring schema inside its own package, byte for byte identical to the portable request schema, so registration has no out-of-package schema dependency. Tool execution uses the explicitly configured runtime rather than the captured plugin's location. Keep that full runtime available even when OpenClaw loads a managed copy of the plugin.

`allowedAgentIds` uses OpenClaw's agent IDs, not their display names. It defaults to `["main"]`; change it explicitly if your intended agent has another ID. An agent's supplied identity and session identity must agree.

If `plugins.allow` is already an exclusive allowlist, add `stencil-studio` to that list. Existing plugin denies still apply. Explicit local paths and per-plugin enablement are described in [OpenClaw's plugin configuration](https://docs.openclaw.ai/tools/plugin#configure-plugin-policy).

The five tools are optional. If the intended agent uses a tool profile without an explicit `allow` list, merge these names into that agent's `tools.alsoAllow`:

```json
{
  "alsoAllow": [
    "stencil_presets",
    "stencil_create_design",
    "stencil_validate_design",
    "stencil_import_image",
    "stencil_export_svg"
  ]
}
```

If that scope already has an `allow` list, append the five names there instead: `allow` and `alsoAllow` cannot coexist in one scope. OpenClaw also supports the broader `group:plugins` opt-in; the five names are enough for this integration. Preserve your current tool profile and denies, including any shell and filesystem restrictions. See [OpenClaw's tool policy](https://docs.openclaw.ai/gateway/config-tools/tool-policy#toolsallow--toolsdeny).

These tools perform only the scoped design operations described below. Follow your existing Gateway owner's normal configuration validation and reload procedure. See [OpenClaw's optional tool registration](https://docs.openclaw.ai/plugins/tool-plugins#optional-and-factory-tools).

## Create an editable social post

First call `stencil_presets` and use the returned preset or template keys. Presets set the canvas size; templates add editable layers. The agent and editor share this catalogue.

Call `stencil_create_design` with this JSON:

```json
{
  "request": {
    "schema": "stencil-design-request",
    "version": 1,
    "title": "Cedar Street Bookshop — Saturday reading",
    "preset": "social",
    "pages": [{
      "name": "Saturday reading",
      "background": "#fff8ec",
      "elements": [
        { "type": "circle", "x": 760, "y": -90, "width": 430, "height": 430, "fill": "#d76e42" },
        { "type": "text", "text": "A good book.\nA slow Saturday.", "x": 80, "y": 320, "width": 900, "height": 280, "fontFamily": "Fraunces", "fontSize": 88, "fontWeight": 700, "fill": "#284e46", "lineHeight": 1.15 },
        { "type": "text", "text": "Saturday · 10am–4pm", "x": 80, "y": 785, "width": 900, "height": 90, "fontFamily": "DM Sans", "fontSize": 36, "fill": "#284e46" }
      ]
    }]
  }
}
```

The result contains `ok`, `designFile`, `path` and `releaseSha`. Keep the returned `designFile`, which has the form `<uuid>.stencil.json`; subsequent tools take that basename. Each creation or image import produces a new file. Existing designs stay available.

To validate or export, call:

```json
{ "design": "<designFile-returned-by-create>" }
```

Use that argument with `stencil_validate_design`, then `stencil_export_svg`. SVG export creates an artwork folder containing numbered page files and `manifest.json`. It embeds Stencil's bundled fonts and keeps their licence notices. System fonts depend on the receiving device.

For a carousel, supply several `pages` in slide order. A page can use a preset or custom whole-pixel `width` and `height`. Request layers use canvas pixels and six-digit hex colours. See the [complete request guide](../../docs/agent-design.md), [request schema](../../schemas/design-request.schema.json), [bookshop example](../../examples/agent-design/social-post.json) and [carousel example](../../examples/agent-design/carousel.json).

## Bring in an image from an existing generator

Call `stencil_import_image` with the returned design filename and exactly one image source. It adds an editable image layer to a new copy of the design. Page numbers start at 1. Optional `x`, `y`, `width` and `height` set its placement; without them, the image fits the page.

For an image supplied in `outputDirectory/incoming/generated-image.png`:

```json
{
  "design": "<designFile-returned-by-create>",
  "source": { "file": "generated-image.png" },
  "page": 1,
  "x": 80,
  "y": 80,
  "width": 920,
  "height": 720
}
```

Incoming names are basenames only. Files must be regular files owned by the service user, without symlinks or hard links. Arbitrary paths, traversal and folders are refused. An existing integration or the operator supplies incoming files; this plugin does not grant an agent general filesystem tools.

For an image-generation tool that returns inline bytes, pass an image data URL:

```json
{
  "design": "<designFile-returned-by-create>",
  "source": { "dataUrl": "data:image/png;base64,<image-base64>" }
}
```

Replace `<image-base64>` with the actual image data. PNG, JPEG, WebP and GIF images are accepted up to 6 MiB each, subject to native pixel limits. The declared type must match the image bytes. This route needs no remote download or incoming file.

For an existing public HTTPS output, explicitly allow its download:

```json
{
  "design": "<designFile-returned-by-create>",
  "source": { "url": "https://example.org/generated-image.png" },
  "allowRemote": true
}
```

The URL above is a placeholder. Supply the real output from your existing provider tool. Downloads accept public HTTPS and refuse private networks, unsafe redirects and credentials in URLs. The downloaded image bytes are embedded in the design; temporary signed download URLs are not retained in the artwork.

For an existing Replicate prediction response, pass its JSON object inline:

```json
{
  "design": "<designFile-returned-by-create>",
  "source": {
    "prediction": {
      "status": "succeeded",
      "output": ["https://example.org/generated-image.png"]
    },
    "outputIndex": 0
  },
  "allowRemote": true
}
```

Only the selected output URL is used. A supplied prediction status must be `succeeded`. Generation inputs and logs are not design instructions. If the provider returned a file object, save its bytes through that provider's existing integration or serialise its URL. An expired output must be saved again through the provider.

To import images during creation, include request `assets` and reference their IDs from image or frame layers. In this plugin, asset `file` and `prediction` values are incoming basenames. An asset `prediction` names a UTF-8 prediction JSON file, up to 1 MiB. Set the create call's `allowRemote: true` when using an asset URL or prediction. See the [request with an image](../../examples/agent-design/with-generated-image.json).

You can supply a `credit` object with the actual creator, source and licence details. The [CLI guide describes its fields](../../docs/agent-design.md#import-a-generated-image-already-on-disk). Account keys stay with the existing provider integration. These tools import finished outputs; they do not start paid generation, read provider credentials or post to social networks.

## Open the result in Stencil Studio

Download or transfer the returned editable `.stencil.json` through your existing approved file route. In Stencil, choose **File → Open JSON** and select it. Text, colours, shapes, images and positions remain editable. Choose **Save design** to keep it in **My designs**.

Use the editor's PNG or JPEG export controls for ready-to-upload social artwork. The OpenClaw plugin exports SVG only and needs no browser or additional runtime packages. For an authorised command worker that needs automated PNG/JPEG export, use the [portable CLI's raster export](../../docs/agent-design.md#export-png-or-jpeg-for-social-posts).

An example agent task is:

> Use the Stencil tools to make a square announcement and a three-slide carousel for Cedar Street Bookshop. Start with stencil_presets, keep the text and shapes editable, validate each design, and export SVG. Return the editable design and artwork paths. Import an already-generated image only if one has been supplied for this task.

## Check tool failures

OpenClaw wraps the plugin's JSON in its tool result; the original result is in `details`. Check its `ok` value before using a filename. Direct Gateway calls use the same tool policy as agent calls; a denied tool can appear unavailable. See [OpenClaw's tools invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api#policy--routing-behavior).

| Result | What to check |
| --- | --- |
| Tool unavailable | Plugin load path, enablement, plugin allowlist, intended agent's tool allowlist and existing denies. |
| Agent not authorised | `allowedAgentIds` and the resolved agent/session identity. |
| Runtime hash mismatch | Check `runtimeDirectory`, its SHA folder name, `releaseSha` and `manifestSha256` against the builder's result. Keep the complete release directory unchanged. |
| Required `runtimeDirectory` missing | Rebuild from `v0.9.1` or later and add the builder's absolute runtime path to the existing plugin config. |
| Directory or file unavailable | Service-user ownership, `0700` directories, incoming basename and regular files without links. |
| Remote import refused | Supply local bytes, or explicitly set `allowRemote: true` for an existing public HTTPS output. |
| `busy` | Wait for the current Stencil operation to finish, then retry. |
| Timed out or stopped | Retry the bounded operation after checking the input or output's availability. |
| Native validation error | Correct the stated request size, layer, font, colour or image field. |

Design work has a 45-second cancellation deadline after the release checks. Imports and design creation use Stencil's existing document limits; the editable design has a 12 MiB maximum. Cancelled or failed operations leave existing designs intact. Files produced successfully before a later failure may remain in the private output directory for inspection.

## Update or disable the integration

Build a new runtime for the chosen public release, then update the load path, `runtimeDirectory`, `releaseSha` and `manifestSha256` together through the existing Gateway owner's normal procedure. When upgrading from `v0.9.0`, add the required runtime directory as part of that configuration change. Keep `outputDirectory` and `allowedAgentIds` unless you intend to change them. Keep the previous runtime and design outputs until the replacement passes the direct `stencil_presets`, create, validate and export checks.

Set `plugins.entries["stencil-studio"].enabled` to `false` to disable it. Preserve output files you want to keep. Installing or updating this integration does not require a second Gateway, schedule, shell permission or provider account.
