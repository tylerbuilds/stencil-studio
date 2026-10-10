/** Page-based browser video. No camera, microphone, remote media or service is used. */
import { validateDocument, pageSVG } from './model.js';
import { documentFontCSS, loadDocumentFonts } from './font-loader.js';
import { savedAudioBlob } from './video-settings.js';
import { identifyRaster } from './browser-intake.js';

export const VIDEO_LIMITS = Object.freeze({ maxEdge: 1280, minSceneSeconds: .25, maxSceneSeconds: 30, maxSeconds: 180, maxAudioBytes: 12 * 1024 * 1024, maxImagePixels: 24_000_000, maxOutputBytes: 128 * 1024 * 1024 });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const abortReason = signal => signal?.reason instanceof Error ? signal.reason : new DOMException('Video operation cancelled.', 'AbortError');
const checkAbort = signal => { if (signal?.aborted) throw abortReason(signal); };

export function createTimeline(document, { sceneSeconds, transition, fps = 30 } = {}) {
  const validated = validateDocument(document);
  if (transition === undefined) transition = validated.video.transition;
  assert(['cut', 'fade'].includes(transition), 'Choose a cut or fade transition.');
  assert([15, 24, 30, 60].includes(fps), 'Choose 15, 24, 30 or 60 frames per second.');
  const durations = sceneSeconds === undefined ? validated.pages.map(page => page.duration) : Array.isArray(sceneSeconds) ? Array.from(sceneSeconds) : validated.pages.map(() => sceneSeconds);
  assert(durations.length === validated.pages.length, "Set a duration for each page.");
  assert(durations.every(seconds => finite(seconds) && seconds >= VIDEO_LIMITS.minSceneSeconds && seconds <= VIDEO_LIMITS.maxSceneSeconds), 'Each scene must last between 0.25 and 30 seconds.');
  let duration = 0;
  const scenes = validated.pages.map((page, pageIndex) => {
    const start = duration; duration += durations[pageIndex];
    return { pageId: page.id, pageIndex, start, end: duration, duration: durations[pageIndex], fadeSeconds: transition === 'fade' && pageIndex < validated.pages.length - 1 ? Math.min(.5, durations[pageIndex] / 2) : 0 };
  });
  assert(duration <= VIDEO_LIMITS.maxSeconds, "Keep the video to 180 seconds or less.");
  const first = validated.pages[0], scale = Math.min(1, VIDEO_LIMITS.maxEdge / Math.max(first.width, first.height));
  const even = value => Math.max(2, Math.floor(value * scale / 2) * 2);
  return { scenes, duration, fps, transition, width: even(first.width), height: even(first.height) };
}

export function frameAt(timeline, seconds) {
  assert(finite(seconds), "Choose a valid time in seconds.");
  const position = Math.min(timeline.duration, Math.max(0, seconds));
  const scene = timeline.scenes.find(item => position < item.end) ?? timeline.scenes.at(-1);
  const mix = scene.fadeSeconds ? Math.min(1, Math.max(0, (position - (scene.end - scene.fadeSeconds)) / scene.fadeSeconds)) : 0;
  return { pageIndex: scene.pageIndex, nextPageIndex: mix > 0 ? scene.pageIndex + 1 : null, mix, sceneProgress: Math.min(1, (position - scene.start) / scene.duration), seconds: position, ended: position >= timeline.duration };
}

export function selectVideoType(Recorder = globalThis.MediaRecorder, { audio = false } = {}) {
  if (typeof Recorder?.isTypeSupported !== 'function') return null;
  const candidates = audio
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];
  for (const mime of candidates) {
    try { if (Recorder.isTypeSupported(mime)) return { mime, extension: mime.startsWith('video/mp4') ? 'mp4' : 'webm' }; } catch { /* A failed codec probe should not prevent checking the next format. */ }
  }
  return null;
}

