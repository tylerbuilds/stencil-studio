import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDesign, createDocument, createPage, createElement, createBrushStroke, SHAPE_KINDS, MAX_STROKE_POINTS, VERSION, validateDocument, parseDocument, serialiseDocument, editPage, updateElement, groupElements, positionLayers, History, pageSVG, elementSVG, duplicateElements } from '../src/model.js';
import { encodeSelection, decodeSelection, pasteSelection } from '../src/transfer.js';
import { writeWithMigrationBackup } from '../src/migration-storage.js';
import { saveDesign, loadDesign, LIBRARY_KEY, MAX_DESIGNS } from '../src/library.js';
function earlier(document, version) {
 const old = structuredClone(document); old.version = version; delete old.video;
 for (const page of old.pages) { delete page.backgroundGradient; delete page.duration; if (version < 3) { delete page.guides; delete page.guideSettings; delete page.transparentBackground; } for (const element of page.elements) { for (const key of ['gradient','credit','italic','underline','effect','effectColour','effectSize']) delete element[key]; } }
 return old;
}
class Storage { values = new Map(); fail = false; getItem(k) { return this.values.get(k) ?? null; } setItem(k,v) { if(this.fail) throw new Error('Quota'); this.values.set(k,v); } }
const key='stencil-studio.document.v1';
function drawingDocument() { const d=createBlankDesign({width:640,height:480,title:'My own idea'});d.pages[0].elements=[createElement('shape',{id:'triangle',kind:'triangle'}),createBrushStroke([{x:20,y:30},{x:90,y:60},{x:40,y:110}],'#123456',9,'brush')];return validateDocument(d); }

test('blank custom design has no seeded layers and exact validated dimensions, title and background',()=>{
 const d=createBlankDesign({width:873.5,height:612,title:'Original 界',background:'#abcdef'});
 assert.equal(VERSION,5);assert.equal(d.version,5);assert.equal(d.title,'Original 界');assert.equal(d.pages.length,1);assert.equal(d.pages[0].width,873.5);assert.equal(d.pages[0].height,612);assert.equal(d.pages[0].background,'#abcdef');assert.deepEqual(d.pages[0].elements,[]);
 for(const options of [{width:63},{height:4097},{background:'url(https://example.test)'},{title:'x'.repeat(151)},{extra:true}]) assert.throws(()=>createBlankDesign(options));
 assert.equal(createBlankDesign().pages[0].elements.length,0);assert.notEqual(createBlankDesign().pages[0].id,d.pages[0].id);
});

test('v3 migration changes only the version and keeps all ordered pages, guides, transparency, groups, image data and native styles',()=>{
 let d=createDocument();const p=d.pages[0];p.transparentBackground=true;p.guides=[{id:'guide',axis:'y',position:25.5}];p.guideSettings={visible:false,rulers:true,snapToGuides:false,snapToObjects:false,snapToPage:true,tolerance:11};
 p.elements=[createElement('image',{id:'image',groupId:'old-group',src:'data:image/png;base64,iVBORw0KGgo=',sourceWidth:800,sourceHeight:600,crop:{x:.1,y:.2,width:.7,height:.5},filters:{contrast:1.2,saturation:.4},hidden:true}),createElement('text',{id:'text',groupId:'old-group',text:'Original\n界',lineHeight:1.7,letterSpacing:2}),createElement('table',{id:'table',headerFill:'#123456',data:{columns:['Literal <'],rows:[['First\nSecond']]}}),createElement('chart',{id:'chart',data:{kind:'pie',labels:['Original','More'],values:[2,3]},palette:['#123456','#abcdef']})];
 d.pages.unshift(createPage(900,600));d=earlier(d,3);const raw=JSON.stringify(d,null,3)+'\n', old=structuredClone(d), migrated=parseDocument(raw);
 assert.deepEqual(earlier(migrated,3),old);assert.equal(migrated.version,VERSION);assert.deepEqual(migrated.video,{transition:'cut',audio:null});assert.ok(migrated.pages.every(page=>page.duration===3&&page.backgroundGradient===null));assert.deepEqual(d,old);const storage=new Storage();storage.values.set(key,raw);writeWithMigrationBackup(storage,key,serialiseDocument(migrated));assert.ok([...storage.values].some(([k,v])=>k.includes(`.migration.v${VERSION}.`)&&v===raw));assert.deepEqual(parseDocument(storage.getItem(key)),migrated);
 const bad=structuredClone(old);bad.pages[1].elements.push(createElement('shape'));assert.throws(()=>validateDocument(bad),/This layer type is not supported here\./);
});

