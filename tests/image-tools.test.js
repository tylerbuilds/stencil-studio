import test from 'node:test';
import assert from 'node:assert/strict';
import {keyBackgroundPixels} from '../src/image-tools.js';
const pixels=rows=>new Uint8ClampedArray(rows.flatMap(row=>row.flatMap(cell=>cell==='W' ? [255,255,255,255] : cell==='T' ? [0,0,0,0] : [0,0,0,255])));
test('edge-connected removal preserves matching colour enclosed inside the subject',()=>{
  const source=pixels(['WWWWW','WBBBW','WBWBW','WBBBW','WWWWW'].map(row=>[...row]));
  const original=new Uint8ClampedArray(source);
  const output=keyBackgroundPixels(source,5,5,{colour:'#ffffff',tolerance:0});
  assert.equal(output[3],0);assert.equal(output[12*4+3],255);assert.equal(output[6*4+3],255);
  assert.deepEqual(source,original);
});
test('all-colour mode removes enclosed matches only when explicitly requested',()=>{
  const source=pixels(['BBB','BWB','BBB'].map(row=>[...row]));
  const output=keyBackgroundPixels(source,3,3,{colour:'#ffffff',tolerance:0,contiguous:false});
  assert.equal(output[4*4+3],0);assert.equal(output[3],255);
});
test('transparent boundary and colour tolerance produce actual alpha changes',()=>{
  const source=new Uint8ClampedArray([0,0,0,0,250,250,250,255,255,0,0,255]);
  const output=keyBackgroundPixels(source,3,1,{colour:'#ffffff',tolerance:6});
  assert.deepEqual([...output.filter((_,i)=>i%4===3)],[0,0,255]);
  assert.equal(keyBackgroundPixels(source,3,1,{colour:'#ffffff',tolerance:4})[7],255);
});
test('bounds reject invalid channels, dimensions, pixel buffers and tolerance',()=>{
  const source=new Uint8ClampedArray([255,255,255,255]);
  for(const options of [{tolerance:-1},{tolerance:256},{tolerance:NaN},{colour:'url(http://x)'},{contiguous:'yes'}]) assert.throws(()=>keyBackgroundPixels(source,1,1,options));
  assert.throws(()=>keyBackgroundPixels(source,2,1));
  assert.throws(()=>keyBackgroundPixels(source,2001,2000));
});
