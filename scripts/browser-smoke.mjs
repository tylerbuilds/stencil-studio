import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const {name} = JSON.parse(await readFile('package.json', 'utf8'));
const port = 4322;
const server = spawn(process.execPath, ['scripts/serve.mjs', '--dir', 'dist', '--port', String(port)], {stdio:['ignore','pipe','pipe']});
let serverOutput = '';
server.stdout.on('data', chunk => {serverOutput += chunk});
server.stderr.on('data', chunk => {serverOutput += chunk});
const output = resolve('test-results/browser-smoke');
await mkdir(output, {recursive:true});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {ready = (await fetch(`http://127.0.0.1:${port}/`)).ok} catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready || server.exitCode !== null) throw new Error(`Preview server failed: ${serverOutput}`);
  browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:960},locale:'en-GB'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())});
  const response = await page.goto(`http://127.0.0.1:${port}/`, {waitUntil:'networkidle'});
  expect(response.status()).toBe(200);
  const download = async (selector, filename) => {
    const pending = page.waitForEvent('download');
    await page.locator(selector).click();
    const file = await pending;
    expect(await file.failure()).toBeNull();
    const path = resolve(output, filename); await file.saveAs(path); return readFile(path);
  };
  if (name === 'clearcv') {
    await page.locator('#profile-name').fill('Avery Test');
    await expect(page.locator('#cv-preview .cv-name')).toHaveText('Avery Test');
    await page.locator('#tab-design').click();
    await page.locator('#template-classic').click();
    await expect(page.locator('#cv-preview')).toHaveClass(/template-classic/);
    await page.reload();
    await expect(page.locator('#cv-preview .cv-name')).toHaveText('Avery Test');
    const saved = JSON.parse((await download('#export-json','cv.json')).toString());
    expect(saved.profile.name).toBe('Avery Test');
    expect(saved.style.template).toBe('classic');
    const pdf = await page.pdf({path:resolve(output,'cv.pdf'),format:'A4',printBackground:true});
    expect(pdf.subarray(0,4).toString()).toBe('%PDF');
  } else if (name === 'stencil-studio') {
    await page.locator('#document-title').fill('Avery design');
    await page.locator('#document-title').press('Tab');
    await page.locator('#elements-tab').click();
    const before = await page.locator('[data-element-id]').count();
    await page.locator('#add-rectangle').click();
    await expect(page.locator('[data-element-id]')).toHaveCount(before + 1);
    await page.locator('#undo').click();
    await expect(page.locator('[data-element-id]')).toHaveCount(before);
    await page.locator('#redo').click();
    await expect(page.locator('[data-element-id]')).toHaveCount(before + 1);
    await page.reload();
    await expect(page.locator('#document-title')).toHaveValue('Avery design');
    const svg = (await download('#export-svg','design.svg')).toString();
    expect(svg).toMatch(/<svg[^>]+xmlns=/);
    const png = await download('#export-png','design.png');
    expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    const saved = JSON.parse((await download('#save-document','design.json')).toString());
    expect(saved.title).toBe('Avery design');
  } else if (name === 'petrealm') {
    await page.locator('#pet-name').fill('Aster');
    await page.locator('#adopt-button').click();
    await expect(page.locator('#adoption-dialog')).not.toBeVisible();
    await expect(page.locator('#pet-profile')).toContainText('Aster');
    await page.locator('#daily-reward').click();
    await expect(page.locator('#daily-reward')).toBeDisabled();
    await page.reload();
    await expect(page.locator('#pet-profile')).toContainText('Aster');
    await expect(page.locator('#daily-reward')).toBeDisabled();
    await page.locator('#save-button').click();
    const saved = JSON.parse((await download('#export-save','petrealm.json')).toString());
    expect(saved.version).toBe(1);
    expect(saved.pet.name).toBe('Aster');
  } else throw new Error(`Unknown app: ${name}`);
  await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
  expect(errors, 'browser errors').toEqual([]);
  console.log(`${name}: built-app edit, persistence and export browser smoke passed`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
