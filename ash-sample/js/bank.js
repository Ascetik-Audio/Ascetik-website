(() => {
'use strict';
const CAPACITY=1044480, HEADER=4096, SLOTS=8;
function crc32(bytes) {let c=0xffffffff;for(const x of bytes){c^=x;for(let i=0;i<8;i++) c=(c>>>1)^(0xedb88320&-(c&1));}return (c^0xffffffff)>>>0;}
function encodeBank(slots) {
 if(slots.length!==SLOTS)throw Error(`Bank must contain ${SLOTS} slots.`);
 const size=HEADER+slots.reduce((n,s)=>n+(s?.pcm.length||0)*2,0);
 if(size>CAPACITY) throw Error('Bank exceeds device storage. Use shorter files or remove samples.');
 const bytes=new Uint8Array(size),v=new DataView(bytes.buffer);bytes.set([65,83,72,83]);v.setUint32(4,2,true);v.setUint32(8,size,true);
 let offset=HEADER;
 slots.forEach((s,i)=>{if(!s) return;if(s.pcm.length<2) throw Error('Samples need at least two frames.');
  bytes[16+i]=s.oneShot?1:0;
  const e=32+i*40;v.setUint32(e,offset,true);v.setUint32(e+4,s.pcm.length,true);
  v.setUint32(e+8,s.loopStart??0,true);v.setUint32(e+12,s.loopEnd??s.pcm.length,true);
  bytes.set(new TextEncoder().encode(s.name).slice(0,23),e+16);
  for(const x of s.pcm) {v.setInt16(offset,x,true);offset+=2;}
 });
 v.setUint32(12,crc32(bytes.subarray(HEADER)),true);decodeBank(bytes);return bytes;
}
function decodeBank(bytes) {
 if(bytes.length<HEADER||bytes.length>CAPACITY) throw Error('Invalid bank size');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(v.getUint32(0,true)!==0x53485341||![1,2].includes(v.getUint32(4,true))||v.getUint32(8,true)!==bytes.length||crc32(bytes.subarray(HEADER))!==v.getUint32(12,true)) throw Error('Invalid bank or checksum');
 // Refuse to silently discard populated upper slots from older 16-slot banks.
 for(let i=SLOTS;i<16;i++)if(v.getUint32(32+i*40+4,true))throw Error('This bank uses slots 9–16. Move those samples into slots 1–8 with the previous editor first.');
 return Array.from({length:SLOTS},(_,i)=>{const e=32+i*40,o=v.getUint32(e,true),n=v.getUint32(e+4,true),a=v.getUint32(e+8,true),b=v.getUint32(e+12,true);
  const mode=v.getUint32(4,true)===2?bytes[16+i]:0;if(mode>1)throw Error('Invalid playback mode');
  if(!n) return null;
  if(o<HEADER||o%2||n<2||o>bytes.length||n>(bytes.length-o)/2||a>=b||b>n||b-a<2) throw Error('Invalid sample boundaries');
  const pcm=new Int16Array(n);for(let j=0;j<n;j++) pcm[j]=v.getInt16(o+j*2,true);
  return {name:new TextDecoder().decode(bytes.subarray(e+16,e+40)).split('\0')[0],pcm,loopStart:a,loopEnd:b,...(mode?{oneShot:true}:{})};
 });
}
function number7(n,count=3) {return Array.from({length:count},(_,i)=>(n>>>(7*i))&127);}
function pack(bytes) {return Array.from(bytes).flatMap(x=>[x&127,x>>>7]);}
function unpack(bytes) {if(bytes.length%2) throw Error('Invalid packed data');const out=new Uint8Array(bytes.length/2);for(let i=0;i<out.length;i++){if(bytes[i*2+1]>1) throw Error('Invalid packed byte');out[i]=bytes[i*2]|bytes[i*2+1]<<7;}return out;}

// Stratified probes avoid aliasing a periodic tone in the phase estimate.
function seamCorrelation(sample,width) {
 const {pcm,loopStart:start,loopEnd:end}=sample;
 let dot=0,aa=0,bb=0;
 for(let k=0;k<64;k++) {
  const offset=(k*width+((width*((k*37+17)&63))>>6))>>6;
  const a=pcm[end-width+offset]>>9,b=pcm[start+offset]>>9;
  dot+=a*b;aa+=a*a;bb+=b*b;
 }
 return Math.max(-1,Math.min(1,aa&&bb?dot/Math.sqrt(aa*bb):0));
}
// Prefer a strong short match; retain near-best short fallbacks for weak material.
function loopSettings(sample) {
 const {pcm,loopStart:start,loopEnd:end}=sample,length=end-start;
 if(length<16)return {width:0,profile:0};
 const head=pcm[start]>>3,tail=pcm[end-1]>>3;
 const first=(pcm[start+1]>>3)-head,last=tail-(pcm[end-2]>>3),wrap=head-tail;
 if(length<512&&Math.abs(wrap-first)<=32&&Math.abs(wrap-last)<=32)return {width:0,profile:0};
 const limit=Math.min(8192,Math.floor(length/2));let maximum=2;while(maximum*2<=limit)maximum*=2;
 const candidates=[];let bestWidth=Math.min(1024,maximum),bestScore=-2,strong=false;
 for(let width=bestWidth;width<=maximum;width+=width<2048?32:256) {
  const score=seamCorrelation(sample,width);candidates.push({width,score});
  if(score>bestScore){bestScore=score;bestWidth=width;}
  if(score>=.9){strong=true;break;}
 }
 if(!strong) {
  const nearBest=bestScore-.1,candidate=candidates.find(item=>item.score>=nearBest);
  bestWidth=candidate.width;bestScore=candidate.score;
 }
 if(maximum>1024) {
  const radius=bestWidth<=2048?16:128,step=bestWidth<=2048?2:8;
  const begin=Math.max(1024,bestWidth-radius),end=Math.min(maximum,bestWidth+radius);
  for(let width=begin;width<=end;width+=step) {
   const score=seamCorrelation(sample,width);
   if(score>bestScore+.005){bestScore=score;bestWidth=width;}
  }
 }
 return {width:bestWidth,profile:Math.max(0,Math.min(8,Math.floor(bestScore*8+.5)))};
}
function previewLoop(sample) {
 const {pcm,loopStart:start,loopEnd:end}=sample,length=end-start;
 if(start<0||end>pcm.length||length<2)throw Error('Invalid loop points.');
 if(sample.oneShot){
  const data=Float32Array.from(pcm.subarray(0,end),x=>x/32768*Math.SQRT1_2),fade=Math.min(64,length);
  for(let i=end-fade;i<end;i++)data[i]*=(end-i)/fade;
  return {data,loopStart:0,loopEnd:end,width:0};
 }
 const {width,profile}=loopSettings(sample),r=profile/8;
 const begin=start+width,repeated=end-begin,data=new Float32Array(end+repeated);
 function value(index){
  let x=pcm[index];
  if(width&&index>=end-width){
   const distance=index-(end-width),t=distance/width,w=t*t*t*t*(35+t*(-84+t*(70-20*t)));
   const norm=1/Math.sqrt((1-w)**2+w*w+2*r*w*(1-w));
   x=(x*(1-w)+pcm[start+distance]*w)*norm;
  }
  return x/32768*Math.SQRT1_2;
 }
 for(let i=0;i<end;i++)data[i]=value(i);
 for(let i=begin;i<end;i++)data[end+i-begin]=value(i);
 return {data,loopStart:end,loopEnd:data.length,width};
}

// Maximize each sample independently across the signed 16-bit range.
// A single gain preserves dynamics; no loudness matching or compression.
function normalizePCM(data) {
 let positive=0,negative=0;
 for(const value of data){if(!Number.isFinite(value))throw Error('Invalid audio samples.');positive=Math.max(positive,value);negative=Math.max(negative,-value);}
 const peak=Math.max(positive,negative);
 const pcm=new Int16Array(data.length);if(peak<1e-8)return pcm;
 const gain=Math.min(positive?32767/positive:Infinity,negative?32768/negative:Infinity);
 for(let i=0;i<data.length;i++)pcm[i]=Math.round(data[i]*gain);
 return pcm;
}

window.AshSampleBank={CAPACITY, HEADER, SLOTS, crc32, seamCorrelation, loopSettings, previewLoop, normalizePCM, encodeBank, decodeBank, number7, pack, unpack};
})();
