import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DESIGN_PRESETS, DESIGN_PRESET_GROUPS, DESIGN_SIZE_SOURCES, DESIGN_SIZES_OBSERVED_AT } from '../../src/design-presets.js';

const byKey = key => DESIGN_PRESETS.find(preset => preset.key === key);
const legacy = {
  poster: ['Poster', 720, 960], social: ['Square social post', 1080, 1080],
  card: ['Landscape card', 1000, 600], presentation: ['Presentation', 1920, 1080],
  banner: ['Web banner', 1500, 500], story: ['Portrait story', 1080, 1920],
  resume: ['A4 CV', 794, 1123], menu: ['A4 menu', 794, 1123]
};

test('existing canvas keys, labels and dimensions stay compatible with saved designs', () => {
  for (const [key, expected] of Object.entries(legacy)) {
    const preset = byKey(key);
    assert.ok(preset, key);
    assert.deepEqual([preset.name, preset.width, preset.height], expected);
    assert.equal(preset.sizeBasis, 'legacy');
  }
});

test('every choice has unique identity, valid editor dimensions and an accurate aspect', () => {
  const groups = new Set(DESIGN_PRESET_GROUPS.map(group => group.key));
  const uses = new Set(['image-post', 'link-image', 'story', 'video', 'video-thumbnail', 'profile-cover', 'print-design', 'presentation', 'web-banner']);
  assert.equal(groups.size, DESIGN_PRESET_GROUPS.length);
  assert.equal(new Set(DESIGN_PRESETS.map(preset => preset.key)).size, DESIGN_PRESETS.length);
  for (const preset of DESIGN_PRESETS) {
    assert.match(preset.key, /^[a-z][a-z0-9-]*$/);
    for (const dimension of [preset.width, preset.height]) assert.ok(Number.isInteger(dimension) && dimension >= 64 && dimension <= 4096, preset.key);
    assert.ok(groups.has(preset.group), preset.key);
    assert.ok(uses.has(preset.intendedUse), preset.key);
    assert.ok(preset.name.length > 0 && preset.name.length <= 48, preset.key);
    assert.ok(preset.hint.length > 0 && preset.hint.length <= 120, preset.key);
    assert.ok(Number.isInteger(preset.aspect.width) && preset.aspect.width > 0, preset.key);
    assert.ok(Number.isInteger(preset.aspect.height) && preset.aspect.height > 0, preset.key);
    assert.equal(preset.width * preset.aspect.height, preset.height * preset.aspect.width, preset.key);
  }
});

test('new social choices keep direct official source links and explain working sizes', async () => {
  const docs = await readFile(new URL('../../docs/research/social-sizes.md', import.meta.url), 'utf8');
  const hosts = new Set(['www.linkedin.com', 'help.x.com', 'help.pinterest.com', 'support.google.com', 'ads.tiktok.com', 'www.facebook.com']);
  for (const [id, source] of Object.entries(DESIGN_SIZE_SOURCES)) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(hosts.has(url.hostname), id);
    assert.ok(['organic', 'profile', 'advertising'].includes(source.scope), id);
    assert.ok(['readable', 'indexed-only'].includes(source.access), id);
    assert.ok(docs.includes(source.url), `Document source ${id}`);
  }
  for (const preset of DESIGN_PRESETS.filter(preset => !(preset.key in legacy))) {
    assert.ok(preset.sources.length > 0, preset.key);
    assert.ok(['working', 'platform-recommendation'].includes(preset.sizeBasis), preset.key);
    for (const source of preset.sources) {
      assert.equal(source.url, DESIGN_SIZE_SOURCES[source.id].url, preset.key);
      assert.equal(source.scope, DESIGN_SIZE_SOURCES[source.id].scope, preset.key);
      assert.equal(source.access, DESIGN_SIZE_SOURCES[source.id].access, preset.key);
      assert.ok(source.basis.length > 0, preset.key);
    }
  }
  assert.match(DESIGN_SIZES_OBSERVED_AT, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(docs.includes(DESIGN_SIZES_OBSERVED_AT));
});

test('working canvases fit the cited organic ratio ranges without claiming exact platform pixels', () => {
  const x = byKey('x-post');
  assert.deepEqual([x.width, x.height], [1600, 900]);
  assert.ok(x.width / x.height >= 3 / 4 && x.width / x.height <= 2);
  assert.equal(x.sizeBasis, 'working');
  assert.equal(x.sources[0].scope, 'organic');
  for (const key of ['social', 'portrait', 'landscape']) {
    const preset = byKey(key);
    assert.ok(preset.width >= 552 && preset.height >= 276);
    assert.ok(preset.width / preset.height >= 4 / 5 && preset.width / preset.height <= 3);
    assert.ok(preset.sources.some(source => source.id === 'linkedinPhotos' && source.scope === 'organic'));
  }
  assert.equal(byKey('portrait').sizeBasis, 'working');
  assert.equal(byKey('landscape').sizeBasis, 'working');
});

