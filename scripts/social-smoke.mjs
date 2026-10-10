/** Native social journeys in a separate browser context; fictional local data. */
import { readFile, writeFile } from 'node:fs/promises';
import { buildAgentDesign } from '../src/agent-design.js';
import { serialiseDocument } from '../src/model.js';
import { readCommittedJSON } from './stored-design-smoke.mjs';

function archiveEntries(bytes, expect) {
  const entries = []; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), start = offset + 30 + nameLength + extraLength;
    entries.push({ name, bytes: bytes.subarray(start, start + length) }); offset = start + length;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
  expect(bytes.readUInt16LE(bytes.length - 12)).toBe(entries.length);
  return entries;
}

function damagePNGData(bytes) {
  const damaged = Buffer.from(bytes); let offset = 8, changed = 0;
  while (offset + 12 <= damaged.length) {
    const length = damaged.readUInt32BE(offset), end = offset + 12 + length;
    if (end > damaged.length) throw new Error('The original test PNG is incomplete.');
    if (damaged.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      damaged.fill(0, offset + 8, end - 4);
      let crc = 0xffffffff;
      for (const byte of damaged.subarray(offset + 4, end - 4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
      }
      damaged.writeUInt32BE((crc ^ 0xffffffff) >>> 0, end - 4); changed++;
    }
    offset = end;
  }
  if (!changed) throw new Error('The original test PNG has no image data.');
  return damaged;
}

export async function smokeSocial({ browser, expect, errors, output, resolve, url }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-GB' }), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const state = () => readCommittedJSON(page, 'stencil-studio.document.v1');
  const click = async selector => {
    const target = page.locator(selector), menu = await target.evaluate(node => node.closest('details')?.id || null);
    if (menu && !await page.locator(`#${menu}`).evaluate(node => node.open)) await page.locator(`#${menu}>summary`).click();
    await target.click();
  };
  const download = async (selector, name) => {
    const pending = page.waitForEvent('download'); await click(selector); const file = await pending;
    expect(await file.failure()).toBeNull(); const path = resolve(output, name); await file.saveAs(path); return { bytes: await readFile(path), name: file.suggestedFilename() };
  };
  const pixels = async (bytes, mime) => page.evaluate(async ({ data, mime }) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(data)], { type: mime }));
    try { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return { width: image.width, height: image.height, corner: [...context.getImageData(0, 0, 1, 1).data] }; } finally { image.close(); }
  }, { data: [...bytes], mime });
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect(page.locator('#artboard')).toHaveAttribute('width', '1080'); await expect(page.locator('#artboard')).toHaveAttribute('height', '1080');
    await page.locator('#new-design').click(); await expect(page.locator('#new-preset')).toHaveValue('social');
    await page.locator('#new-title').fill('Social smoke portrait'); await page.locator('#new-preset').selectOption('portrait');
    await expect(page.locator('#new-width')).toHaveValue('1080'); await expect(page.locator('#new-height')).toHaveValue('1350');
    await page.locator('#new-background').fill('#2b594a'); await page.locator('#create-new-design').click();
    await expect(page.locator('#new-design-dialog')).not.toBeVisible(); expect((await state()).pages[0].elements).toHaveLength(0);
    await click('#export-images'); await page.locator('#image-export-transparent').check();
    const png = await download('#image-export-submit', 'social-current.png'), decodedPNG = await pixels(png.bytes, 'image/png');
    expect(decodedPNG).toEqual({ width: 1080, height: 1350, corner: [0, 0, 0, 0] }); expect(png.name).toBe('social-smoke-portrait-page-1.png');
    expect((await state()).pages[0].transparentBackground).toBe(false);
    await expect(page.locator('#image-export-submit')).toBeEnabled(); await page.locator('#image-export-format').selectOption('jpeg');
    const jpg = await download('#image-export-submit', 'social-current.jpg'), decodedJPG = await pixels(jpg.bytes, 'image/jpeg');
    expect([decodedJPG.width, decodedJPG.height]).toEqual([1080, 1350]); expect(decodedJPG.corner[3]).toBe(255);
    for (const [index, value] of [43, 89, 74].entries()) expect(Math.abs(decodedJPG.corner[index] - value)).toBeLessThanOrEqual(3);
    await page.locator('[data-close="image-export-dialog"]').click();

    await page.locator('#templates-tab').click(); await page.locator('#template-category').selectOption('posts'); await page.locator('#template-search').fill('carousel');
    await expect(page.locator('#templates [data-template]')).toHaveCount(1); await page.locator('[data-template="social-carousel"]').click();
    await expect(page.locator('#document-title')).toHaveValue('A photo walk');
    await expect.poll(async () => (await state()).pages.map(page => page.name)).toEqual(['Cover', 'Colour', 'Details', 'Light', 'Your turn']);
    const carousel = await state(), headline = carousel.pages[0].elements.find(element => element.type === 'text' && element.text.startsWith('Three ways'));
    await page.locator(`[data-select="${headline.id}"]`).click(); await page.locator('[data-property="text"]').fill('Three ideas for a good photo.'); await page.locator('[data-property="text"]').press('Tab');
    await expect.poll(async () => (await state()).pages[0].elements.find(element => element.id === headline.id).text).toBe('Three ideas for a good photo.');
    await click('#export-images'); await expect(page.locator('#image-export-scope')).toHaveValue('all');
    const zipPNG = await download('#image-export-submit', 'social-carousel-png.zip'), pngPages = archiveEntries(zipPNG.bytes, expect);
    expect(pngPages.map(entry => entry.name)).toEqual(['01-cover.png', '02-colour.png', '03-details.png', '04-light.png', '05-your-turn.png']);
    for (const entry of pngPages) { const image = await pixels(entry.bytes, 'image/png'); expect([image.width, image.height]).toEqual([1080, 1350]); }
    await expect(page.locator('#image-export-submit')).toBeEnabled(); await page.locator('#image-export-format').selectOption('jpeg');
    const zipJPG = await download('#image-export-submit', 'social-carousel-jpg.zip'), jpgPages = archiveEntries(zipJPG.bytes, expect);
    expect(jpgPages.map(entry => entry.name)).toEqual(['01-cover.jpg', '02-colour.jpg', '03-details.jpg', '04-light.jpg', '05-your-turn.jpg']);
    for (const entry of jpgPages) { const image = await pixels(entry.bytes, 'image/jpeg'); expect([image.width, image.height]).toEqual([1080, 1350]); }
    await page.locator('[data-close="image-export-dialog"]').click();

    const request = JSON.parse(await readFile('examples/agent-design/social-post.json', 'utf8')), generated = buildAgentDesign(request);
    const designPath = resolve(output, 'agent-consumer.stencil.json'); await writeFile(designPath, serialiseDocument(generated));
    await page.locator('#document-input').setInputFiles(designPath); await expect(page.locator('#document-title')).toHaveValue(generated.title);
    await expect.poll(async () => (await state()).pages[0].elements.map(element => element.id)).toEqual(generated.pages[0].elements.map(element => element.id));
    const text = generated.pages[0].elements.find(element => element.type === 'text'); await page.locator(`[data-select="${text.id}"]`).click();
    await page.locator('[data-property="text"]').fill('CEDAR STREET — NEW CHAPTER'); await page.locator('[data-property="text"]').press('Tab');
    await expect.poll(async () => (await state()).pages[0].elements.find(element => element.id === text.id).text).toBe('CEDAR STREET — NEW CHAPTER');
    const svg = (await download('#export-svg', 'agent-consumer.svg')).bytes.toString(); expect(svg).toContain('CEDAR STREET — NEW CHAPTER');
    const agentPNG = await download('#export-png', 'agent-consumer.png'), agentImage = await pixels(agentPNG.bytes, 'image/png'); expect([agentImage.width, agentImage.height]).toEqual([1080, 1080]);
    await page.reload({ waitUntil: 'networkidle' }); expect((await state()).pages[0].elements.find(element => element.id === text.id).text).toBe('CEDAR STREET — NEW CHAPTER');
    // A valid header must not let unreadable photo pixels disappear from exports.
    const originalPNG = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 72; canvas.height = 48;
      const context = canvas.getContext('2d'); context.fillStyle = '#d76548'; context.fillRect(0, 0, 72, 48);
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    const damagedPhoto = `data:image/png;base64,${damagePNGData(originalPNG).toString('base64')}`;
    const refused = await page.evaluate(async source => {
      const { createPage, createElement, pageSVG } = await import('./src/model.js');
      const { renderPageRaster } = await import('./src/raster-export.js');
      const canvas = createPage(72, 64, 'Damaged photo test');
      canvas.elements = [createElement('image', { src: source, sourceWidth: 72, sourceHeight: 48 })];
      pageSVG(canvas); // Plausible geometry and image headers remain model-valid.
      try { await renderPageRaster(canvas); return null; } catch (error) { return error.message; }
    }, damagedPhoto);
    expect(refused).toMatch(/photo.*could not be read/);
    await page.screenshot({ path: resolve(output, 'social-agent-editor.png'), fullPage: true });
  } finally { await context.close(); }
}