export function getVideoSupport() {
  const type = selectVideoType();
  const canvasAvailable = typeof globalThis.HTMLCanvasElement?.prototype?.captureStream === 'function';
  if (!canvasAvailable || !type) return { supported: false, mime: null, extension: null, reason: "This browser cannot export WebM or MP4 video. Try an up-to-date version of Chrome, Chromium, Firefox or Safari." };
  return { supported: true, ...type, reason: '' };
}

function progress(callback, phase, timeline, seconds = 0, pageIndex = 0, fraction = seconds / timeline.duration) {
  callback?.({ phase, progress: Math.min(1, Math.max(0, fraction)), seconds, duration: timeline.duration, pageIndex });
}

/** Race work which cannot itself be cancelled, while removing every timer/listener. */
function bounded(promise, signal, milliseconds, message) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let finished = false;
    const complete = (fn, value) => { if (finished) return; finished = true; clearTimeout(timeout); signal?.removeEventListener('abort', cancelled); fn(value); };
    const cancelled = () => complete(reject, abortReason(signal));
    const timeout = setTimeout(() => complete(reject, new Error(message)), milliseconds);
    signal?.addEventListener('abort', cancelled, { once: true });
    Promise.resolve(promise).then(value => complete(resolve, value), error => complete(reject, error));
  });
}

function canvas2D(width, height) {
  assert(globalThis.document?.createElement, "Open Stencil Studio in a browser to export video.");
  const canvas = globalThis.document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  assert(context, "This browser could not prepare the video. Try another browser.");
  return { canvas, context };
}

async function verifyRaster(src, signal) {
  checkAbort(signal);
  // Imported designs can declare large bitmaps. Bound their real header before native decoding.
  let raster;
  try { const bytes = Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), character => character.charCodeAt(0)); raster = identifyRaster(bytes); }
  catch { throw new Error('An image in this video could not be opened. Replace it before exporting.'); }
  assert(raster.width > 0 && raster.height > 0 && raster.width * raster.height <= VIDEO_LIMITS.maxImagePixels, 'Use video images with at most 24 million pixels. Resize the image before exporting.');
  const image = new Image();
  try {
    await bounded(new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("An image in this video could not be opened. Replace it before exporting.")); image.src = src; }), signal, 15000, "An image in this video took too long to open. Try a smaller image.");
    checkAbort(signal);
    assert(image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth * image.naturalHeight <= VIDEO_LIMITS.maxImagePixels, "Use video images with at most 24 million pixels. Resize the image before exporting.");
  } finally { image.onload = image.onerror = null; image.src = ''; }
}

async function rasterScene(page, timeline, signal, checkedImages) {
  checkAbort(signal);
  for (const element of page.elements) if (['image', 'frame'].includes(element.type) && element.src && !element.hidden && !checkedImages.has(element.src)) { await verifyRaster(element.src, signal); checkedImages.add(element.src); }
  const { canvas, context } = canvas2D(timeline.width, timeline.height);
  const scale = Math.min(timeline.width / page.width, timeline.height / page.height);
  const width = Math.max(1, Math.round(page.width * scale)), height = Math.max(1, Math.round(page.height * scale));
  // Keep the original viewBox but bound the decoded SVG bitmap to the output size.
  await loadDocumentFonts(page, { signal });
  const svg = pageSVG(page, false, false, await documentFontCSS(page, { signal })).replace(/^(<svg[^>]*?) width="[^"]+" height="[^"]+"/, `$1 width="${width}" height="${height}"`);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const image = new Image();
  try {
    await bounded(new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error(`Could not render page “${page.name || 'Untitled'}” for video.`)); image.src = url; }), signal, 15000, "A video page took too long to prepare. Try smaller images.");
    checkAbort(signal);
    context.fillStyle = '#161a18'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas;
  } catch (error) { canvas.width = canvas.height = 1; throw error; }
  finally { image.onload = image.onerror = null; image.src = ''; URL.revokeObjectURL(url); }
}

