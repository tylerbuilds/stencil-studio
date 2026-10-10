/** Original PDF writer: JPEG artwork with optional positioned Unicode text. No remote services. */
import { PDF_TEXT_LIMITS, validatePDFTextRuns } from './pdf-text.js';
const encoder = new TextEncoder();
const bytes = value => typeof value === 'string' ? encoder.encode(value) : value;
const number = value => Number(value.toFixed(5));
const hex = value => value.toString(16).toUpperCase().padStart(4, '0');
const unicodeHex = value => Array.from({ length: value.length }, (_, index) => hex(value.charCodeAt(index))).join('');
export function buildPDF(pages) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 30) throw new Error("Export 1 to 30 pages as a PDF.");
  for (let index = 0; index < pages.length; index++) if (!Object.hasOwn(pages, index) || !pages[index] || typeof pages[index] !== 'object') throw new Error("Every PDF page must contain artwork. Export the pages again.");
  const prepared = [], glyphs = [], glyphIds = new Map(); let characters = 0;
  for (const page of pages) {
    const { width, height, jpeg } = page;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64 || width > 4096 || height > 4096 || !(jpeg instanceof Uint8Array) || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) throw new Error('Each PDF page needs a valid JPEG image and dimensions between 64 and 4,096 pixels.');
    const textRuns = validatePDFTextRuns(page.textRuns);
    const encodedRuns = textRuns.map(run => {
      let encoded = '';
      [...run.text].forEach((character, index) => {
        if (++characters > PDF_TEXT_LIMITS.charactersPerDocument) throw new Error('This PDF has too much text. Export fewer pages.');
        const advance = number(run.advances[index] / run.fontSize * 1000), key = `${character}\u0000${advance}`;
        let cid = glyphIds.get(key);
        if (cid === undefined) {
          if (glyphs.length >= PDF_TEXT_LIMITS.glyphsPerDocument) throw new Error('This PDF has too many distinct text positions. Export fewer pages.');
          cid = glyphs.length + 1; glyphIds.set(key, cid); glyphs.push({ character, advance });
        }
        encoded += hex(cid);
      });
      return { ...run, encoded };
    });
    prepared.push({ width, height, jpeg, textRuns: encodedRuns });
  }
  const chunks = [], offsets = [0]; let length = 0;
  const write = value => { const chunk = bytes(value); chunks.push(chunk); length += chunk.byteLength; if (length > 100 * 1024 * 1024) throw new Error("This PDF is over 100 MB. Export fewer pages."); };
  const object = (index, content) => { offsets[index] = length; write(`${index} 0 obj\n`); write(content); write('\nendobj\n'); };
  write('%PDF-1.4\n%'); write(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3])); write('\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  const fontIndex = pages.length * 3 + 3;
  prepared.forEach((page, index) => {
    const { width, height, jpeg, textRuns } = page;
    const pageIndex = 3 + index * 3, contentIndex = pageIndex + 1, imageIndex = pageIndex + 2;
    const pw = Number((width * .75).toFixed(3)), ph = Number((height * .75).toFixed(3));
    object(pageIndex, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Artwork ${imageIndex} 0 R >>${textRuns.length ? ` /Font << /SearchableText ${fontIndex} 0 R >>` : ''} >> /Contents ${contentIndex} 0 R >>`);
    let content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Artwork Do\nQ\n`;
    for (const run of textRuns) {
      const [a, b, c, d, x, y] = run.matrix;
      content += `BT\n/SearchableText ${number(run.fontSize * .75)} Tf\n3 Tr\n${[a, -b, -c, d, x * .75, (height - y) * .75].map(number).join(' ')} Tm\n<${run.encoded}> Tj\nET\n`;
    }
    object(contentIndex, `<< /Length ${bytes(content).byteLength} >>\nstream\n${content}endstream`);
    offsets[imageIndex] = length;
    write(`${imageIndex} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(width)} /Height ${Math.round(height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`);
    write(jpeg); write('\nendstream\nendobj\n');
  });
  if (glyphs.length) {
    // An invisible CID font supplies exact Unicode and measured character advances.
    // Visible artwork remains the browser-rendered image, so no font substitution
    // changes the design. This is a search layer, not a tagged or vector PDF.
    object(fontIndex, `<< /Type /Font /Subtype /Type0 /BaseFont /StencilSearch /Encoding /Identity-H /DescendantFonts [${fontIndex + 1} 0 R] /ToUnicode ${fontIndex + 3} 0 R >>`);
    object(fontIndex + 1, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /StencilSearch /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontIndex + 2} 0 R /DW 1000 /W [1 [${glyphs.map(glyph => glyph.advance).join(' ')}]] /CIDToGIDMap /Identity >>`);
    object(fontIndex + 2, '<< /Type /FontDescriptor /FontName /StencilSearch /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>');
    let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /StencilUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let offset = 0; offset < glyphs.length; offset += 100) {
      const group = glyphs.slice(offset, offset + 100);
      cmap += `${group.length} beginbfchar\n${group.map((glyph, index) => `<${hex(offset + index + 1)}> <${unicodeHex(glyph.character)}>`).join('\n')}\nendbfchar\n`;
    }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
    object(fontIndex + 3, `<< /Length ${bytes(cmap).byteLength} >>\nstream\n${cmap}endstream`);
  }
  const start = length, size = pages.length * 3 + 3 + (glyphs.length ? 4 : 0);
  write(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let index = 1; index < size; index++) write(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  const result = new Uint8Array(length); let cursor = 0; for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.byteLength; }
  return result;
}
