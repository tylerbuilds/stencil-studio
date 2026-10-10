import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createDocument, createElement, createPage, VERSION, FONTS, validateDocument, parseDocument, serialiseDocument, pageSVG, editPage, updateElement, resizePageDocument, makeSizeCopies, History } from '../../src/model.js';
import { createTimeline } from '../../src/video.js';
import { validateVideoSettings, savedAudioBlob } from '../../src/video-settings.js';
import { creditFromUpload, uploadLicenceFromCredit, mediaCreditText } from '../../src/media-credit.js';
import { decodeSelection, encodeSelection } from '../../src/transfer.js';
import { LIBRARY_KEY, saveDesign, loadDesign, listDesignVersions, restoreDesignVersion, createFolder, listFolders, renameFolder } from '../../src/library.js';
import { prepareFiles } from '../../src/browser-intake.js';
const png = 'data:image/png;base64,iVBORw0KGgo=';
class Storage { values = new Map(); getItem(key) { return this.values.get(key) ?? null; } setItem(key,value) { this.values.set(key,value); } }
function legacy(document, version) {
  const old = structuredClone(document); old.version = version; delete old.video;
  for (const page of old.pages) {
    delete page.duration; delete page.backgroundGradient;
    if (version < 3) for (const key of ['guides','guideSettings','transparentBackground']) delete page[key];
    for (const element of page.elements) {
      for (const key of ['gradient','credit','italic','underline','effect','effectColour','effectSize']) delete element[key];
      if (version === 1) for (const key of ['locked','hidden','flipX','flipY','groupId','lineHeight','letterSpacing']) delete element[key];
    }
  }
  if (version === 1) delete old.brand;
  return old;
}

test('design, frame and earlier library JSON refuse oversized raster headers without changing stored recovery data', async () => {
  const header = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(header); header.writeUInt32BE(13,8); header.write('IHDR',12); header.writeUInt32BE(10000,16); header.writeUInt32BE(10000,20);
  const oversizedPNG = `data:image/png;base64,${header.toString('base64')}`;
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00','binary'); gif.writeUInt16LE(16385,6);
  const oversizedGIF = `data:image/gif;base64,${gif.toString('base64')}`;
  for (const type of ['image','frame']) for (const src of [oversizedPNG,oversizedGIF]) {
    const d=createDocument(); d.pages[0].elements=[createElement(type,{src,sourceWidth:1,sourceHeight:1})];
    assert.throws(()=>validateDocument(d),/16,384|40|megapixel|pixels/i);
    const raw=JSON.stringify(d), bytes=new TextEncoder().encode(raw), file={name:'oversized.json',type:'application/json',size:bytes.length,arrayBuffer:async()=>bytes.buffer};
    await assert.rejects(prepareFiles([file],{page:createDocument().pages[0],brand:createDocument().brand}),/16,384|40|megapixel|pixels/i);
  }
  for (const version of [1,2,3,4]) {
    const d=createDocument();d.pages[0].elements=[createElement('image',{src:oversizedPNG,sourceWidth:1,sourceHeight:1})];
    const old=legacy(d,version);if(version===1)for(const element of old.pages[0].elements)for(const key of ['sourceWidth','sourceHeight','crop','filters'])delete element[key];
    const storage=new Storage(),raw=JSON.stringify({schema:'stencil-studio-library',version:1,designs:[{id:'old-large-image',name:'Earlier design',updatedAt:'2026-10-09T00:00:00.000Z',document:old}]},null,3)+'\n';
    storage.values.set(LIBRARY_KEY,raw);const before=new Map(storage.values);
    assert.throws(()=>parseDocument(JSON.stringify(old)),/16,384|40|megapixel|pixels/i);
    assert.throws(()=>loadDesign('old-large-image',storage),/stored data has been kept/);
    assert.deepEqual(storage.values,before);assert.equal(storage.getItem(LIBRARY_KEY),raw);
  }
});
const audio = () => {
  const bytes = Buffer.alloc(48); bytes.write('RIFF',0); bytes.writeUInt32LE(40,4); bytes.write('WAVE',8);
  return {name:'Fictional short WAV',src:`data:audio/wav;base64,${bytes.toString('base64')}`};
};

