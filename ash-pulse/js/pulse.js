/* Shared, DOM-free model. ADC mappings match src/engine.cpp. */
(function(root) {
 'use strict';
 const names=['Vibrato','Filter','Scale','Root','Depth','Delay','Waveform','Mode','Octave','Attack','Sustain','Decay','Release'];
 const hit=(step,length,events,offset)=>length>0&&events>0&&(((step+length-offset%length)%length)*events)%length<events;
 const bin=(raw,n)=>Math.floor(raw*n/4096);
 function decode(raw) {
  const rhythm=(l,e,o)=>{const length=1+bin(raw[l],16);return {length,events:bin(raw[e],length+1),offset:bin(raw[o],length)};};
  return {drums:[rhythm(0,2,7),rhythm(0,4,9),rhythm(1,6,12),rhythm(1,3,8)],bpm:40+Math.floor(raw[5]*200/4095),divider:1+bin(raw[11],8),warmth:raw[10]};
 }
 // Same Q12 warmth transfer as Ash-Sample and the firmware.
 function applyWarmth(x,amount) {
  if(!amount)return x;
  const colour=(((x*x)>>12)*4915)>>12;
  x+=(colour*amount)>>12;
  const driven=(x*(4096+3*amount))>>12;
  let magnitude=Math.abs(driven);
  if(magnitude>2048){const excess=magnitude-2048;magnitude=excess>=4096?4096:2048+excess-((excess*excess)>>13);}
  const clipped=driven<0?-magnitude:magnitude;
  return x+(((clipped-x)*amount)>>12);
 }
 function defaults() {return [4095,4095,1024,512,512,1638,1024,0,0,0,0,0,0];}
 const headerBytes=4096,bankBytes=1204224;
 function checksum(bytes) {let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
 function bankFile(samples) {
  if(!Array.isArray(samples)||samples.length!==16)throw Error('Expected sixteen sample slots.');
  let total=headerBytes;
  for(const sample of samples)if(sample){if(!Number.isInteger(sample.rate)||sample.rate<8000||sample.rate>192000||sample.pcm.length<2)throw Error('Invalid sample.');total+=sample.pcm.length*2;}
  if(total-headerBytes>1200000)throw Error('Sample bank exceeds 1.2 MB.');
  const bytes=new Uint8Array(total),view=new DataView(bytes.buffer);bytes.set([65,83,72,80]);view.setUint32(4,2,true);view.setUint32(8,total,true);
  let offset=headerBytes;
  samples.forEach((sample,index)=>{if(!sample)return;const entry=32+index*40;view.setUint32(entry,offset,true);view.setUint32(entry+4,sample.pcm.length,true);view.setUint32(entry+8,sample.rate,true);
   const name=new TextEncoder().encode(sample.name||('Sample '+(index+1)));bytes.set(name.subarray(0,23),entry+12);
   for(const value of sample.pcm){if(!Number.isInteger(value)||value< -32768||value>32767)throw Error('Invalid sample PCM.');view.setInt16(offset,value,true);offset+=2;}
  });
  view.setUint32(12,checksum(bytes.subarray(headerBytes)),true);return bytes;
 }
 function readBank(bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length<headerBytes||bytes.length>bankBytes)throw Error('Invalid sample bank size.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),total=view.getUint32(8,true);
  if(bytes[0]!==65||bytes[1]!==83||bytes[2]!==72||bytes[3]!==80||view.getUint32(4,true)!==2||total!==bytes.length||total%2||total-headerBytes>1200000||view.getUint32(12,true)!==checksum(bytes.subarray(headerBytes)))throw Error('Invalid sample bank checksum or header.');
  return Array.from({length:16},(_,index)=>{const entry=32+index*40,offset=view.getUint32(entry,true),frames=view.getUint32(entry+4,true),rate=view.getUint32(entry+8,true);if(!frames)return null;
   if(frames<2||offset<headerBytes||offset%2||offset>total||frames>(total-offset)/2||rate<8000||rate>192000)throw Error('Invalid sample bank entry.');
   const nameBytes=bytes.subarray(entry+12,entry+36),end=nameBytes.indexOf(0);const name=new TextDecoder().decode(end<0?nameBytes:nameBytes.subarray(0,end));
   const pcm=new Int16Array(frames);for(let i=0;i<frames;i++)pcm[i]=view.getInt16(offset+i*2,true);return {name,rate,pcm};
  });
 }
 function rawFor(value,min,max) {return Math.min(4095,Math.ceil((value-min)*4096/(max-min+1)));}
 function validClock(c) {
  if(!c||!Number.isInteger(c.source)||c.source<0||c.source>2||!Number.isInteger(c.output)||c.output<0||c.output>3)throw Error('Invalid clock settings.');
  return {source:c.source,output:c.output};
 }
 function validMidi(midi) {
  if(!Array.isArray(midi)||midi.length!==4||!midi.every(m=>m&&Number.isInteger(m.note)&&m.note>=0&&m.note<=127&&Number.isInteger(m.channel)&&m.channel>=1&&m.channel<=16))throw Error('MIDI notes must be 0–127 and channels 1–16.');
  return midi.map(m=>({note:m.note,channel:m.channel}));
 }
 function validState(data) {
  if(!data||data.format!=='ash-pulse-four-1'||!Array.isArray(data.raw)||data.raw.length!==13||!data.raw.every(v=>Number.isInteger(v)&&v>=0&&v<=4095)||!Number.isInteger(data.kit)||data.kit<0||data.kit>3||!Array.isArray(data.samples)||data.samples.length!==16) throw Error('Invalid Pulse backup.');
  let bytes=0;
  const samples=data.samples.map(s=>{
   if(s===null) return null;
   if(!s||typeof s.name!=='string'||s.name.length>256||!Number.isInteger(s.rate)||s.rate<8000||s.rate>192000||!Array.isArray(s.pcm)||s.pcm.length<2||!s.pcm.every(v=>Number.isInteger(v)&&v>=-32768&&v<=32767)) throw Error('Invalid sample in backup.');
   bytes+=s.pcm.length*2;if(bytes>1200000) throw Error('Sample bank exceeds 1.2 MB.');
   return {name:s.name,rate:s.rate,pcm:Int16Array.from(s.pcm)};
  });
  return {raw:data.raw.slice(),kit:data.kit,samples,...(data.midi?{midi:validMidi(data.midi)}:{}),...(data.clock?{clock:validClock(data.clock)}:{})};
 }
 root.AshPulse={names,hit,decode,applyWarmth,defaults,bankFile,readBank,checksum,headerBytes,bankBytes,rawFor,validState,validMidi,validClock};
 if(typeof module!=='undefined') module.exports=root.AshPulse;
})(globalThis);
