import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPDF } from '../src/export.js';
// The writer treats JPEG contents as an opaque browser-rendered byte stream.
const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 217]);
test('PDF has real page objects, bounded dimensions, binary lengths and correct xref byte offsets', () => {
  const output = buildPDF([{ width: 720, height: 960, jpeg }, { width: 1080, height: 1080, jpeg }]);
  const pdf = new TextDecoder('latin1').decode(output);
  assert.ok(pdf.startsWith('%PDF-1.4')); assert.match(pdf, /\/Count 2/); assert.match(pdf, /\/MediaBox \[0 0 540 720\]/);
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(output.slice(xref, xref + 4)), 'xref');
  const lines = pdf.slice(pdf.indexOf('xref\n')).split('\n').slice(3, 11);
  lines.forEach((line, i) => { const offset = Number(line.slice(0, 10)); assert.equal(new TextDecoder().decode(output.slice(offset, offset + 7)).startsWith(`${i + 1} 0 obj`), true); });
});
test('PDF rejects empty, oversized or non-image inputs', () => {
  assert.throws(() => buildPDF([]));
  assert.throws(() => buildPDF([{ width: 5000, height: 1000, jpeg }]));
  assert.throws(() => buildPDF([{ width: 720, height: 960, jpeg: new Uint8Array([1, 2]) }]));
});