async function prepareScenes(document, timeline, signal, onProgress) {
  const scenes = [], checkedImages = new Set();
  try {
    if (globalThis.document?.fonts?.ready) await bounded(globalThis.document.fonts.ready, signal, 5000, "The fonts did not load in time. Try exporting the video again.");
    progress(onProgress, 'preparing', timeline, 0, 0, 0);
    for (let index = 0; index < document.pages.length; index++) {
      scenes.push(await rasterScene(document.pages[index], timeline, signal, checkedImages));
      progress(onProgress, 'preparing', timeline, 0, index, (index + 1) / document.pages.length);
    }
    return scenes;
  } catch (error) { scenes.forEach(canvas => { canvas.width = canvas.height = 1; }); throw error; }
}

function drawFrame(context, scenes, timeline, seconds) {
  const frame = frameAt(timeline, seconds);
  context.globalAlpha = 1;
  context.drawImage(scenes[frame.pageIndex], 0, 0);
  if (frame.nextPageIndex !== null) { context.globalAlpha = frame.mix; context.drawImage(scenes[frame.nextPageIndex], 0, 0); context.globalAlpha = 1; }
  return frame;
}

/** A visual-only, seekable timeline player. stop() is terminal and frees scene bitmaps. */
export async function previewTimeline(document, { canvas, signal, onProgress, ...options } = {}) {
  assert(canvas && typeof canvas.getContext === 'function', "The video preview needs a canvas to display it.");
  checkAbort(signal);
  const timeline = createTimeline(document, options), validated = validateDocument(document);
  const scenes = await prepareScenes(validated, timeline, signal, onProgress);
  canvas.width = timeline.width; canvas.height = timeline.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) { scenes.forEach(scene => { scene.width = scene.height = 1; }); throw new Error("This browser could not prepare the preview. Try another browser."); }
  let seconds = 0, running = false, stopped = false, timer = null, started = 0;
  const paint = () => { const frame = drawFrame(context, scenes, timeline, seconds); progress(onProgress, 'preview', timeline, frame.seconds, frame.pageIndex); };
  const pause = () => { if (running) seconds = Math.min(timeline.duration, (performance.now() - started) / 1000); running = false; clearTimeout(timer); timer = null; };
  const stop = () => { if (stopped) return; pause(); stopped = true; scenes.forEach(scene => { scene.width = scene.height = 1; }); signal?.removeEventListener('abort', stop); globalThis.document.removeEventListener('visibilitychange', hidden); globalThis.window?.removeEventListener('pagehide', stop); };
  const hidden = () => { if (globalThis.document.hidden) pause(); };
  const tick = () => {
    if (!running || stopped) return;
    try { seconds = Math.min(timeline.duration, (performance.now() - started) / 1000); paint(); if (seconds >= timeline.duration) { running = false; timer = null; } else timer = setTimeout(tick, 1000 / timeline.fps); }
    catch { stop(); }
  };
  signal?.addEventListener('abort', stop, { once: true });
  globalThis.document.addEventListener('visibilitychange', hidden); globalThis.window?.addEventListener('pagehide', stop, { once: true });
  try { checkAbort(signal); paint(); } catch (error) { stop(); throw error; }
  return {
    duration: timeline.duration,
    play() { assert(!stopped, 'This preview has stopped. Create a new preview.'); checkAbort(signal); if (running || globalThis.document.hidden) return; if (seconds >= timeline.duration) seconds = 0; running = true; started = performance.now() - seconds * 1000; tick(); },
    pause,
    seek(position) { assert(!stopped, 'This preview has stopped. Create a new preview.'); const frame = frameAt(timeline, position); seconds = frame.seconds; if (running) started = performance.now() - seconds * 1000; paint(); },
    stop
  };
}

