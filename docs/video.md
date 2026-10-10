# Make a slideshow video

Open **Tools → Video** to turn your design pages into a slideshow. Set how long each page appears, choose a cut or fade between pages, then choose **Load preview**.

Use **Play**, **Pause** and the slider to check the result. The preview shows the pictures only. If you add an audio file, you will hear it in the exported video.

Choose **Export video** when you are ready. Export takes about as long as the video itself, so keep the tab open and active. The file downloads when it finishes, and you can play it in the window. **Cancel export** stops it.

## Set the timing

Pages play in design order. Each starts at 3 seconds; you can choose from 0.25 to 30 seconds per page, up to 180 seconds in total. A crossfade uses the last half-second of a page, or half its length if the page is shorter. It does not add time to the video.

The first page sets the video shape. Other page sizes fit inside that frame with space around them where needed. The longest edge is at most 1,280 pixels, and smaller designs are not enlarged.

Timing, transitions and audio last for this export session. They are not saved in the design JSON, so finish or export your video before closing the window.

## Add sound

Choose an optional audio file up to 12 MiB. It starts with the first page. Long audio stops when the video ends; short audio leaves the rest silent. The browser must be able to read the file. Audio can be up to 300 seconds with one or two channels, and stays in memory for the export.

## Check the downloaded file

Stencil uses the video formats your browser can record. WebM is preferred; MP4 is available only in browsers that support recording it. Some WebM players cannot show a duration until they have read the video, even when playback works.

Keep the tab in the foreground while exporting. Switching away can interrupt the timing, so Stencil stops the export and tells you to try again. Large source images over 24 megapixels and recordings over 128 MiB are refused.

This tool makes slideshows from still pages. It does not trim video footage or animate individual layers. Codec support varies between browsers and devices.

The sections below describe the module and checks for developers.

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
