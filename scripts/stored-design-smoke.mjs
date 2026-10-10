import { expect } from '@playwright/test';

/** Read the actual committed IndexedDB row after the editor reports a save. */
export async function readCommittedJSON(page, key) {
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
  return page.evaluate(async key => {
    const name = 'stencil-studio.local-designs';
    if (!(await indexedDB.databases()).some(database => database.name === name && database.version === 1)) throw new Error('The committed design database is missing.');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Read-only evidence must not create design storage.')); };
    });
    try {
      const raw = await new Promise((resolve, reject) => {
        const transaction = database.transaction('records', 'readonly');
        const request = transaction.objectStore('records').get(key);
        let value;
        request.onsuccess = () => { value = request.result?.value; };
        transaction.oncomplete = () => resolve(value);
        transaction.onabort = () => reject(transaction.error || new Error('The committed design could not be read.'));
      });
      if (typeof raw !== 'string') throw new Error('The committed design record is missing.');
      return JSON.parse(raw);
    } finally { database.close(); }
  }, key);
}