async function prepareAudio(audioSrc, signal) {
  if (audioSrc === undefined || audioSrc === null) return null;
  assert(audioSrc instanceof Blob && audioSrc.size > 0 && audioSrc.size <= VIDEO_LIMITS.maxAudioBytes, 'Choose a local audio file up to 12 MB.');
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  assert(Context, "This browser cannot add audio to the video. Export without audio or try another browser.");
  const context = new Context();
  let source, destination;
  try {
    // Resume while this function still runs in the export button's user gesture.
    const resumed = context.resume().then(() => ({}), error => ({ error }));
    const bytes = await bounded(audioSrc.arrayBuffer(), signal, 10000, 'Could not read this audio file.');
    const buffer = await bounded(context.decodeAudioData(bytes), signal, 15000, "This audio file could not be opened. Try a WAV or MP3 file.");
    const resumeResult = await bounded(resumed, signal, 5000, "Your browser blocked the audio. Start the export with its button, or remove the audio file.");
    if (resumeResult.error) throw resumeResult.error;
    checkAbort(signal);
    assert(context.state === 'running', "Your browser blocked the audio. Start the export with its button, or remove the audio file.");
    assert(buffer.duration > 0 && buffer.duration <= 300 && buffer.numberOfChannels <= 2, 'Audio must be no longer than five minutes and have one or two channels.');
    source = context.createBufferSource(); source.buffer = buffer;
    destination = context.createMediaStreamDestination(); source.connect(destination);
    return { context, source, destination };
  } catch (error) { source?.disconnect(); destination?.stream.getTracks().forEach(track => track.stop()); try { await context.close(); } catch { /* Context was already closed. */ } throw error; }
}

