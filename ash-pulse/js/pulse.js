/* Shared, DOM-free model. ADC mappings match src/engine.cpp. */
(function(root) {
 'use strict';
 const names=['Vibrato','Filter','Scale','Root','Depth','Delay','Waveform','Mode','Octave','Attack','Sustain','Decay','Release'];
 const hit=(step,length,events,offset)=>length>0&&events>0&&(((step+length-offset%length)%length)*events)%length<events;
 const bin=(raw,n)=>Math.floor(raw*n/4096);
 function decode(raw) {
  const rhythm=(l,e,o,p,d)=>{const length=1+bin(raw[l],16);return {length,events:bin(raw[e],length+1),offset:bin(raw[o],length),probability:bin(raw[p],101),divider:1+bin(raw[d],8)};};
  return {drums:[rhythm(0,2,4,7,9),rhythm(1,3,6,8,12),{length:1,events:1,offset:0,probability:100,divider:1+bin(raw[5],8)}],bpm:40+Math.floor(raw[11]*200/4095),pitch:2**(2*raw[10]/4095-1)};
 }
 function defaults() {return [4095,4095,1024,512,0,0,0,4095,4095,0,2048,1638,0];}
 function rawFor(value,min,max) {return Math.min(4095,Math.ceil((value-min)*4096/(max-min+1)));}
 function validState(data) {
  if(!data||data.format!=='ash-pulse-1'||!Array.isArray(data.raw)||data.raw.length!==13||!data.raw.every(v=>Number.isInteger(v)&&v>=0&&v<=4095)||!Number.isInteger(data.kit)||data.kit<0||data.kit>3||!Array.isArray(data.samples)||data.samples.length!==12) throw Error('Invalid Pulse backup.');
  let bytes=0;
  const samples=data.samples.map(s=>{
   if(s===null) return null;
   if(!s||typeof s.name!=='string'||s.name.length>256||!Number.isInteger(s.rate)||s.rate<8000||s.rate>192000||!Array.isArray(s.pcm)||s.pcm.length<2||!s.pcm.every(v=>Number.isInteger(v)&&v>=-32768&&v<=32767)) throw Error('Invalid sample in backup.');
   bytes+=s.pcm.length*2;if(bytes>1200000) throw Error('Sample bank exceeds 1.2 MB.');
   return {name:s.name,rate:s.rate,pcm:Int16Array.from(s.pcm)};
  });
  return {raw:data.raw.slice(),kit:data.kit,samples};
 }
 root.AshPulse={names,hit,decode,defaults,rawFor,validState};
 if(typeof module!=='undefined') module.exports=root.AshPulse;
})(globalThis);
