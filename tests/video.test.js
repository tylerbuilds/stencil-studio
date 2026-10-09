import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createPage } from '../src/model.js';
import { createTimeline, frameAt, selectVideoType, exportTimeline } from '../src/video.js';

function documentWithPages(dimensions = [[1920, 1080], [1080, 1080], [720, 960]]) {
  const document = createDocument();
  document.pages = dimensions.map(([width, height]) => createPage(width, height));
  return document;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('default timeline follows document order with three-second cuts and a bounded video size', () => {
  const document = documentWithPages();
  const timeline = createTimeline(document);
  assert.equal(timeline.duration, 9);
  assert.equal(timeline.fps, 30);
  assert.equal(timeline.transition, 'cut');
  assert.equal(timeline.width, 1280);
  assert.equal(timeline.height, 720);
  assert.deepEqual(timeline.scenes, document.pages.map((page, pageIndex) => ({
    pageId: page.id, pageIndex, start: pageIndex * 3, duration: 3, end: (pageIndex + 1) * 3, fadeSeconds: 0
  })));
});

test('each page can have independent timing without moving or mutating the source pages', () => {
  const document = documentWithPages();
  const snapshot = structuredClone(document);
  const options = { sceneSeconds: [.25, 1.25, 2.5], fps: 24, transition: 'fade' };
  deepFreeze(document);
  deepFreeze(options);
  const timeline = createTimeline(document, options);
  assert.deepEqual(timeline.scenes.map(scene => [scene.start, scene.duration, scene.end, scene.fadeSeconds]), [
    [0, .25, .25, .125], [.25, 1.25, 1.5, .5], [1.5, 2.5, 4, 0]
  ]);
  assert.equal(timeline.duration, 4);
  assert.equal(timeline.fps, 24);
  assert.deepEqual(document, snapshot);
  assert.deepEqual(options.sceneSeconds, [.25, 1.25, 2.5]);
});

test('scene and total limits accept their endpoints and reject excessive or invalid timing', () => {
  const document = documentWithPages(Array.from({ length: 6 }, () => [720, 960]));
  assert.equal(createTimeline(document, { sceneSeconds: 30 }).duration, 180);
  assert.equal(createTimeline(document, { sceneSeconds: .25 }).duration, 1.5);
  for (const sceneSeconds of [0, .249, 30.001, NaN, Infinity, '3', null, [], [3],
    [3, 3, 3, 3, 3, -1], [3, 3, 3, 3, 3, NaN], [3, 3, 3, 3, 3, 3, 3], Array(6)]) {
    assert.throws(() => createTimeline(document, { sceneSeconds }), `reject ${String(sceneSeconds)}`);
  }
  const tooLong = documentWithPages(Array.from({ length: 7 }, () => [720, 960]));
  assert.throws(() => createTimeline(tooLong, { sceneSeconds: 30 }));
});

test('frame rate and transition are explicit bounded choices', () => {
  const document = documentWithPages();
  for (const fps of [15, 24, 30, 60]) assert.equal(createTimeline(document, { fps }).fps, fps);
  for (const fps of [0, 23, 29.97, 120, '30', NaN, null]) assert.throws(() => createTimeline(document, { fps }));
  for (const transition of ['wipe', 'Fade', '', null]) assert.throws(() => createTimeline(document, { transition }));
});

test('timeline validates the document before accepting a video request', () => {
  const document = documentWithPages();
  assert.throws(() => createTimeline({ ...document, pages: [] }));
  assert.throws(() => createTimeline({ ...document, version: 99 }));
  assert.throws(() => createTimeline({ ...document, secret: true }));
  const invalidPage = structuredClone(document);
  invalidPage.pages[1].width = Infinity;
  assert.throws(() => createTimeline(invalidPage));
});

test('video dimensions follow the first page, downscale only, and stay even and within the cap', () => {
  const cases = [
    [[1920, 1080], [1280, 720]],
    [[1080, 1920], [720, 1280]],
    [[720, 960], [720, 960]],
    [[701, 999], [700, 998]],
    [[4096, 64], [1280, 20]],
    [[64, 4096], [20, 1280]]
  ];
  for (const [[width, height], expected] of cases) {
    const timeline = createTimeline(documentWithPages([[width, height], [1080, 1080]]));
    assert.deepEqual([timeline.width, timeline.height], expected);
    assert.equal(timeline.width % 2, 0);
    assert.equal(timeline.height % 2, 0);
    assert.ok(timeline.width >= 2 && timeline.height >= 2);
    assert.ok(Math.max(timeline.width, timeline.height) <= 1280);
  }
});

test('cut boundaries switch to the next page exactly and the final instant remains on the last page', () => {
  const timeline = createTimeline(documentWithPages(), { sceneSeconds: [2, 1, 3] });
  assert.equal(frameAt(timeline, 2 - 1e-6).pageIndex, 0);
  assert.deepEqual(frameAt(timeline, 2), {
    pageIndex: 1, nextPageIndex: null, mix: 0, sceneProgress: 0, seconds: 2, ended: false
  });
  assert.equal(frameAt(timeline, 3).pageIndex, 2);
  assert.equal(frameAt(timeline, 6 - 1e-6).ended, false);
  assert.deepEqual(frameAt(timeline, 6), {
    pageIndex: 2, nextPageIndex: null, mix: 0, sceneProgress: 1, seconds: 6, ended: true
  });
});

test('fades blend only the last half-second of a scene and never fade out the last page', () => {
  const timeline = createTimeline(documentWithPages(), { sceneSeconds: [2, 1, 3], transition: 'fade' });
  const before = frameAt(timeline, 1.49);
  assert.equal(before.nextPageIndex, null);
  assert.equal(before.mix, 0);
  assert.equal(frameAt(timeline, 1.5).mix, 0);
  assert.deepEqual(frameAt(timeline, 1.75), {
    pageIndex: 0, nextPageIndex: 1, mix: .5, sceneProgress: .875, seconds: 1.75, ended: false
  });
  assert.deepEqual(frameAt(timeline, 2), {
    pageIndex: 1, nextPageIndex: null, mix: 0, sceneProgress: 0, seconds: 2, ended: false
  });
  assert.equal(frameAt(timeline, 2.75).nextPageIndex, 2);
  assert.equal(frameAt(timeline, 2.75).mix, .5);
  assert.equal(frameAt(timeline, 5.9).nextPageIndex, null);
  assert.equal(frameAt(timeline, 5.9).mix, 0);
});

test('short scenes fade over half their own duration and a single-page timeline has no fade', () => {
  const document = documentWithPages([[720, 960], [720, 960]]);
  const timeline = createTimeline(document, { sceneSeconds: [.25, 1], transition: 'fade' });
  assert.equal(timeline.scenes[0].fadeSeconds, .125);
  assert.equal(frameAt(timeline, .124).nextPageIndex, null);
  assert.equal(frameAt(timeline, .1875).mix, .5);
  assert.equal(frameAt(timeline, .25).pageIndex, 1);
  const single = createTimeline(documentWithPages([[720, 960]]), { sceneSeconds: .25, transition: 'fade' });
  assert.equal(single.scenes[0].fadeSeconds, 0);
  assert.equal(frameAt(single, .2).nextPageIndex, null);
  assert.equal(frameAt(single, .2).mix, 0);
});

test('seeking clamps to the timeline, rejects invalid times and leaves the timeline untouched', () => {
  const timeline = createTimeline(documentWithPages(), { sceneSeconds: [2, 1, 3], transition: 'fade' });
  const snapshot = structuredClone(timeline);
  deepFreeze(timeline);
  assert.deepEqual(frameAt(timeline, -20), frameAt(timeline, 0));
  assert.deepEqual(frameAt(timeline, 20), frameAt(timeline, 6));
  for (const seconds of [NaN, Infinity, -Infinity, '2', null, undefined]) assert.throws(() => frameAt(timeline, seconds));
  frameAt(timeline, 1.75);
  assert.deepEqual(timeline, snapshot);
});

test('format selection prefers supported WebM codecs before MP4 and reports no fake fallback', () => {
  const queried = [];
  class Recorder {
    static isTypeSupported(mime) {
      queried.push(mime);
      return ['video/webm;codecs=vp9', 'video/mp4'].includes(mime);
    }
  }
  assert.deepEqual(selectVideoType(Recorder), { mime: 'video/webm;codecs=vp9', extension: 'webm' });
  assert.deepEqual(queried, ['video/webm;codecs=vp8', 'video/webm;codecs=vp9']);
  class MP4Recorder { static isTypeSupported(mime) { return mime === 'video/mp4'; } }
  assert.deepEqual(selectVideoType(MP4Recorder), { mime: 'video/mp4', extension: 'mp4' });
  class UnsupportedRecorder { static isTypeSupported() { return false; } }
  assert.equal(selectVideoType(UnsupportedRecorder), null);
  assert.equal(selectVideoType(null), null);
  assert.equal(selectVideoType(class RecorderWithoutDetection {}), null);
});

test('format selection requests audio codecs when required and tolerates a rejected codec probe', () => {
  const queried = [];
  class Recorder {
    static isTypeSupported(mime) {
      queried.push(mime);
      if (mime.includes('vp8')) throw new Error('Unsupported codec probe');
      return mime === 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
    }
  }
  assert.deepEqual(selectVideoType(Recorder, { audio: true }), {
    mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4'
  });
  assert.deepEqual(queried, [
    'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
  ]);
});

// A lifecycle stub, not a codec: this recorder waits for timestamp-separated
// post-start video frames and initial audio before delivering its start event.
async function withFrameWaitingBrowser(run) {
  const names = ['document', 'window', 'Image', 'HTMLCanvasElement', 'MediaRecorder', 'AudioContext'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const tracks = [], canvases = [], recorders = [], audioContexts = [];
  class Events extends EventTarget {
    listeners = new Map();
    addEventListener(type, callback, options) {
      super.addEventListener(type, callback, options);
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback, options) {
      super.removeEventListener(type, callback, options);
      this.listeners.get(type)?.delete(callback);
    }
    get listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
  }
  class Track {
    constructor(kind) { this.kind = kind; this.readyState = 'live'; tracks.push(this); }
    stop() { this.readyState = 'ended'; }
  }
  class Stream {
    constructor(initialTracks) { this.tracks = initialTracks; }
    getTracks() { return [...this.tracks]; }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    addTrack(track) { this.tracks.push(track); }
  }
  class Canvas {
    constructor() {
      canvases.push(this);
      this.context = { fillRect() {}, drawImage: () => this.stream?.recorder?.receiveFrame() };
    }
    getContext() { return this.context; }
    captureStream() {
      const track = new Track('video');
      track.requestFrame = () => this.stream?.recorder?.receiveFrame();
      this.stream = new Stream([track]);
      return this.stream;
    }
  }
  class RasterImage {
    naturalWidth = 64;
    naturalHeight = 64;
    set src(value) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  class Recorder {
    static isTypeSupported(mime) { return mime.startsWith('video/webm;codecs=vp8'); }
    constructor(stream, options) {
      this.stream = stream; stream.recorder = this;
      this.mimeType = options.mimeType; this.state = 'inactive';
      this.startEventDelivered = false; this.framePending = false;
      this.firstFrameAt = null; this.hasLaterFrame = false; this.frameTimes = [];
      recorders.push(this);
    }
    start() { this.state = 'recording'; this.startedAt = performance.now(); }
    receiveFrame() {
      if (this.state !== 'recording') return;
      const at = performance.now(); this.frameTimes.push(at);
      if (this.firstFrameAt === null) this.firstFrameAt = at;
      else if (at - this.firstFrameAt >= 20) this.hasLaterFrame = true;
      this.maybeStart();
    }
    maybeStart() {
      if (this.state !== 'recording' || this.startEventDelivered || this.framePending || !this.hasLaterFrame) return;
      if (this.stream.getAudioTracks().some(track => !track.source?.started)) return;
      this.framePending = true;
      this.startEventTimer = setTimeout(() => {
        if (this.state !== 'recording') return;
        this.startEventDelivered = true; this.startEventAt = performance.now();
        this.onstart?.();
      }, 50);
    }
    stop() {
      if (this.state === 'inactive') throw new DOMException('Recorder already stopped.', 'InvalidStateError');
      this.state = 'inactive';
      clearTimeout(this.startEventTimer);
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['lifecycle test payload'], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  }
  class Audio {
    constructor() { this.state = 'suspended'; this.currentTime = 0; audioContexts.push(this); }
    async resume() { this.state = 'running'; }
    async decodeAudioData() { return { duration: .1, numberOfChannels: 1 }; }
    createBufferSource() {
      this.source = {
        buffer: null, started: false, startCalls: 0, stopped: false, disconnected: false,
        connect(destination) { this.destination = destination; },
        start() {
          this.startCalls++;
          if (this.startCalls > 1) throw new DOMException('Audio source already started.', 'InvalidStateError');
          this.started = true; this.startedAt = performance.now();
          this.destination.stream.recorder?.maybeStart();
        },
        stop() { this.stopped = true; }, disconnect() { this.disconnected = true; }
      };
      return this.source;
    }
    createMediaStreamDestination() {
      const track = new Track('audio'); track.source = this.source;
      return { stream: new Stream([track]) };
    }
    async close() { this.state = 'closed'; }
  }
  const browserDocument = Object.assign(new Events(), { hidden: false, createElement: () => new Canvas() });
  const browserWindow = new Events();
  const replacement = { document: browserDocument, window: browserWindow, Image: RasterImage, HTMLCanvasElement: Canvas, MediaRecorder: Recorder, AudioContext: Audio };
  try {
    for (const [name, value] of Object.entries(replacement)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    await run({ tracks, canvases, recorders, audioContexts, browserDocument, browserWindow });
  } finally {
    recorders.forEach(recorder => clearTimeout(recorder.startEventTimer));
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('export sends frames before and after the recorder event without restarting its audio or clock', async () => {
  await withFrameWaitingBrowser(async ({ tracks, canvases, recorders, audioContexts, browserDocument, browserWindow }) => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('Recorder waited for initial video or audio.')), 1500);
    const recordingSamples = [];
    try {
      const result = await exportTimeline(documentWithPages([[64, 64]]), {
        sceneSeconds: .5, audioSrc: new Blob(['local audio']), signal: controller.signal,
        onProgress({ phase, seconds }) {
          if (phase === 'recording') recordingSamples.push({ seconds, at: performance.now(), started: recorders[0].startEventDelivered });
        }
      });
      assert.ok(result.blob.size > 0);
      assert.equal(result.mime, 'video/webm;codecs=vp8,opus');
      assert.equal(result.extension, 'webm');
      assert.equal(recorders[0].startEventDelivered, true);
      assert.equal(recorders[0].state, 'inactive');
      assert.equal(recordingSamples[0].started, false, 'Frame delivery must begin before the recorder start event.');
      const afterStart = recordingSamples.filter(sample => sample.started);
      assert.ok(afterStart.length >= 2, 'Progress must continue after the recorder start event.');
      assert.ok(recorders[0].frameTimes.some(at => at > recorders[0].startEventAt), 'The start event must not cancel future frame delivery.');
      for (const sample of recordingSamples.filter(sample => sample.seconds < .5)) {
        assert.ok(Math.abs(sample.seconds - (sample.at - recorders[0].startedAt) / 1000) < .03,
          'Progress must retain the original recording clock across the delayed start event.');
      }
      assert.equal(recordingSamples.at(-1).seconds, .5);
      assert.deepEqual(tracks.map(track => track.kind).sort(), ['audio', 'video']);
      assert.ok(tracks.every(track => track.readyState === 'ended'));
      assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
      assert.equal(audioContexts[0].state, 'closed');
      assert.equal(audioContexts[0].source.started, true);
      assert.equal(audioContexts[0].source.startCalls, 1);
      assert.ok(audioContexts[0].source.startedAt >= recorders[0].startedAt);
      assert.equal(audioContexts[0].source.stopped, true);
      assert.equal(audioContexts[0].source.disconnected, true);
      assert.equal(audioContexts[0].source.buffer, null);
      assert.equal(browserDocument.listenerCount, 0);
      assert.equal(browserWindow.listenerCount, 0);
    } finally { clearTimeout(deadline); controller.abort(); }
  });
});

test('aborting an audio recording releases its resources and the export lock for a fresh export', async () => {
  await withFrameWaitingBrowser(async ({ tracks, recorders, audioContexts, browserDocument, browserWindow }) => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 1500);
    let sawRecording = false;
    try {
      await assert.rejects(exportTimeline(documentWithPages([[64, 64]]), {
        sceneSeconds: .25, audioSrc: new Blob(['local audio']), signal: controller.signal,
        onProgress({ phase }) {
          if (phase === 'recording' && recorders[0].startEventDelivered) { sawRecording = true; controller.abort(); }
        }
      }), error => error.name === 'AbortError');
      assert.equal(sawRecording, true);
      assert.equal(recorders[0].startEventDelivered, true);
      assert.equal(recorders[0].state, 'inactive');
      assert.ok(tracks.every(track => track.readyState === 'ended'));
      assert.equal(audioContexts[0].state, 'closed');
      assert.equal(audioContexts[0].source.startCalls, 1);
      assert.equal(audioContexts[0].source.stopped, true);
      assert.equal(audioContexts[0].source.disconnected, true);
      assert.equal(audioContexts[0].source.buffer, null);
      assert.equal(browserDocument.listenerCount, 0);
      assert.equal(browserWindow.listenerCount, 0);
    } finally { clearTimeout(deadline); controller.abort(); }

    const retry = new AbortController();
    const retryDeadline = setTimeout(() => retry.abort(), 1500);
    try {
      const result = await exportTimeline(documentWithPages([[64, 64]]), {
        sceneSeconds: .25, audioSrc: new Blob(['local audio']), signal: retry.signal
      });
      assert.ok(result.blob.size > 0);
      assert.equal(recorders.length, 2);
      assert.ok(recorders.every(recorder => recorder.state === 'inactive'));
      assert.ok(tracks.every(track => track.readyState === 'ended'));
      assert.equal(audioContexts.length, 2);
      assert.ok(audioContexts.every(context => context.state === 'closed' && context.source.startCalls === 1 && context.source.stopped));
      assert.equal(browserDocument.listenerCount, 0);
      assert.equal(browserWindow.listenerCount, 0);
    } finally { clearTimeout(retryDeadline); retry.abort(); }
  });
});