let exporting = false;
/** Records actual browser-rendered frames in real time and resolves only a non-empty video Blob. */
export async function exportTimeline(document, { signal: externalSignal, onProgress, audioSrc, ...options } = {}) {
  checkAbort(externalSignal);
  assert(!exporting, 'A video export is already running. Cancel it or wait for it to finish.');
  const support = getVideoSupport(); assert(support.supported, support.reason);
  assert(!globalThis.document.hidden, 'Keep this tab visible while exporting video.');
  const validated = validateDocument(document), timeline = createTimeline(validated, options);
  audioSrc ??= savedAudioBlob(validated.video.audio);
  const type = selectVideoType(globalThis.MediaRecorder, { audio: audioSrc !== undefined && audioSrc !== null });
  assert(type, "This browser cannot export video with this audio track. Remove the audio or try another browser.");
  const controller = new AbortController(), signal = controller.signal;
  const cancel = () => controller.abort(abortReason(externalSignal));
  const hidden = () => { if (globalThis.document.hidden) controller.abort(new Error("Export stopped because the tab was hidden. Keep this tab visible and try again.")); };
  const pagehide = () => controller.abort(new DOMException('Video stopped because the page closed.', 'AbortError'));
  externalSignal?.addEventListener('abort', cancel, { once: true });
  globalThis.document.addEventListener('visibilitychange', hidden); globalThis.window?.addEventListener('pagehide', pagehide, { once: true });
  exporting = true;
  let scenes = [], stream, recorder, audio, canvas;
  const timers = new Set();
  const schedule = (callback, ms) => { const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms); timers.add(timer); return timer; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  try {
    checkAbort(externalSignal);
    audio = await prepareAudio(audioSrc, signal);
    scenes = await prepareScenes(validated, timeline, signal, onProgress);
    checkAbort(signal);
    const output = canvas2D(timeline.width, timeline.height); canvas = output.canvas;
    drawFrame(output.context, scenes, timeline, 0);
    stream = canvas.captureStream(timeline.fps);
    if (audio) audio.destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 4_000_000, ...(audio ? { audioBitsPerSecond: 128_000 } : {}) });
    const blob = await new Promise((resolve, reject) => {
      const chunks = []; let bytes = 0, settled = false, expectedStop = false, started = 0, lastProgress = -Infinity, startupWatchdog = null;
      const settle = (fn, value) => { if (settled) return; settled = true; clearTimers(); signal.removeEventListener('abort', cancelled); fn(value); };
      const fail = error => { if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Tracks are stopped in finally. */ } } settle(reject, error); };
      const cancelled = () => fail(abortReason(signal));
      const finish = () => { expectedStop = true; clearTimers(); recorder.stop(); schedule(() => fail(new Error('The browser did not finish the video recording. Try a shorter export.')), 5000); };
      const tick = () => {
        if (settled) return;
        try {
          checkAbort(signal);
          const seconds = Math.min(timeline.duration, (performance.now() - started) / 1000), frame = drawFrame(output.context, scenes, timeline, seconds);
          if (seconds - lastProgress >= .1 || frame.ended) { progress(onProgress, 'recording', timeline, seconds, frame.pageIndex); lastProgress = seconds; }
          if (frame.ended) finish(); else schedule(tick, 1000 / timeline.fps);
        } catch (error) { fail(error); }
      };
      recorder.ondataavailable = event => { if (settled || !event.data?.size) return; bytes += event.data.size; if (bytes > VIDEO_LIMITS.maxOutputBytes) { fail(new Error('Video recording exceeded 128 MB. Use fewer scenes or a shorter duration.')); return; } chunks.push(event.data); };
      recorder.onerror = event => fail(event.error ?? new Error("This browser could not create the video file. Try another browser or fewer scenes."));
      recorder.onstop = () => {
        if (settled) return;
        if (!expectedStop) { settle(reject, new Error('Video recording stopped unexpectedly.')); return; }
        const result = new Blob(chunks, { type: recorder.mimeType || type.mime });
        if (!result.size) { settle(reject, new Error('The browser produced an empty video. Try another browser.')); return; }
        settle(resolve, result);
      };
      recorder.onstart = () => {
        if (settled) return;
        clearTimeout(startupWatchdog); timers.delete(startupWatchdog); startupWatchdog = null;
      };
      signal.addEventListener('abort', cancelled, { once: true });
      try {
        checkAbort(signal);
        startupWatchdog = schedule(() => fail(new Error('The video recorder did not start. Try another browser.')), 5000);
        started = performance.now();
        recorder.start(250);
        // Native recorders may wait for initial audio samples before their start event.
        // Start this one-shot source at the recording boundary, sharing its clock.
        audio?.source.start(audio.context.currentTime);
        // Native recorders can defer their start event until a captured frame arrives.
        // Paint after start, rather than making the next paint depend on that event.
        drawFrame(output.context, scenes, timeline, 0);
        stream.getVideoTracks().forEach(track => track.requestFrame?.());
        // Keep sending timestamped frames while the native muxer starts. Waiting
        // for its start event here can starve a combined audio/video recording.
        tick();
      }
      catch (error) { fail(error); }
    });
    checkAbort(signal);
    progress(onProgress, 'complete', timeline, timeline.duration, timeline.scenes.length - 1);
    return { blob, mime: blob.type, extension: blob.type.startsWith('video/mp4') ? 'mp4' : type.extension };
  } finally {
    controller.abort(); clearTimers();
    if (recorder) { recorder.ondataavailable = recorder.onerror = recorder.onstop = recorder.onstart = null; if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Already stopping. */ } } }
    stream?.getTracks().forEach(track => track.stop());
    if (audio) { try { audio.source.stop(); } catch { /* Source did not start, or already finished. */ } audio.source.disconnect(); audio.source.buffer = null; audio.destination.stream.getTracks().forEach(track => track.stop()); try { await audio.context.close(); } catch { /* Context was already closed. */ } }
    scenes.forEach(scene => { scene.width = scene.height = 1; }); if (canvas) canvas.width = canvas.height = 1;
    externalSignal?.removeEventListener('abort', cancel); globalThis.document.removeEventListener('visibilitychange', hidden); globalThis.window?.removeEventListener('pagehide', pagehide);
    exporting = false;
  }
}
