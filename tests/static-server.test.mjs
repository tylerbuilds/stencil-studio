import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
test('static server rejects traversal, hidden files and both internal and external symlink aliases',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'oss-static-security-')),root=join(directory,'site');
  await mkdir(join(root,'public'),{recursive:true});await mkdir(join(root,'src'));
  await writeFile(join(root,'index.html'),'Original public app');
  await writeFile(join(root,'public','safe.json'),'{"safe":true}');
  await writeFile(join(root,'src','module.mjs'),'export const original=true;');
  await writeFile(join(root,'.env'),'SYNTHETIC_PRIVATE_MARKER');
  await writeFile(join(directory,'outside.json'),'SYNTHETIC_EXTERNAL_MARKER');
  await symlink(join(directory,'outside.json'),join(root,'public','outside.json'));
  await symlink(join(root,'.env'),join(root,'public','internal.json'));
  await symlink(directory,join(root,'public','directory'));
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['scripts/serve.mjs','--dir',root,'--port',String(port)],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
  try {
    const base=`http://127.0.0.1:${port}`;
    let ready=false;
    for(let i=0;i<50;i++) { try { if((await fetch(base)).ok){ready=true;break;} }catch{}await new Promise(resolve=>setTimeout(resolve,40)); }
    assert.ok(ready,output);
    assert.equal(await(await fetch(base+'/public/safe.json')).text(),'{"safe":true}');
    const module=await fetch(base+'/src/module.mjs');assert.equal(module.status,200);assert.match(module.headers.get('Content-Type'),/javascript/);
    for(const path of ['/public/outside.json','/public/internal.json','/public/directory/outside.json','/.env','/.git/config','/public/%2e%2e/.env']) {
      const response=await fetch(base+path);assert.equal(response.status,404,path);assert.doesNotMatch(await response.text(),/SYNTHETIC_/);
    }
    assert.equal((await fetch(base+'/public/safe.json',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/%00')).status,404);
    assert.equal(await(await fetch(base+'/',{method:'HEAD'})).text(),'');
  } finally {
    if(child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}
    await rm(directory,{recursive:true,force:true});
  }
});
