import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPDF } from '../src/export.js';
import { PDF_TEXT_LIMITS, validatePDFTextRuns, collectPDFTextRuns } from '../src/pdf-text.js';
import { createPage } from '../src/model.js';

// Text extraction does not need to decode the browser's opaque JPEG artwork.
const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 217]);
const run = (text = 'A useful design') => ({ text, fontSize: 24, width: [...text].length * 12, matrix: [1, 0, 0, 1, 36, 48] });
const output = textRuns => buildPDF([{ width: 720, height: 960, jpeg, textRuns }]);

test('old image-only API stays byte-identical with an empty search layer', () => {
  assert.deepEqual(buildPDF([{ width: 720, height: 960, jpeg }]), output([]));
});
test('positioned text accepts finite rotated or flipped matrices and measured Unicode advances', () => {
  const data = [{ ...run('é🐾'), matrix: [-.8, .6, .6, .8, 350, 400], advances: [8, 16] }];
  assert.deepEqual(validatePDFTextRuns(data), data);
  assert.ok(output(data).byteLength > output([]).byteLength);
  assert.deepEqual(data[0].advances, [8, 16]);
});
test('search layer preserves PDF object offsets after Unicode CMap streams', () => {
  const pdf = output([run('Café 東京 🐾')]);
  const text = new TextDecoder().decode(pdf), start = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(pdf.slice(start, start + 4)), 'xref');
  const xref = text.slice(start).split('\n'), size = Number(xref[1].split(' ')[1]);
  for (let index = 1; index < size; index++) {
    const offset = Number(xref[index + 2].slice(0, 10));
    assert.match(new TextDecoder().decode(pdf.slice(offset, offset + 20)), new RegExp(`^${index} 0 obj\\n`));
  }
});
test('untrusted text stays hex-encoded rather than becoming PDF actions or executable tokens', () => {
  const pdf = new TextDecoder().decode(output([run(') /JS (alert) <script> & \\ endstream')]));
  assert.doesNotMatch(pdf, /\/JS|<script>|alert/);
});
test('optional text boundary rejects sparse arrays, poisoned fields and invalid transforms', () => {
  for (const invalid of [null, {}, [null], Array(1), [{ ...run(), extra: 'unknown' }], [{ ...run(), width: NaN }], [{ ...run(), fontSize: Infinity }], [{ ...run(), matrix: [0, 0, 0, 0, 0, 0] }], [{ ...run(), matrix: [1, 0, 0, 1, 65537, 0] }], [{ ...run(), matrix: Array(6) }], [{ ...run(), advances: [1] }], [{ ...run('é'), advances: [0] }]]) assert.throws(() => output(invalid));
  for (const text of ['bad\u0000text', 'bad\u001ftext', 'bad\u007ftext', '\uD800', '\uDC00', '\uD800A', 'two\nlines', 'a\tb', '']) assert.throws(() => output([run(text)]));
});
test('search layer applies bounded page/run/document limits', () => {
  assert.throws(() => output(Array.from({ length: PDF_TEXT_LIMITS.runsPerPage + 1 }, () => run())));
  assert.throws(() => output([run('x'.repeat(PDF_TEXT_LIMITS.charactersPerRun + 1))]));
  assert.throws(() => output(Array.from({ length: 11 }, () => ({ ...run('x'.repeat(10000)), width: 1000 }))));
  const textRuns = Array.from({ length: 10 }, () => ({ ...run('x'.repeat(10000)), width: 1000 }));
  assert.throws(() => buildPDF(Array.from({ length: 6 }, () => ({ width: 720, height: 960, jpeg, textRuns }))));
});
test('empty artwork can collect no text without a browser, but rejects invalid pages before DOM work', () => {
  assert.deepEqual(collectPDFTextRuns(createPage()), []);
  assert.throws(() => collectPDFTextRuns({ ...createPage(), width: NaN }));
});

const hasTextReader = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).status === 0;
test('real Poppler extracts searchable Latin, CJK, emoji and literal punctuation across pages', { skip: !hasTextReader && 'pdftotext is optional on this machine; browser PDF extraction is checked separately.' }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'stencil-pdf-text-'));
  try {
    const path = join(folder, 'design.pdf');
    const lines = ['Café naïve — 東京 🐾', 'Round (brackets) <angle> \\ / slash', 'Crème brûlée'];
    await writeFile(path, buildPDF([
      { width: 720, height: 960, jpeg, textRuns: [run(lines[0]), { ...run(lines[1]), matrix: [1, 0, 0, 1, 36, 96] }] },
      { width: 960, height: 720, jpeg, textRuns: [run(lines[2])] }
    ]));
    const result = spawnSync('pdftotext', ['-enc', 'UTF-8', '-raw', path, '-'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    for (const line of lines) assert.ok(result.stdout.includes(line), JSON.stringify({ expected: line, actual: result.stdout }));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
