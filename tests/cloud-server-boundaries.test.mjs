import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('shared data cannot become a public asset through an outside symlink ancestor',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'oss-cloud-boundary-')),site=join(directory,'site'),alias=join(directory,'outside-alias');
  await mkdir(join(site,'public'),{recursive:true});await writeFile(join(site,'index.html'),'Original synthetic app');
  await symlink(join(site,'public'),alias);
  const child=spawn(process.execPath,['scripts/serve.mjs','--dir',site,'--data-dir',join(alias,'store'),'--port','44321'],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let output='',timer;child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
  try {
    const [code]=await Promise.race([once(child,'exit'),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Unsafe data configuration started a server.')),3000);})]);
    assert.notEqual(code,0);assert.match(output,/Keep shared data outside/);
    assert.deepEqual(await readdir(join(site,'public','store')),[]);
  } finally {
    clearTimeout(timer);
    if(child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}
    await rm(directory,{recursive:true,force:true});
  }
});
