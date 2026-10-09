import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const output = resolve('dist');
await rm(output, {recursive:true, force:true});
await mkdir(output, {recursive:true});
for (const input of ['index.html','styles.css','src','public','manifest.json','sw.js']) {
  try { await stat(input); await cp(input, resolve(output, input), {recursive:true}); }
  catch (error) { if (error.code !== 'ENOENT') throw error; if (['index.html','styles.css','src'].includes(input)) throw error; }
}
console.log('Static app built in dist/');
