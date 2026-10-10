/** Original PDF writer: embeds locally rendered JPEG pages; no scripts, URLs or remote services. */
const encoder = new TextEncoder();
const bytes = value => typeof value === 'string' ? encoder.encode(value) : value;
export function buildPDF(pages) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 30) throw new Error("Export 1 to 30 pages as a PDF.");
  const chunks = [], offsets = [0]; let length = 0;
  const write = value => { const chunk = bytes(value); chunks.push(chunk); length += chunk.byteLength; if (length > 100 * 1024 * 1024) throw new Error("This PDF is over 100 MB. Export fewer pages."); };
  const object = (index, content) => { offsets[index] = length; write(`${index} 0 obj\n`); write(content); write('\nendobj\n'); };
  write('%PDF-1.4\n%'); write(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3])); write('\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((page, index) => {
    const { width, height, jpeg } = page;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64 || width > 4096 || height > 4096 || !(jpeg instanceof Uint8Array) || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) throw new Error("Each PDF page needs a valid JPEG image and dimensions between 64 and 4,096 pixels.");
    const pageIndex = 3 + index * 3, contentIndex = pageIndex + 1, imageIndex = pageIndex + 2;
    const pw = Number((width * .75).toFixed(3)), ph = Number((height * .75).toFixed(3));
    object(pageIndex, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Artwork ${imageIndex} 0 R >> >> /Contents ${contentIndex} 0 R >>`);
    const content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Artwork Do\nQ\n`;
    object(contentIndex, `<< /Length ${bytes(content).byteLength} >>\nstream\n${content}endstream`);
    offsets[imageIndex] = length;
    write(`${imageIndex} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(width)} /Height ${Math.round(height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`);
    write(jpeg); write('\nendstream\nendobj\n');
  });
  const start = length, size = pages.length * 3 + 3;
  write(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let index = 1; index < size; index++) write(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  const result = new Uint8Array(length); let cursor = 0; for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.byteLength; }
  return result;
}