test('genuine v1-v4 saves retain every earlier value and acquire independent v5 defaults', () => {
  const source=createDocument(); source.title='Earlier title · café';source.pages.push(createPage(1000,600));
  source.pages[0].elements=[createElement('text',{id:'earlier-text',text:'An earlier paragraph',fontFamily:'Georgia',fontSize:33})];
  for(const version of [1,2,3,4]) {
    const old=legacy(source,version), raw=JSON.stringify(old,null,3)+'\n', migrated=parseDocument(raw);
    assert.equal(migrated.version,VERSION);assert.deepEqual(legacy(migrated,version),old);
    assert.deepEqual(migrated.video,{transition:'cut',audio:null});assert.equal(migrated.pages[0].duration,3);assert.equal(migrated.pages[0].backgroundGradient,null);
    assert.equal(migrated.pages[0].elements[0].gradient,null);assert.equal(migrated.pages[0].elements[0].italic,false);
    migrated.pages[0].duration=5;assert.equal(migrated.pages[1].duration,3);assert.equal(JSON.stringify(old,null,3)+'\n',raw);
  }
});

test('native frames, typography, gradients, credits and saved media survive JSON, named saves and durable versions', () => {
  const d=createDocument(), p=d.pages[0], storage=new Storage();d.video={transition:'fade',audio:audio()};p.duration=2.75;p.backgroundGradient={from:'#112233',to:'#aabbcc',angle:135};
  p.elements=[createElement('text',{fontFamily:'Fraunces',italic:true,underline:true,effect:'outline',effectSize:3,gradient:{from:'#112233',to:'#445566',angle:90}}),createElement('frame',{src:png,sourceWidth:800,sourceHeight:600,shape:'arch',width:300,height:400,crop:{x:.2,y:.1,width:.5,height:.7},credit:{name:'Fictional photo',creator:'Example creator',sourceUrl:'https://example.test/photo',licenceUrl:'https://creativecommons.org/publicdomain/zero/1.0/',licence:'CC0-1.0'}})];
  const valid=validateDocument(d);assert.deepEqual(parseDocument(serialiseDocument(d)),valid);
  const first=saveDesign(d,{name:'A real editable design'},storage), edited=updateElement(d,p.id,p.elements[0].id,{text:'The next version'});
  const second=saveDesign(edited,{id:first.id,name:first.name,expectedUpdatedAt:first.updatedAt},storage);
  assert.deepEqual(loadDesign(first.id,storage),edited);const versions=listDesignVersions(first.id,storage);assert.equal(versions.length,1);
  const restored=restoreDesignVersion(first.id,versions[0].id,storage,{expectedUpdatedAt:second.updatedAt});assert.deepEqual(restored.document,valid);
  assert.match(pageSVG(restored.document.pages[0],false,true),/clipPath|linearGradient|font-style="italic"/);assert.match(pageSVG(restored.document.pages[0],false,true),/Fictional photo/);
});

test('all nine fonts are valid; forged or partial new fields reject without changing history', () => {
  assert.equal(FONTS.length,9);for(const family of FONTS){const d=createDocument();d.brand.fontFamily=family;d.pages[0].elements=[createElement('text',{fontFamily:family})];validateDocument(d);}
  const d=createDocument();d.pages[0].elements=[createElement('text')];const history=new History(d), base=serialiseDocument(history.current);
  for(const mutate of [e=>delete e.italic,e=>e.effect='url(https://example.test)',e=>e.gradient={from:'#ffffff',to:'#000000',angle:Infinity},e=>e.credit={name:'Bad',creator:'Bad',sourceUrl:'javascript:alert(1)',licenceUrl:'https://example.test',licence:'Bad'},e=>e.fontFamily='<style>']) {
    const next=structuredClone(d);mutate(next.pages[0].elements[0]);assert.throws(()=>history.commit(next));assert.equal(serialiseDocument(history.current),base);assert.equal(history.past.length,0);
  }
  let called=0;const evil={transition:'cut',audio:null};Object.defineProperty(evil,'audio',{enumerable:true,get(){called++;return null;}});assert.throws(()=>validateVideoSettings(evil));assert.equal(called,0);
});

