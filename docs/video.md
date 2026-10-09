# Page videos

Stencil Studio turns the current design's pages into a local slideshow video. Pages remain editable still designs. The video module renders them to a canvas and records its stream with the browser's native `MediaRecorder`. Export takes approximately the timeline's running time and needs the tab to stay active.

The implementation supports a separate duration for each page, cuts or cross-fades, and an optional local audio file during export. It does not generate video with AI, import or trim video footage, animate individual elements, or provide a multi-track editor. The preview is visual only; it does not play the chosen audio file.

## Timing and output

Pages play in document order. Each page defaults to 3 seconds and can last from 0.25 to 30 seconds. The whole video is limited to 180 seconds. The available frame rates are 15, 24, 30 and 60 fps. A cross-fade uses the final 0.5 seconds of each page, or half that page's duration if shorter. It blends into the next page without extending the timeline. The last page has no outgoing fade.

The first page sets the output aspect ratio. The longest edge is capped at 1280 pixels, with no upscaling; both dimensions are rounded down to even numbers. Pages with different proportions fit within this frame with letterboxing, rather than being stretched or cropped. Preparation checks raster source images' decoded dimensions and rejects images above 24 megapixels, including imports with inaccurate dimension metadata. Recording stops with an error if the accumulated output exceeds 128 MiB.

Export selects a supported format at runtime. It tries WebM with VP8, then VP9, then generic WebM, followed by MP4 with an explicit AVC codec and generic MP4. Audio exports request the corresponding Opus or AAC codec. The returned file extension matches the selected container. If canvas stream capture or a suitable recorder format is unavailable, export reports that limitation. A `.mp4` download is available only when the browser reports MP4 recording support.

Native streaming WebM can omit container duration metadata even when its frames decode and play correctly. A player may initially show an indefinite duration. This module returns the browser's recording without remuxing; inspect packet timestamps when checking the exported running time.

Audio is optional and stays in memory for the export; it is not saved in the design JSON. A file must be at most 12 MiB, decode to at most 300 seconds, and have no more than two channels. Its beginning aligns with the beginning of the timeline. Longer audio is cut at the video's end; shorter audio leaves the remaining video silent. Decoding and recording still depend on formats supported by the current browser.

Timing and transition settings belong to the export session and are not stored in the design JSON. Preview pauses when the tab becomes hidden; recording stops with an explanatory error because a background tab can produce unreliable timing. Aborting releases recorder and stream tracks, scheduled frames, prepared scene bitmaps and any audio context. A new export can start after cleanup.

## Module API

```js
import { createTimeline, frameAt, getVideoSupport, previewTimeline, exportTimeline } from '../src/video.js';

const options = { sceneSeconds: [2, 4], transition: 'fade', fps: 30 };
const timeline = createTimeline(document, options);
const frame = frameAt(timeline, 1.75);
const support = getVideoSupport();

const abort = new AbortController();
const preview = await previewTimeline(document, {
  ...options, canvas, signal: abort.signal,
  onProgress: ({ seconds, duration, pageIndex }) => {
    // Update a local progress display.
  }
});
preview.play();
preview.pause();
preview.seek(3);
preview.stop();

const result = await exportTimeline(document, {
  ...options, signal: abort.signal, audioSrc: optionalLocalFile,
  onProgress: ({ phase, progress }) => {
    // phase is preparing, recording or complete.
  }
});
// result: { blob, mime, extension }
```

`sceneSeconds` may be one number for all pages or an array with exactly one value per page. `createTimeline` validates the design through the same schema used for JSON imports and does not change the original document. It returns scene start/end times, total duration, frame rate and output dimensions. `frameAt` clamps finite numeric times to the timeline's bounds; an exact cut boundary selects the next page. Its result includes the current page, next page where a fade is active, blend amount, scene progress and whether the timeline has ended.

`getVideoSupport()` returns `{ supported, mime, extension, reason }`. Its detection is a capability check, not a completed encoding test. `previewTimeline` prepares the canvas without autoplay and returns `play`, `pause`, `seek` and `stop` methods plus `duration`. `stop` releases its resources and is terminal. Both preview and export accept an `AbortSignal`. Progress callbacks also include seconds, duration and the current page index; preview callbacks use phase `preview`.

## Browser verification recipe

The Node tests verify timeline validation, independent page timing, cut and fade boundaries, non-mutation, bounded dimensions and recorder format selection. Lifecycle tests also cover a recorder waiting for a post-start frame, audio resource cleanup and cancellation followed by another export. These tests use explicit browser stubs; they do not prove canvas rendering, playable encoding or an audible track. Use an actual browser and keep the resulting file and a short receipt for those checks.

1. Start the app with `npm run dev`. Use two visibly different pages, one landscape and one portrait, and set durations to 2 and 3 seconds. Verify paused preview, play, pause, seeking across the 2-second boundary, replay after the end and stopping. Check that the portrait page is letterboxed and text, embedded images and filters render as expected.
2. Export cuts, then fades, with the tab in the foreground. Confirm progress reaches completion and that the returned blob has non-zero bytes and its MIME type and filename extension agree. Play the actual blob in a video element or download and open the actual file. Inspect a frame before the boundary, a blend frame during the final 0.5 seconds of the first page, and a frame after the boundary. Check for black frames or unexpected stretching.
3. Decode the downloaded file with a media player or `ffprobe`. Confirm the video dimensions are the timeline dimensions and its decoded duration is approximately 5 seconds, allowing recording and frame scheduling tolerance. Some WebM recordings expose an indefinite duration in the browser's initial metadata; inspect the decoded file's timestamps as well. Record the browser version, selected MIME type, byte count, dimensions, duration and outcome.
4. Export with a short, known local audio file, then with audio longer than the timeline. Verify that the decoded file has an audible audio track, starts from the beginning and ends with the video. Confirm short audio leaves silence afterwards. Try an invalid audio file and files exceeding the size, duration or channel limits; the operation should fail with a useful error.
5. Abort once during preparation and once during recording. Confirm the promise rejects, no download appears, recording and progress stop, and a fresh preview and export can run. Navigate away from or close a preview and confirm the caller invokes its terminal `stop` method. Try a JSON import containing an embedded image above 24 megapixels with falsely small `sourceWidth` and `sourceHeight`; preparation should still reject its actual dimensions.
6. Repeat with a browser that supports a different recorder format. Confirm the selected container is playable there. If no supported format is available, confirm an explanatory error appears and no empty or mislabelled file is offered.

Linux and macOS can run the browser app. Codec support, recording throughput and background-tab throttling vary by browser and device. This document is a verification recipe; it does not claim those browser checks have passed for every platform.

## Browser API references

The implementation uses [canvas stream capture](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream), [recording format detection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static), [recorder finalisation](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/stop) and [an audio stream destination](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination). These references explain the browser mechanisms; local verification receipts establish which paths worked in a particular browser.
