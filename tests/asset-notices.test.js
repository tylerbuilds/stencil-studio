import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { COLLECTION_NOTICES, validateAssetNotice, embedAssetNotice, collectAssetNotices, assetCredits, assetMetadataXML, appendExportNotices, preserveAssetNoticesDataURI } from '../src/asset-notices.js';
import { buildPDF } from '../src/export.js';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data) {
  const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length, 0); output.write(type, 4); output.set(data, 8);
  output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4); return output;
}
function image(extra = []) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Other comment\0Keep this unchanged.')), chunk('IDAT', deflateSync(Buffer.from([0, 231, 64, 132, 255]))), ...extra, chunk('IEND', Buffer.alloc(0))]);
}
function chunks(bytes) {
  const output = []; let position = 8;
  while (position < bytes.length) { const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(position); output.push({ type: Buffer.from(bytes.subarray(position + 4, position + 8)).toString('ascii'), data: bytes.subarray(position + 8, position + 8 + length), raw: bytes.subarray(position, position + length + 12) }); position += length + 12; }
  return output;
}
const record = (collection = 'tabler', id = `${collection}-sun`, name = 'Sun') => ({ collection, id, name, ...COLLECTION_NOTICES[collection] });
const element = bytes => ({ type: 'image', src: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` });
const creditsIn = bytes => collectAssetNotices([element(bytes)]);
function metadata(bytes) { return chunks(bytes).find(item => item.type === 'tEXt' && Buffer.from(item.data).toString('ascii').startsWith('Stencil Asset Notices\0')); }
function changedMetadata(bytes, change) {
  return Buffer.concat([signature, ...chunks(bytes).map(item => {
    if (item.type !== 'tEXt' || !Buffer.from(item.data).toString('ascii').startsWith('Stencil Asset Notices\0')) return Buffer.from(item.raw);
    const data = JSON.parse(Buffer.from(item.data).toString('ascii').split('\0')[1]); change(data);
    const text = JSON.stringify(data).replace(/[^\x20-\x7e]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return chunk('tEXt', Buffer.from(`Stencil Asset Notices\0${text}`));
  })]);
}

test('approved notices match the pinned upstream full licence bytes', () => {
  const hashes = { tabler: 'b740a1d46122672da62833e97f7e7c8a13fa85cbc7445b584b297cc00dde93db', fluent: 'c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383', doodles: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499' };
  for (const [collection, expected] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(COLLECTION_NOTICES[collection].notice).digest('hex'), expected);
    assert.deepEqual(validateAssetNotice(record(collection)), record(collection));
    assert.throws(() => { COLLECTION_NOTICES[collection].notice = 'changed'; });
  }
});

test('adding credits keeps every original PNG chunk and pixel byte intact with valid CRCs', () => {
  const original = image(), output = embedAssetNotice(original, record());
  const oldChunks = chunks(original), newChunks = chunks(output);
  assert.equal(newChunks.length, oldChunks.length + 1);
  for (const item of oldChunks) assert.ok(newChunks.some(next => Buffer.from(next.raw).equals(item.raw)));
  for (const item of newChunks) assert.equal(crc32(item.raw.subarray(4, -4)), new DataView(item.raw.buffer, item.raw.byteOffset, item.raw.byteLength).getUint32(item.raw.length - 4));
  assert.deepEqual(inflateSync(Buffer.concat(newChunks.filter(item => item.type === 'IDAT').map(item => item.data))), Buffer.from([0, 231, 64, 132, 255]));
  assert.equal(newChunks.at(-2).type, 'tEXt'); assert.equal(newChunks.at(-1).type, 'IEND');
  assert.deepEqual(creditsIn(output), [record()]);
});

test('notices survive saved JSON and copied layer data, without adding model fields', () => {
  const source = element(embedAssetNotice(image(), record('fluent', 'fluent-birthday-cake', 'Birthday cake')));
  const restored = JSON.parse(JSON.stringify({ elements: [source, structuredClone(source)] }));
  assert.deepEqual(collectAssetNotices(restored.elements), [record('fluent', 'fluent-birthday-cake', 'Birthday cake')]);
  assert.deepEqual(Object.keys(source), ['type', 'src']);
});

test('many assets share one complete licence while preserving all their identities', () => {
  const records = Array.from({ length: 100 }, (_, index) => record('tabler', `tabler-icon-${index}`, `Icon ${index}`));
  const output = appendExportNotices(image(), 'image/png', records);
  const data = JSON.parse(Buffer.from(metadata(output).data).toString('ascii').split('\0')[1]);
  assert.equal(data.credits.length, 1); assert.equal(data.assets.length, 100);
  assert.equal(data.credits[0].notice, COLLECTION_NOTICES.tabler.notice);
  assert.equal(creditsIn(output).length, 100);
  assert.ok(metadata(output).data.length < 10 * 1024);
});

test('duplicated composite PNGs count unique asset identities rather than repeated notices', () => {
  const records = Array.from({ length: 20 }, (_, index) => record('tabler', `tabler-icon-${index}`, `Icon ${index}`));
  const composite = element(appendExportNotices(image(), 'image/png', records));
  const copies = Array.from({ length: 101 }, () => structuredClone(composite));
  assert.equal(collectAssetNotices(copies).length, 20);
  assert.equal(assetCredits(copies).length, 1);
});

test('PNG re-export merges and deduplicates existing licences and keeps ordinary comments', () => {
  const a = embedAssetNotice(image(), record()), b = appendExportNotices(a, 'image/png', [record(), record('fluent')]);
  assert.equal(chunks(b).filter(item => item.type === 'tEXt' && Buffer.from(item.data).toString('ascii').startsWith('Stencil Asset Notices\0')).length, 1);
  assert.deepEqual(creditsIn(b).map(item => item.collection), ['fluent', 'tabler']);
  assert.ok(chunks(b).some(item => Buffer.from(item.data).toString() === 'Other comment\0Keep this unchanged.'));
  assert.deepEqual(assetCredits([element(a), element(b)]).map(item => item.collection), ['fluent', 'tabler']);
});

test('cache results cannot be mutated to forge a later export', () => {
  const source = element(embedAssetNotice(image(), record()));
  const first = collectAssetNotices([source]); first[0].notice = 'fake'; first.push(record('fluent'));
  assert.deepEqual(collectAssetNotices([source]), [record()]);
  for (let index = 0; index < 40; index++) creditsIn(embedAssetNotice(image(), record('tabler', `tabler-icon-${index}`, `Icon ${index}`)));
  assert.deepEqual(collectAssetNotices([source]), [record()]);
});

test('SVG metadata is inert and holds the same complete collection notices', () => {
  const named = record('tabler', 'tabler-note', 'Notes & "ideas"'), source = element(embedAssetNotice(image(), named));
  const markup = assetMetadataXML([source]); assert.match(markup, /^<metadata id="stencil-asset-notices">/);
  assert.ok(markup.includes('&amp;')); assert.ok(markup.includes('&quot;')); assert.ok(!markup.includes('<script'));
  const text = markup.replace(/^<metadata[^>]+>|<\/metadata>$/g, '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const data = JSON.parse(text); assert.equal(data.credits[0].notice, COLLECTION_NOTICES.tabler.notice); assert.equal(data.assets[0].name, named.name);
  assert.equal(assetMetadataXML([element(image())]), '');
});

test('record validation rejects forged claims, URLs, unknown properties and unsafe names', () => {
  const invalid = [
    { ...record(), collection: '__proto__' }, { ...record(), license: 'CC0' }, { ...record(), source: 'https://attacker.invalid/' },
    { ...record(), source: 'javascript:alert(1)' }, { ...record(), notice: 'Made up permission' }, { ...record(), notice: `${record().notice}\nDifferent terms` },
    { ...record(), id: '../tabler-sun' }, { ...record(), id: 'fluent-sun' }, { ...record(), name: '<script>hi</script>' },
    { ...record(), name: 'Hello\nthere' }, { ...record(), name: 'a'.repeat(101) }, { ...record(), arbitrary: true }
  ];
  for (const value of invalid) assert.throws(() => embedAssetNotice(image(), value), /asset credits/);
});

test('notice records and input arrays reject accessors and hidden fields before invoking them', () => {
  let calls = 0;
  const getter = record(); Object.defineProperty(getter, 'notice', { get() { calls++; return COLLECTION_NOTICES.tabler.notice; }, enumerable: true });
  assert.throws(() => validateAssetNotice(getter), /asset credits/);
  const hidden = record(); Object.defineProperty(hidden, 'hidden', { value: 'extra' });
  assert.throws(() => validateAssetNotice(hidden), /asset credits/);
  const symbolic = record(); symbolic[Symbol('extra')] = true;
  assert.throws(() => validateAssetNotice(symbolic), /asset credits/);
  const records = []; Object.defineProperty(records, 0, { get() { calls++; return record(); }, enumerable: true });
  assert.throws(() => appendExportNotices(image(), 'image/png', records), /asset credits/);
  assert.throws(() => appendExportNotices(image(), 'image/png', Array(1)), /asset credits/);
  const custom = [record()]; Object.setPrototypeOf(custom, Object.create(Array.prototype));
  assert.throws(() => appendExportNotices(image(), 'image/png', custom), /asset credits/);
  assert.equal(calls, 0);
});

test('metadata readback rejects licence substitution, duplicate IDs, extra fields and missing credits', () => {
  const original = embedAssetNotice(image(), record());
  assert.equal(creditsIn(changedMetadata(original, data => { data.assets[0].name = 'Sun icon'; }))[0].name, 'Sun icon');
  for (const change of [data => { data.credits[0].notice = 'fake'; }, data => { data.assets.push(data.assets[0]); }, data => { data.assets[0].script = 'alert()'; }, data => { data.credits = []; }, data => { data.version = 2; }]) {
    assert.throws(() => creditsIn(changedMetadata(original, change)), /asset credits/);
  }
});

test('damaged noticed PNGs are refused; ordinary images without asset notices stay usable', () => {
  const original = embedAssetNotice(image(), record()), badCRC = original.slice(); badCRC[badCRC.length - 5] ^= 1;
  assert.throws(() => creditsIn(badCRC), /asset credits/);
  assert.throws(() => creditsIn(original.subarray(0, original.length - 12)), /asset credits/);
  assert.deepEqual(collectAssetNotices([{ type: 'image', src: 'data:image/png;base64,aGVsbG8=' }, { type: 'image', src: 'data:image/jpeg;base64,/9j/2Q==' }, { type: 'text', src: 'ignored' }]), []);
  assert.deepEqual(creditsIn(image()), []);
  const corrupted = image(); corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => embedAssetNotice(corrupted, record()), /asset credits/);
  assert.throws(() => embedAssetNotice(Buffer.concat([image(), Buffer.from([0])]), record()), /asset credits/);
});

test('metadata and image bounds prevent oversized work before it reaches exports', () => {
  assert.throws(() => embedAssetNotice(new Uint8Array(6 * 1024 * 1024 + 1), record()), /asset credits/);
  const records = Array.from({ length: 500 }, (_, index) => record('tabler', `tabler-${'a'.repeat(105)}-${index}`, 'n'.repeat(100)));
  assert.throws(() => appendExportNotices(image(), 'image/png', records), /asset credits/);
  assert.throws(() => collectAssetNotices(Array.from({ length: 1001 }, () => element(image()))), /asset credits/);
  assert.throws(() => appendExportNotices(image(), 'text/plain', []), /PNG or JPEG/);
});

test('chunk sprays are bounded before metadata scans can create excessive objects', () => {
  const spray = image(Array.from({ length: 8192 }, () => chunk('stUd', Buffer.alloc(0))));
  assert.throws(() => embedAssetNotice(spray, record()), /asset credits/);
  assert.deepEqual(creditsIn(spray), []);
  const notice = metadata(embedAssetNotice(image(), record()));
  const lateNotice = image([...Array.from({ length: 8192 }, () => chunk('stUd', Buffer.alloc(0))), Buffer.from(notice.raw)]);
  assert.throws(() => creditsIn(lateNotice), /asset credits/);
  const jpegSpray = Buffer.concat([Buffer.from([255,216]), Buffer.from(Array.from({ length: 8192 }, () => [255,1]).flat()), Buffer.from([255,217])]);
  assert.throws(() => appendExportNotices(jpegSpray, 'image/jpeg', [record()]), /asset credits/);
});

test('large noticed PNGs keep their notices without a repeated-group base64 regex', () => {
  const large = image([chunk('tEXt', Buffer.from(`Large ordinary comment\0${'a'.repeat(2 * 1024 * 1024)}`))]);
  const original = element(embedAssetNotice(large, record('fluent'))).src;
  assert.deepEqual(collectAssetNotices([{ type: 'image', src: original }]), [record('fluent')]);
  const edited = preserveAssetNoticesDataURI(original, element(large).src);
  assert.deepEqual(collectAssetNotices([{ type: 'image', src: edited }]), [record('fluent')]);
});

// The scan includes stuffed 0xff bytes, a restart marker and a repeated SOS.
// The helper only edits COM markers; all headers and scan bytes must survive.
const jpeg = Buffer.from([255,216,255,224,0,4,0,1,255,254,0,6,255,254,253,252,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,21,255,0,34,255,208,42,255,218,0,8,1,1,0,0,63,0,23,255,0,12,255,217]);
function jpegComments(bytes) {
  const found = []; let position = 2;
  while (position < bytes.length - 1) {
    if (bytes[position] === 255 && bytes[position + 1] === 254) {
      const length = bytes[position + 2] * 256 + bytes[position + 3]; found.push(bytes.subarray(position + 4, position + length + 2)); position += length + 2;
    } else position++;
  }
  return found;
}
test('JPEG comments preserve binary comments and scan data while retaining full notices', () => {
  const output = appendExportNotices(jpeg, 'image/jpeg', [record(), record('fluent')]);
  const comments = jpegComments(output), ours = comments.find(value => Buffer.from(value).toString('ascii').startsWith('Stencil Asset Notices 1/1\n'));
  assert.ok(ours); assert.ok(comments.some(value => Buffer.from(value).equals(Buffer.from([255,254,253,252]))));
  const decoded = JSON.parse(Buffer.from(ours).toString('ascii').split('\n').slice(1).join('\n'));
  assert.equal(decoded.credits.find(value => value.collection === 'tabler').notice, COLLECTION_NOTICES.tabler.notice);
  assert.equal(decoded.credits.find(value => value.collection === 'fluent').notice, COLLECTION_NOTICES.fluent.notice);
  assert.ok(Buffer.from(output).subarray(output.length - jpeg.length + 2).equals(jpeg.subarray(2)));
  const again = appendExportNotices(output, 'image/jpeg', [record()]); assert.deepEqual(again, output);
});

test('an exported JPEG keeps its licences when reinserted, copied and exported as PNG or edited', () => {
  const output = appendExportNotices(jpeg, 'image/jpeg', [record(), record('fluent')]);
  const source = { type: 'image', src: `data:image/jpeg;base64,${Buffer.from(output).toString('base64')}` };
  const restored = JSON.parse(JSON.stringify(source));
  const records = collectAssetNotices([restored]); assert.equal(records.length, 2);
  assert.deepEqual(collectAssetNotices([{ type: 'image', src: `data:image/jpeg;base64,${jpeg.toString('base64')}` }]), []);
  const asPNG = appendExportNotices(image(), 'image/png', records);
  assert.deepEqual(creditsIn(asPNG), records);
  const edited = preserveAssetNoticesDataURI(source.src, element(image()).src);
  assert.deepEqual(collectAssetNotices([{ type: 'image', src: edited }]), records);
  const broken = output.subarray(0, output.length - 1);
  assert.throws(() => collectAssetNotices([{ type: 'image', src: `data:image/jpeg;base64,${Buffer.from(broken).toString('base64')}` }]), /asset credits/);
});

test('large bounded JPEG metadata spans two valid COM segments and stays readable on re-export', () => {
  const records = Array.from({ length: 280 }, (_, index) => record('tabler', `tabler-${'a'.repeat(90)}-${index}`, 'n'.repeat(80)));
  const output = appendExportNotices(jpeg, 'image/jpeg', records), comments = jpegComments(output).filter(value => Buffer.from(value).toString('ascii').startsWith('Stencil Asset Notices '));
  assert.equal(comments.length, 2); assert.ok(comments.every(value => value.length <= 65533));
  const data = JSON.parse(comments.map(value => Buffer.from(value).toString('ascii').split('\n').slice(1).join('\n')).join(''));
  assert.equal(data.assets.length, 280); assert.equal(data.credits.length, 1);
  assert.deepEqual(appendExportNotices(output, 'image/jpeg', []), output);
});

test('damaged JPEG marker lengths and truncated streams cannot silently lose notices', () => {
  assert.throws(() => appendExportNotices(jpeg.subarray(0, -1), 'image/jpeg', [record()]), /asset credits/);
  const malformed = Uint8Array.from(jpeg); malformed[4] = 255; malformed[5] = 255;
  assert.throws(() => appendExportNotices(malformed, 'image/jpeg', [record()]), /asset credits/);
  const noticed = appendExportNotices(jpeg, 'image/jpeg', [record()]), broken = noticed.slice(); broken[2 + 4 + 'Stencil Asset Notices '.length] = 51;
  assert.throws(() => appendExportNotices(broken, 'image/jpeg', []), /asset credits/);
});

test('PDF pages retain the JPEG copyright COM bytes inside their unchanged image streams', () => {
  const noticed = appendExportNotices(jpeg, 'image/jpeg', [record('fluent')]);
  const pdf = buildPDF([{ width: 640, height: 480, jpeg: noticed }]);
  assert.ok(Buffer.from(pdf).includes(Buffer.from(noticed)));
  assert.ok(Buffer.from(pdf).includes(Buffer.from('Copyright (c) Microsoft Corporation.')));
});

test('editing image pixels retains their notices, including the background-removal PNG download', () => {
  const original = element(embedAssetNotice(image(), record('fluent'))).src, newImage = element(image()).src;
  const result = preserveAssetNoticesDataURI(original, newImage);
  assert.deepEqual(collectAssetNotices([{ type: 'image', src: result }]), [record('fluent')]);
  const pixelBytes = chunks(Buffer.from(result.slice(22), 'base64')).find(item => item.type === 'IDAT').data;
  assert.deepEqual(inflateSync(pixelBytes), Buffer.from([0, 231, 64, 132, 255]));
  assert.equal(preserveAssetNoticesDataURI(newImage, newImage), newImage);
  assert.throws(() => preserveAssetNoticesDataURI(original, 'data:image/jpeg;base64,/9j/2Q=='), /asset credits/);
  assert.throws(() => preserveAssetNoticesDataURI(original, 'data:image/png;base64,aGVsbG8='), /asset credits/);
});

test('licence notices retained inside a native photo frame reach artwork and export metadata',()=>{const bytes=embedAssetNotice(image(),record('fluent','fluent-fixture','Fictional sticker')),framed={type:'frame',src:element(bytes).src};assert.deepEqual(collectAssetNotices([framed]),[record('fluent','fluent-fixture','Fictional sticker')]);assert.match(assetMetadataXML([framed]),/Fictional sticker/);assert.equal(assetCredits([framed]).length,1);});