test('saved audio and page timing drive a reloaded timeline; remote and mismatched audio are refused', async () => {
  const d=createDocument();d.pages.push(createPage());d.pages[0].duration=1.25;d.pages[1].duration=4.5;d.video={transition:'fade',audio:audio()};
  const loaded=parseDocument(serialiseDocument(d)), timeline=createTimeline(loaded);assert.equal(timeline.duration,5.75);assert.equal(timeline.transition,'fade');assert.deepEqual(timeline.scenes.map(scene=>scene.duration),[1.25,4.5]);
  const blob=savedAudioBlob(loaded.video.audio);assert.equal(blob.type,'audio/wav');assert.equal(blob.size,48);assert.equal(Buffer.from(await blob.arrayBuffer()).subarray(0,4).toString(),'RIFF');
  for(const src of ['https://example.test/audio.wav','data:audio/wav;base64,SUQz','data:audio/mpeg;base64,UklGRg=='])assert.throws(()=>validateVideoSettings({transition:'cut',audio:{name:'Bad audio',src}}));
  assert.throws(()=>validateVideoSettings({transition:'zoom',audio:null}));
});

test('size copies preserve source, use new identifiers and retain editable frame and media settings', () => {
  const d=createDocument(),p=d.pages[0];p.duration=4;d.video={transition:'fade',audio:audio()};p.elements=[createElement('frame',{width:300,height:200,cornerRadius:70}),createElement('text',{fontFamily:'DM Sans',effect:'shadow'})];
  const old=structuredClone(d), next=makeSizeCopies(d,p.id,['social','story']);assert.deepEqual(d,old);assert.deepEqual(next.pages[0],p);assert.equal(next.pages.length,3);assert.deepEqual(next.video,d.video);assert.equal(new Set(next.pages.flatMap(page=>[page.id,...page.elements.map(e=>e.id)])).size,9);
  assert.ok(next.pages.slice(1).every(page=>page.duration===4&&page.elements[0].type==='frame'));assert.throws(()=>makeSizeCopies(d,p.id,['social','social']));
  const many=createDocument();while(many.pages.length<30)many.pages.push(createPage());assert.throws(()=>makeSizeCopies(many,many.pages[0].id,['social']),/30 pages/);
  const tiny=createDocument();tiny.pages[0].width=tiny.pages[0].height=4096;tiny.pages[0].elements=[createElement('frame',{width:1,height:1,cornerRadius:0})];const shrunk=resizePageDocument(tiny,tiny.pages[0].id,64,64,true);assert.equal(shrunk.pages[0].elements[0].width,1);
});

test('v4 clipboard envelopes migrate completely but partial v5 envelopes are rejected', () => {
  const d=createDocument();d.pages[0].elements=[createElement('text',{text:'Copied from an earlier tab'})];const old=legacy(d,4);
  const raw=JSON.stringify({schema:'stencil-studio.clipboard',version:1,sourcePage:{width:720,height:960},elements:old.pages[0].elements});
  const decoded=decodeSelection(raw);assert.equal(decoded.elements[0].text,'Copied from an earlier tab');assert.equal(decoded.elements[0].gradient,null);assert.equal(decoded.elements[0].italic,false);
  const modern=JSON.parse(encodeSelection(d,d.pages[0].id,[d.pages[0].elements[0].id]));delete modern.elements[0].italic;assert.throws(()=>decodeSelection(JSON.stringify(modern)));
});

