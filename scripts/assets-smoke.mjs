import { readCommittedJSON } from './stored-design-smoke.mjs';

export async function smokeAssets({ browser, expect, errors, output, readFile, resolve, url }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-GB', acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect(page.locator('#artboard [data-element-id]')).toHaveCount(0);
    await page.locator('#assets-tab').click();
    await expect(page.locator('#asset-grid [data-asset-id]').first()).toBeVisible();
    await page.locator('#asset-collection').selectOption('tabler');
    await page.locator('#asset-search').fill('coffee');
    await expect(page.locator('#asset-status')).toContainText('found');
    await page.locator('#asset-grid [data-asset-id]').first().click();
    await expect(page.locator('#artboard [data-element-id]')).toHaveCount(1);
    const read = () => readCommittedJSON(page, 'stencil-studio.document.v1');
    const saved = await read();
    expect(saved.pages[0].elements[0].src).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(saved.pages[0].elements[0].src.split(',')[1], 'base64').toString('latin1')).toContain('Stencil Asset Notices');
    await page.reload({ waitUntil: 'networkidle' });
    expect(await read()).toEqual(saved);
    await page.locator('#download-menu>summary').click();
    const pending = page.waitForEvent('download'); await page.locator('#export-png').click();
    const item = await pending; expect(await item.failure()).toBeNull();
    const path = resolve(output, 'asset-library.png'); await item.saveAs(path);
    const png = await readFile(path);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.toString('latin1')).toContain('Stencil Asset Notices');
  } finally { await context.close(); }
}
