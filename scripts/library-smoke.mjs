import { readCommittedJSON } from './stored-design-smoke.mjs';

/** Saved-design association follows Undo/Redo; opening another design keeps edits. */
export async function smokeLibrary({browser,expect,errors,output,resolve,url}) {
  const context=await browser.newContext({viewport:{width:1440,height:960},locale:'en-GB'}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const library=()=>readCommittedJSON(page, 'stencil-studio.library.v1');
  const save=async(name,copy=false)=>{await page.locator('#open-designs').click();if(copy)await page.locator('#library-save-copy').click();else{if(!await page.locator('#file-menu').evaluate(node=>node.open))await page.locator('#file-menu>summary').click();await page.locator('#save-to-library').click();}await page.locator('#design-name').fill(name);await page.locator('#design-name-save').click();await expect(page.locator('#design-name-dialog')).not.toBeVisible();};
  try {
    await page.goto(url,{waitUntil:'networkidle'});await page.locator('#add-rectangle').click();await save('Alpha');
    const alpha=(await library()).designs.find(record=>record.name==='Alpha'),original=alpha.document;
    await page.locator('#elements-tab').click();await page.locator('#add-circle').click();await save('Beta',true);
    const beta=(await library()).designs.find(record=>record.name==='Beta');
    await page.locator(`[data-open-design="${alpha.id}"]`).click();await expect(page.locator('#document-title')).toHaveValue('Alpha');
    // Saving the history restored by Undo must update Beta's ID, never Alpha's.
    await page.locator('#undo').click();await expect(page.locator('#document-title')).toHaveValue('Beta');await save('Beta');
    let records=(await library()).designs;expect(records).toHaveLength(2);expect(records.find(record=>record.id===alpha.id).document).toEqual(original);expect(records.find(record=>record.id===beta.id).name).toBe('Beta');
    await page.locator('#redo').click();await expect(page.locator('#document-title')).toHaveValue('Alpha');
    await page.locator('#elements-tab').click();await page.locator('#add-text').click();await page.locator('#open-designs').click();await page.locator(`[data-open-design="${beta.id}"]`).click();await expect(page.locator('#document-title')).toHaveValue('Beta');
    records=(await library()).designs;expect(records.find(record=>record.id===alpha.id).document.pages[0].elements).toHaveLength(2);
    await page.reload({waitUntil:'networkidle'});await page.locator('#open-designs').click();await expect(page.locator(`[data-saved-id="${beta.id}"]`)).toHaveClass(/current-design/);
    await page.screenshot({path:resolve(output,'saved-design-association.png'),fullPage:true});
  } finally {await context.close();}
}