test('actual image-picker change handler rejects a target moved to another design before reading the file', async () => {
  const source=await readFile(new URL('../../src/app.js',import.meta.url),'utf8'), start=source.indexOf("for (const selector of ['#image-input', '#asset-input', '#document-input'])"), end=source.indexOf("window.addEventListener('copy'",start);
  const handlers=new Map(), calls=[], context={pageId:'new-page',cloudGeneration:2,documentRevision:3,history:{current:createDocument()},pickerTarget:{pageId:'old-page',cloudGeneration:1,revision:2,signature:'old',id:'old-frame'},replaceMediaId:'old-frame',selected:()=>({id:'new-frame'}),selectedElements:()=>[{id:'new-frame'}],serialiseDocument,toast:message=>calls.push(message),insertFiles:()=>calls.push('INSERTED'),$:selector=>({addEventListener:(_,fn)=>handlers.set(selector,fn)})};
  runInNewContext(source.slice(start,end),context);handlers.get('#image-input')({target:{files:[{name:'fictional.png'}],value:'file'}});
  assert.equal(calls.length,1);assert.match(calls[0],/design changed/);assert.equal(context.replaceMediaId,null);assert.equal(context.pickerTarget,null);
});

test('actual saved-version listener rejects an unseen newer save before preserving or restoring any document', async () => {
  const source=await readFile(new URL('../../src/app.js',import.meta.url),'utf8'),start=source.indexOf('function renderVersions()'),end=source.indexOf("$('#clear-versions').addEventListener",start);
  let clicked, preserved=0, restored=0;const error={textContent:''},button={dataset:{restoreVersion:'earlier-version'},addEventListener(_,fn){clicked=fn;}},list={innerHTML:'',querySelectorAll(){return[button];}},nodes={'#versions-list':list,'#clear-versions':{},'#versions-error':error,'#versions-dialog':{open:true}};
  const context={versionsTarget:{id:'design',updatedAt:'2026-10-10T01:00:00.000Z'},listDesignVersions:()=>[{id:'earlier-version',name:'Original',savedAt:'2026-10-10T00:00:00.000Z',pageCount:1}],listDesigns:()=>[{id:'design',updatedAt:'2026-10-10T02:00:00.000Z'}],safe:String,document:{activeElement:null},editingTarget:()=>false,confirm:()=>true,preserveCurrentDesign:async()=>{preserved++;return null;},captureDesignState:()=>({}),requireDesignState:()=>{},withLibraryLock:async fn=>fn(),restoreDesignVersion:()=>{restored++;return{};},$:selector=>nodes[selector]};
  runInNewContext(source.slice(start,end)+'\nrenderVersions();',context);await clicked();assert.equal(preserved,0);assert.equal(restored,0);assert.match(error.textContent,/changed in another tab/);
});

test('actual folder rename listener uses the displayed revision and cannot overwrite another tab rename', async () => {
  const source=await readFile(new URL('../../src/app.js',import.meta.url),'utf8'),start=source.indexOf('function renderFolders()'),end=source.indexOf("$('#manage-folders').addEventListener",start),storage=new Storage(),folder=createFolder('Original folder',storage);
  let submitted;const error={textContent:''},form={dataset:{folderId:folder.id},querySelector:()=>({value:'Stale overwrite'}),addEventListener(_,fn){submitted=fn;}},list={innerHTML:'',querySelectorAll:selector=>selector==='form'?[form]:[]};
  const context={listFolders:()=>listFolders(storage),renameFolder:(id,name,_storage,options)=>renameFolder(id,name,storage,structuredClone(options)),withLibraryLock:async fn=>fn(),renderLibrary:()=>{},safe:String,$:selector=>selector==='#folder-list'?list:error};
  runInNewContext(source.slice(start,end)+'\nrenderFolders();',context);renameFolder(folder.id,'New name in another tab',storage,{expectedUpdatedAt:folder.updatedAt});await submitted({preventDefault(){}});
  assert.equal(listFolders(storage)[0].name,'New name in another tab');assert.match(error.textContent,/another tab|changed/);
});

