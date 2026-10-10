# Photos, frames and collages

Start with an empty frame, add a photo, then choose **Crop & position** to drag and zoom it into place. Rounded rectangles, circles, diamonds, stars and arches keep the photo inside their shape. You can change the border colour and width, move or resize the frame, and use the normal layer controls.

Collages add two columns, three columns, four equal frames or one large frame with two smaller neighbours. Every frame stays editable. They contain original placeholder artwork until you add your photos.

## Cropping

Drag the preview with a mouse or touch. **Zoom** brings the photo closer. **Fit photo** centres it with no empty edges. **Reset** restores the crop you had when you opened the editor. **Apply crop** makes one edit; **Cancel** leaves the design alone. Arrow keys move the preview, Shift moves it further, and plus/minus change zoom.

Ordinary photos also offer original proportions, square, 4:3, 16:9 and 3:4. Choosing proportions changes the image layer's size. A frame keeps its shape and size while you reposition the photo inside it. Photo adjustments are shown in the preview and retained after cropping. Cropping keeps the original embedded photo, so you can change your mind later.

The helpers use the document's normalised source crop. They do not analyse faces or choose a subject automatically. Images remain embedded PNG, JPEG, WebP or GIF files; no photo uploads or external image URLs are sent over the network. GIFs use the existing image workflow; this is not a GIF timeline editor.

## Integration

`frames.js` has no model dependency. Add `frame` to the v5 type list, allow the existing image fields plus `FRAME_FIELDS`, call `defaultsForFrame(patch)` when creating one and `validateFrameFields(element)` at the document boundary. An empty `src` is valid only for a frame. Clamp `cornerRadius` to half the smaller dimension when resizing. `renderFrameContent(element, escapeXML, interactive)` supplies safe inner SVG; common transforms and layer attributes remain in the model.

`collageLayout(page, preset, {padding, gutter})` returns frame patches without IDs. Presets are `2columns`, `3columns`, `2x2` and `hero`. Assign distinct layer IDs and an optional shared group, and add all frames in one history transaction. A layout that would produce a frame smaller than one design pixel is rejected.

Link `src/crop-editor.css` from the app. `openCropEditor(image, {onApply, onCancel})` captures a clone and returns `{dialog, close, cancel, destroy}`. The Apply callback receives `{crop, width, height}`. Check the target page, layer, document/session revision, permissions and lock state before committing: a user can change or open another design while the editor is active. An Apply callback returning `false` keeps the editor open with a stale-target message. Exceptions also keep it open with an error. Close/cancel/destroy release pointer capture, remove listeners and restore focus; cancellation is reported once.

The pure placement helpers support boundary tests without a browser. Full browser interaction and exported raster appearance are checked by the coordinating release workflow.