test('shape factory produces original visible native polygons and lines with editable stroke, colour and exact transforms',()=>{
 for(const kind of SHAPE_KINDS){const e=createElement('shape',{kind,x:31,y:47,width:123,height:89,rotation:15,fill:'#abcdef',opacity:.5});const svg=elementSVG(e);assert.match(svg,/translate\(31 47\) rotate\(15 61.5 44.5\)/);assert.match(svg,/opacity="0.5"/);assert.match(svg,kind==='line'?/<line /:/<polygon /);assert.doesNotMatch(svg,/NaN|undefined|script|href=/);if(kind==='line')assert.equal(e.strokeWidth,6);else assert.match(svg,/fill="#abcdef"/);}
 assert.throws(()=>elementSVG(createElement('shape',{kind:'<script>'})),/Choose a shape available in Stencil Studio\./);assert.throws(()=>elementSVG(createElement('shape',{stroke:'url(https://example.test)'})),/Stroke colour/);assert.throws(()=>createElement('shape',{path:'M0 0'}),/unsupported properties/);
});

test('one-point brush is a round native dot; a gesture has bounded normalised points and retained brush geometry',()=>{
 const dot=createBrushStroke([{x:80,y:90}],'#abcdef',10,'dot');assert.equal(dot.x,75);assert.equal(dot.y,85);assert.equal(dot.width,10);assert.equal(dot.height,10);assert.deepEqual(dot.points,[{x:.5,y:.5}]);assert.match(elementSVG(dot),/<circle cx="5" cy="5" r="5" fill="#abcdef"/);
 const stroke=createBrushStroke([{x:20,y:30},{x:90,y:60},{x:40,y:110}],'#123456',9);assert.equal(stroke.points.length,3);assert.ok(stroke.points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));assert.match(elementSVG(stroke),/stroke-linecap="round" stroke-linejoin="round"/);assert.equal(stroke.strokeWidth,9);
 assert.equal(createBrushStroke(Array.from({length:MAX_STROKE_POINTS},(_,i)=>({x:i,y:10}))).points.length,MAX_STROKE_POINTS);assert.throws(()=>createBrushStroke(Array.from({length:MAX_STROKE_POINTS+1},()=>({x:0,y:0}))));
});

test('nested brush payloads fail closed on extra fields, sparse arrays, accessors, non-finite coordinates and out-of-range widths',()=>{
 const original=drawingDocument();let calls=0;
 const candidates=[];for(const patch of [{points:[]},{points:[{x:NaN,y:0}]},{points:[{x:-.1,y:0}]},{points:[{x:0,y:1.1}]},{points:[{x:0,y:0,onclick:'evil'}]},{points:new Array(2)},{strokeWidth:0},{strokeWidth:81}])candidates.push({...original.pages[0].elements[1],...patch});
 const point={y:0};Object.defineProperty(point,'x',{enumerable:true,get(){calls++;return 0;}});candidates.push({...original.pages[0].elements[1],points:[point]});
 for(const e of candidates)assert.throws(()=>validateDocument({...original,pages:[{...original.pages[0],elements:[e]}]}));assert.equal(calls,0);assert.equal(original.pages[0].elements[1].points.length,3);
});

test('editable brush points survive JSON, library and cross-document clipboard without aliases or reused group IDs',()=>{
 const d=drawingDocument(),p=d.pages[0],grouped=groupElements(d,p.id,['triangle','brush']);const payload=encodeSelection(grouped,p.id,['brush']);assert.equal(decodeSelection(payload).elements.length,2);const target=createBlankDesign({width:800,height:700});const pasted=pasteSelection(target,target.pages[0].id,payload);const copies=pasted.pages[0].elements;assert.equal(copies[1].type,'freehand');assert.deepEqual(copies[1].points,p.elements[1].points);assert.notEqual(copies[1].id,'brush');assert.equal(copies[0].groupId,copies[1].groupId);assert.notEqual(copies[0].groupId,grouped.pages[0].elements[0].groupId);
 copies[1].points[0].x=0;assert.notEqual(copies[1].points[0].x,p.elements[1].points[0].x);assert.deepEqual(parseDocument(serialiseDocument(grouped)),grouped);const storage=new Storage(),record=saveDesign(grouped,{name:'Original drawing'},storage);assert.deepEqual(loadDesign(record.id,storage),grouped);
});

test('brush resize, recolour, flip, rotation, hidden state and duplication use normal model and safe SVG paths',()=>{
 const d=drawingDocument(),p=d.pages[0],next=updateElement(d,p.id,'brush',{width:300,height:200,fill:'#654321',strokeWidth:15,rotation:90,flipX:true});const e=next.pages[0].elements[1];assert.deepEqual(e.points,p.elements[1].points);const svg=pageSVG(next.pages[0]);assert.match(svg,/stroke="#654321" stroke-width="15"/);assert.match(svg,/scale\(-1 1\)/);assert.doesNotMatch(svg,/data-element-id|resize-handle|javascript|https:/);const hidden=updateElement(next,p.id,'brush',{hidden:true});assert.doesNotMatch(pageSVG(hidden.pages[0]),/stroke="#654321"/);assert.equal(hidden.pages[0].elements[1].points.length,3);const dup=duplicateElements(next,p.id,['brush']);assert.equal(dup.pages[0].elements.length,3);assert.notEqual(dup.pages[0].elements[2].id,e.id);
});