test('LinkedIn Page links and company covers retain their separate organic surfaces', () => {
  const link = byKey('linkedin'), cover = byKey('linkedin-cover');
  assert.deepEqual([link.width, link.height, link.intendedUse], [1200, 627, 'link-image']);
  assert.deepEqual([cover.width, cover.height, cover.intendedUse], [1512, 256, 'profile-cover']);
  assert.equal(link.sources[0].id, 'linkedinPages');
  assert.equal(cover.sources[0].id, 'linkedinPages');
  assert.equal(link.sources[0].scope, 'organic');
  assert.ok(link.sources[0].basis.includes('link-post'));
  assert.ok(cover.sources[0].basis.includes('Page cover'));
});

test('current YouTube recommendations and the compact working option remain distinguishable', () => {
  const compact = byKey('youtube'), large = byKey('youtube-hd'), shorts = byKey('shorts-thumb');
  assert.deepEqual([large.width, large.height, large.sizeBasis], [3840, 2160, 'platform-recommendation']);
  assert.deepEqual([shorts.width, shorts.height, shorts.sizeBasis], [2160, 3840, 'platform-recommendation']);
  assert.deepEqual([compact.width, compact.height, compact.sizeBasis], [1280, 720, 'working']);
  assert.ok(compact.width >= 640 && shorts.height >= 640);
  assert.equal(compact.width * 9, compact.height * 16);
  assert.equal(shorts.width * 16, shorts.height * 9);
  for (const preset of [compact, large, shorts]) assert.equal(preset.intendedUse, 'video-thumbnail');
  assert.deepEqual([byKey('youtube-cover').width, byKey('youtube-cover').height], [2560, 1440]);
  assert.equal(byKey('youtube-cover').safeGuide, undefined);
});

test('Pinterest image dimensions name their ad source and its text guide belongs only to organic video', () => {
  const image = byKey('pinterest'), video = byKey('pinterest-video'), guide = video.safeGuide;
  assert.deepEqual([image.width, image.height, image.sizeBasis], [1000, 1500, 'working']);
  assert.ok(image.sources.some(source => source.id === 'pinterestDesign' && source.scope === 'organic'));
  assert.ok(image.sources.some(source => source.id === 'pinterestAds' && source.scope === 'advertising'));
  assert.deepEqual([video.width, video.height, video.intendedUse], [1080, 1920, 'video']);
  assert.equal(guide.platform, 'pinterest');
  assert.equal(guide.surface, 'organic-video');
  assert.equal(guide.source, DESIGN_SIZE_SOURCES.pinterestPins.url);
  assert.deepEqual([guide.x, guide.y, video.width - guide.x - guide.width, video.height - guide.y - guide.height], [65, 270, 195, 790]);
  assert.ok(guide.x >= 0 && guide.y >= 0 && guide.width > 0 && guide.height > 0);
  assert.ok(guide.x + guide.width <= video.width && guide.y + guide.height <= video.height);
  assert.deepEqual(DESIGN_PRESETS.filter(preset => preset.safeGuide).map(preset => preset.key), ['pinterest-video']);
});

test('vertical video keeps TikTok and Meta advertising guidance separate from organic claims', () => {
  const preset = byKey('portrait-video');
  assert.deepEqual([preset.width, preset.height, preset.sizeBasis], [1080, 1920, 'working']);
  assert.equal(preset.width * 16, preset.height * 9);
  assert.ok(preset.width >= 540 && preset.height >= 960);
  assert.equal(preset.sources.find(source => source.id === 'tiktokAds').scope, 'advertising');
  const meta = preset.sources.find(source => source.id === 'metaReels');
  assert.equal(meta.scope, 'advertising');
  assert.equal(meta.access, 'indexed-only');
  assert.equal(preset.safeGuide, undefined);
  assert.ok(!DESIGN_PRESETS.some(choice => choice.platforms.includes('instagram')));
});

test('shared preset metadata cannot be mutated by one view and leak into another', () => {
  assert.ok(Object.isFrozen(DESIGN_PRESETS));
  assert.ok(Object.isFrozen(DESIGN_PRESET_GROUPS));
  assert.ok(Object.isFrozen(DESIGN_SIZE_SOURCES));
  assert.throws(() => { byKey('portrait').width = 1; }, TypeError);
  assert.throws(() => { byKey('portrait').aspect.width = 1; }, TypeError);
  assert.throws(() => { byKey('portrait').sources[0].url = 'https://example.com/'; }, TypeError);
  assert.throws(() => { byKey('portrait').platforms.push('unknown'); }, TypeError);
  assert.throws(() => { byKey('pinterest-video').safeGuide.x = -1; }, TypeError);
  assert.throws(() => { DESIGN_PRESET_GROUPS[0].name = ''; }, TypeError);
  assert.throws(() => { DESIGN_SIZE_SOURCES.tiktokAds.scope = 'organic'; }, TypeError);
});