test('actual version restore listener keeps the previous design association intact for Undo', async () => {
  const source=await readFile(new URL('../../src/app.js',import.meta.url),'utf8'),start=source.indexOf('function renderVersions()'),end=source.indexOf("$('#clear-versions').addEventListener",start),alpha=createDocument(),beta=createDocument();alpha.title='Alpha';beta.title='Beta';const history=new History(beta),bindings=new WeakMap([[history.current,'beta']]);
  let clicked;const button={dataset:{restoreVersion:'earlier-version'},addEventListener(_,fn){clicked=fn;}},dialog={open:true,close(){this.open=false;}},error={textContent:''},nodes={'#versions-list':{innerHTML:'',querySelectorAll:()=>[button]},'#clear-versions':{},'#versions-error':error,'#versions-dialog':dialog};
  const stamp='2026-10-10T01:00:00.000Z',restored={id:'alpha',updatedAt:'2026-10-10T02:00:00.000Z',document:alpha},context={versionsTarget:{id:'alpha',updatedAt:stamp},listDesignVersions:()=>[{id:'earlier-version',name:'Alpha',savedAt:stamp,pageCount:1}],listDesigns:()=>[{id:'alpha',updatedAt:stamp}],safe:String,serialiseDocument,savedBindings:new Map(),document:{activeElement:null},editingTarget:()=>false,confirm:()=>true,preserveCurrentDesign:async()=>null,captureDesignState:()=>({}),requireDesignState:()=>{},withLibraryLock:async fn=>fn(),restoreDesignVersion:()=>restored,rememberSaved:record=>bindings.set(history.current,record.id),openDocument:(next,id)=>{history.commit(next);bindings.set(history.current,id);},renderLibrary:()=>{},toast:()=>{},$:selector=>nodes[selector]};
  runInNewContext(source.slice(start,end)+'\nrenderVersions();',context);await clicked();assert.equal(error.textContent,'');assert.equal(bindings.get(history.current),'alpha');assert.equal(history.undo(),true);assert.equal(history.current.title,'Beta');assert.equal(bindings.get(history.current),'beta');
});

test('SVG font embedding permits self-contained faces and rejects CSS that could fetch remote resources',()=>{const p=createDocument().pages[0],css="/* Licence kept */\n@font-face{font-family:'DM Sans';src:url('data:font/woff2;base64,AAAA') format('woff2');}";assert.match(pageSVG(p,false,false,css),/data:font\/woff2;base64/);for(const unsafe of ["@import url('https://example.test/font.css');","@font-face{src:url('https://example.test/font.woff2')}","image{filter:url('https://example.test/filter')}","@font-face{src:u\\72l('https://example.test/font.woff2')}" ])assert.throws(()=>pageSVG(p,false,false,unsafe));});

test('partial upload licence facts are preserved in saved and exported artwork without inventing CC0',()=>{for(const licence of [{name:'All rights reserved'},{creator:'Example creator'},{name:'Custom permission',sourceUrl:'https://example.test/permission'},{attribution:'Used with permission · Example'}]){const upload={name:'Fictional image',licence},credit=creditFromUpload(upload),d=createDocument();d.pages[0].elements=[createElement('image',{src:png,credit})];const imported=parseDocument(serialiseDocument(d)),svg=pageSVG(imported.pages[0],false,true);assert.deepEqual(imported.pages[0].elements[0].credit,credit);assert.deepEqual(uploadLicenceFromCredit(credit),licence);const credits=mediaCreditText(imported.pages[0].elements);assert.doesNotMatch(credits,/creativecommons|CC0/);assert.ok(credits.includes(licence.name??licence.creator??licence.attribution));assert.doesNotMatch(svg,/creativecommons|CC0/);if(licence.name)assert.ok(svg.includes(licence.name));if(licence.creator)assert.ok(svg.includes(licence.creator));}assert.equal(creditFromUpload({name:'My own image'}),null);});