test('front/back and drag placement move complete groups, keep internal order and protect a locked member',()=>{
 const d=createBlankDesign(),p=d.pages[0];p.elements=['a','b','c','d','e'].map(id=>createElement('shape',{id,kind:'diamond'}));p.elements[1].groupId=p.elements[2].groupId='group';
 const moved=positionLayers(d,p.id,['b'],'front');assert.deepEqual(moved.pages[0].elements.map(e=>e.id),['a','d','e','b','c']);const back=positionLayers(moved,p.id,['c'],'back');assert.deepEqual(back.pages[0].elements.map(e=>e.id),['b','c','a','d','e']);const above=positionLayers(d,p.id,['e'],'after','b');assert.deepEqual(above.pages[0].elements.map(e=>e.id),['a','b','c','e','d']);const below=positionLayers(d,p.id,['e'],'before','c');assert.deepEqual(below.pages[0].elements.map(e=>e.id),['a','e','b','c','d']);
 const locked=updateElement(d,p.id,'c',{locked:true});assert.deepEqual(positionLayers(locked,p.id,['b'],'front'),locked);assert.deepEqual(d.pages[0].elements.map(e=>e.id),['a','b','c','d','e']);assert.throws(()=>positionLayers(d,p.id,['e'],'after','absent'));
});

test('one gesture and one layer-order mutation each make a single Undo step; rejected stroke leaves history intact',()=>{
 const d=createBlankDesign(),p=d.pages[0],history=new History(d);const e=createBrushStroke([{x:1,y:2},{x:70,y:60},{x:30,y:90}]);history.commit(editPage(d,p.id,p=>p.elements.push(e)));assert.equal(history.past.length,1);assert.equal(history.current.pages[0].elements.length,1);assert.throws(()=>history.commit({...history.current,pages:[{...history.current.pages[0],elements:[{...e,points:[{x:2,y:0}]}]}]}));assert.equal(history.past.length,1);assert.equal(history.undo(),true);assert.equal(history.current.pages[0].elements.length,0);assert.equal(history.redo(),true);assert.deepEqual(history.current.pages[0].elements[0],e);
});

test('recovery creates an independent full named copy and quota/capacity failures preserve the existing library bytes',()=>{
 const storage=new Storage(),current=drawingDocument(),first=saveDesign(current,{name:'My saved original'},storage);const recovery=saveDesign(current,{name:'Recovery — My own idea'},storage);assert.notEqual(recovery.id,first.id);assert.deepEqual(loadDesign(first.id,storage),current);assert.deepEqual(loadDesign(recovery.id,storage),current);const before=storage.getItem(LIBRARY_KEY);storage.fail=true;assert.throws(()=>saveDesign(current,{name:'Recovery'},storage),/unchanged/);assert.equal(storage.getItem(LIBRARY_KEY),before);storage.fail=false;for(let i=2;i<MAX_DESIGNS;i++)saveDesign(createBlankDesign(),{name:`Saved ${i}`},storage);const full=storage.getItem(LIBRARY_KEY);assert.throws(()=>saveDesign(current,{name:'Recovery'},storage));assert.equal(storage.getItem(LIBRARY_KEY),full);
});

test('actual app bootstrap preserves a present empty active key before any edit and blocks saves when its backup fails', async()=>{
 const { readFile }=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');const bootstrap=source.slice(source.indexOf("const STORAGE_KEY ="),source.indexOf('let drawMode ='))+'\n({initial,recoveryRaw,recoveryPreserved,pristineDocument});';
 const { id }=await import('../src/model.js'),{ needsMigration,preserveMigrationSource }=await import('../src/migration-storage.js');
 for(const fail of [false,true]){const storage=new Storage();storage.values.set(key,'');storage.fail=fail;const state=runInNewContext(bootstrap,{localStorage:storage,createBlankDesign,parseDocument,needsMigration,preserveMigrationSource,id,History,serialiseDocument});assert.equal(state.recoveryRaw,'');assert.equal(state.pristineDocument,null);assert.equal(state.initial.pages[0].elements.length,0);assert.equal(state.recoveryPreserved,!fail);assert.equal(storage.getItem(key),'');assert.equal([...storage.values].some(([k,v])=>k!==key&&v===''),!fail);}
});
