import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {loadAiConfig,createAiHandler} from '../scripts/ai.mjs';
async function serverTest(config,provider,action) {
  const handler=createAiHandler(config,{fetchImpl:provider,timeoutMs:1000});
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try { await action(base); } finally { await new Promise(resolve=>server.close(resolve)); }
}
const valid={task:'summary',content:'Designer with six years of experience.',context:'Public services'};
const headers={'Content-Type':'application/json','X-Local-Workspace':'1'};
test('AI configuration is disabled by default and rejects credentials in URLs or insecure remote endpoints',async()=>{
  assert.deepEqual(await loadAiConfig([],{}),{enabled:false});
  await assert.rejects(loadAiConfig([],{AI_BASE_URL:'http://public.example/v1',AI_MODEL:'test'}),/HTTPS/);
  await assert.rejects(loadAiConfig([],{AI_BASE_URL:'https://key:secret@example.com/v1',AI_MODEL:'test'}),/embedded credentials/);
  const config=await loadAiConfig([],{AI_BASE_URL:'http://127.0.0.1:8000/v1/',AI_MODEL:'test',AI_API_KEY:'test-private-key'});
  assert.equal(config.baseUrl,'http://127.0.0.1:8000/v1');
});
test('disabled bridge performs no provider calls and does not expose configuration',async()=>{
  await serverTest({enabled:false,apiKey:'never-expose'},()=>{throw new Error('Unexpected call');},async base=>{
    const status=await(await fetch(base+'/api/ai/status')).json();assert.deepEqual(status,{enabled:false});
    const response=await fetch(base+'/api/ai',{method:'POST',headers,body:JSON.stringify(valid)});
    assert.equal(response.status,503); assert.ok(!(await response.text()).includes('never-expose'));
  });
});
test('bridge rejects cross-origin, invalid tasks and oversized requests before inference',async()=>{
  await serverTest({enabled:true,model:'test'},()=>{throw new Error('Unexpected call');},async base=>{
    let response=await fetch(base+'/api/ai',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:JSON.stringify(valid)});
    assert.equal(response.status,403);
    for(const request of [{...valid,task:'__proto__'},{...valid,content:'x'.repeat(16001)},{...valid,secret:'unexpected'},{task:'translate',content:'Hello'}]) {
      response=await fetch(base+'/api/ai',{method:'POST',headers,body:JSON.stringify(request)});assert.equal(response.status,400);
    }
  });
});
test('actual protocol forwards only selected text and returns a review candidate without leaking credentials',async()=>{
  let calls=0;
  await serverTest({enabled:true,baseUrl:'http://local.test/v1',model:'test-model',apiKey:'native-private-key'},async(url,options)=>{
    calls++; assert.equal(url,'http://local.test/v1/chat/completions'); assert.equal(options.headers.Authorization,'Bearer native-private-key');
    const request=JSON.parse(options.body);assert.equal(request.model,'test-model');
    assert.deepEqual(JSON.parse(request.messages[1].content),{source:valid.content,context:valid.context,targetLanguage:''});
    assert.match(request.messages[0].content,/Never invent/);
    return new Response(JSON.stringify({choices:[{message:{content:'A clear review candidate.'}}]}));
  },async base=>{
    const response=await fetch(base+'/api/ai',{method:'POST',headers,body:JSON.stringify(valid)});assert.equal(response.status,200);
    const text=await response.text(); assert.ok(!text.includes('native-private-key'));
    assert.deepEqual(JSON.parse(text),{text:'A clear review candidate.',model:'test-model'});
  });assert.equal(calls,1);
});
test('provider failures are redacted and a failed generation releases the concurrency guard',async()=>{
  let calls=0;
  await serverTest({enabled:true,baseUrl:'http://local.test/v1',model:'test-model'},async()=>{
    calls++;if(calls===1)throw new Error('private-provider-value');
    return new Response(JSON.stringify({choices:[{message:{content:'Recovered result.'}}]}));
  },async base=>{
    let response=await fetch(base+'/api/ai',{method:'POST',headers,body:JSON.stringify(valid)});assert.equal(response.status,502);
    assert.ok(!(await response.text()).includes('private-provider-value'));
    response=await fetch(base+'/api/ai',{method:'POST',headers,body:JSON.stringify(valid)});assert.equal(response.status,200);
  });
});
test('two delayed request bodies cannot bypass the single-generation guard',async()=>{
  let calls=0,release;
  const waiting=new Promise(resolve=>{release=resolve;});
  await serverTest({enabled:true,baseUrl:'http://local.test/v1',model:'test'},async()=>{
    calls++;await waiting;return new Response(JSON.stringify({choices:[{message:{content:'One result.'}}]}));
  },async base=>{
    const partial=()=>{
      let request;
      const response=new Promise((resolve,reject)=>{
        request=http.request(base+'/api/ai',{method:'POST',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
        request.on('error',reject);request.write('{"task":"summary",');
      });return {request,response};
    };
    const first=partial(),second=partial();
    await new Promise(resolve=>setTimeout(resolve,30));
    first.request.end('"content":"First text","context":""}');second.request.end('"content":"Second text","context":""}');
    const firstFinished=await Promise.race([first.response,second.response]);
    assert.equal(firstFinished,429);assert.equal(calls,1);release();
    assert.deepEqual((await Promise.all([first.response,second.response])).sort(),[200,429]);
  });
});
test('disconnecting the browser aborts the upstream model request',async()=>{
  let started,cancelled;
  const providerStarted=new Promise(resolve=>{started=resolve;}),providerCancelled=new Promise(resolve=>{cancelled=resolve;});
  await serverTest({enabled:true,baseUrl:'http://local.test/v1',model:'test'},async(url,{signal})=>{
    started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancelled();reject(new Error('Disconnected'));},{once:true}));
  },async base=>{
    const request=http.request(base+'/api/ai',{method:'POST',headers});request.on('error',()=>{});request.end(JSON.stringify(valid));
    await providerStarted;request.destroy();await providerCancelled;
  });
});
