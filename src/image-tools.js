// Original colour-key background editing, performed entirely on this device.
const MAX_PIXELS=4_000_000;
function colourChannels(colour, pixels) {
  if(colour===undefined || colour==='') return [...pixels.slice(0,3)];
  if(!/^#[0-9a-f]{6}$/i.test(colour)) throw new Error("Choose a six-digit hex colour for the background.");
  return [1,3,5].map(start=>parseInt(colour.slice(start,start+2),16));
}
export function keyBackgroundPixels(pixels,width,height,{colour,tolerance=35,contiguous=true}={}) {
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width*height>MAX_PIXELS || !(pixels instanceof Uint8ClampedArray) || pixels.length!==width*height*4) throw new Error('Choose an image with at most four million pixels.');
  if(!Number.isFinite(tolerance) || tolerance<0 || tolerance>255 || typeof contiguous!=='boolean') throw new Error('Choose a tolerance between 0 and 255.');
  const target=colourChannels(colour,pixels),out=new Uint8ClampedArray(pixels);
  const matches=index=>{
    const offset=index*4;
    return pixels[offset+3]===0 || Math.sqrt(target.reduce((sum,channel,i)=>sum+(pixels[offset+i]-channel)**2,0)/3)<=tolerance;
  };
  if(!contiguous) {
    for(let i=0;i<width*height;i++) if(matches(i)) out[i*4+3]=0;
    return out;
  }
  const visited=new Uint8Array(width*height),queue=new Uint32Array(width*height);
  let head=0,tail=0;
  const add=index=>{if(!visited[index]){visited[index]=1;if(matches(index))queue[tail++]=index;}};
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
  for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
  while(head<tail) {
    const index=queue[head++],x=index%width,y=Math.floor(index/width);
    out[index*4+3]=0;
    if(x>0)add(index-1);if(x+1<width)add(index+1);if(y>0)add(index-width);if(y+1<height)add(index+width);
  }
  return out;
}
export async function removeBackground(src,options={}) {
  if(typeof src!=='string' || src.length>8*1024*1024+64 || !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src)) throw new Error('Choose an uploaded PNG, JPEG or WebP image.');
  const image=new Image();
  image.src=src;
  try { await image.decode(); } catch { throw new Error("This image could not be opened."); }
  const width=image.naturalWidth,height=image.naturalHeight;
  if(width*height>MAX_PIXELS || width<1 || height<1) throw new Error('Resize this image to at most four million pixels before removing its background.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new Error('Image editing is unavailable in this browser.');
  context.drawImage(image,0,0);
  const data=context.getImageData(0,0,width,height);
  data.data.set(keyBackgroundPixels(data.data,width,height,options));
  context.putImageData(data,0,0);
  return canvas.toDataURL('image/png');
}
