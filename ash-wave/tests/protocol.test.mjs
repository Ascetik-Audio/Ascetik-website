import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../js/protocol.js';
import '../js/wav.js';
const P=globalThis.AshMidiProtocol,W=globalThis.AshWaveWav;
test('Wave handshake rejects Ash MIDI and malformed replies',()=>{
 const bytes=P.request(65,7,[0,1,64,32]);assert.equal(P.response(bytes).settings.mode,1);
 bytes[5]=1;assert.equal(P.response(bytes),null);bytes[5]=2;bytes[9]=2;assert.equal(P.response(bytes),null);
 assert.throws(()=>P.request(1,1,[128]));
});
test('signed extrema survive 7-bit packing and CRC32 uses canonical little-endian samples',()=>{
 const table=Int16Array.from({length:1024},(_,i)=>[-32768,-1,0,1,32767][i%5]);
 const bytes=P.tableBytes(table);assert.equal(new DataView(bytes.buffer).getInt16(0,true),-32768);
 for(let offset=0;offset<1024;offset+=64) {
   const c=P.chunk(table,1,offset);assert(c.every(n=>n>=0&&n<128));
   for(let i=0;i<64;i++) {let n=c[3+i*3]|(c[4+i*3]<<7)|(c[5+i*3]<<14);if(n>=32768)n-=65536;assert.equal(n,table[offset+i]);}
 }
 const commit=P.commit(table,1);let crc=0;for(let i=0;i<5;i++) crc|=commit[i+1]<<(7*i);
 assert.equal(crc>>>0,P.checksum(bytes));assert.equal(P.checksum(new TextEncoder().encode('123456789')),0xcbf43926);
});
function wave({bits=16,type=1,channels=1,frames=256,value=i=>Math.sin(2*Math.PI*i/256),junk=false}={}) {
 const stride=bits/8*channels,offset=junk?56:44,buffer=new ArrayBuffer(offset+frames*stride),v=new DataView(buffer),b=new Uint8Array(buffer);
 const tag=(offset,text)=>b.set(new TextEncoder().encode(text),offset);
 tag(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,type,true);v.setUint16(22,channels,true);v.setUint32(24,48000,true);v.setUint32(28,48000*stride,true);v.setUint16(32,stride,true);v.setUint16(34,bits,true);
 if(junk) {tag(36,'JUNK');v.setUint32(40,3,true);}
 tag(offset-8,'data');v.setUint32(offset-4,frames*stride,true);
 for(let i=0;i<frames;i++) for(let c=0;c<channels;c++) {
   const p=offset+i*stride+c*bits/8,x=value(i,c);
   if(type===3) {if(bits===32) v.setFloat32(p,x,true);else v.setFloat64(p,x,true);}
   else if(bits===8) v.setUint8(p,Math.max(0,Math.min(255,128+Math.round(x*127))));
   else if(bits===16) v.setInt16(p,Math.round(x*32767),true);
   else if(bits===24) {const n=Math.round(x*8388607);b[p]=n&255;b[p+1]=(n>>8)&255;b[p+2]=(n>>16)&255;}
   else v.setInt32(p,Math.round(x*2147483647),true);
 }
 return buffer;
}
test('WAV converter handles PCM and float, stereo downmix, chunk padding and DC removal',()=>{
 for(const bits of [8,16,24,32]) {
   const table=W.decode(wave({bits,channels:2,junk:true}));assert.equal(table.length,1024);assert(table[256]>32000);assert(table[768]<-32000);assert(Math.abs(table[0])<8);
 }
 for(const bits of [32,64]) assert(W.decode(wave({bits,type:3,value:i=>.4+.2*Math.sin(2*Math.PI*i/256)}))[256]>32000);
});
test('WAV converter rejects silent, truncated and nonfinite inputs',()=>{
 assert.throws(()=>W.decode(wave({value:()=>0})),/silent/);
 assert.throws(()=>W.decode(wave().slice(0,100)),/Invalid RIFF/);
 assert.throws(()=>W.decode(wave({bits:32,type:3,value:()=>NaN})),/invalid samples/);
});
test('periodic downsampling suppresses harmonics above the new Nyquist limit',()=>{
 const table=W.decode(wave({frames:4096,bits:32,type:3,value:i=>.5*Math.sin(2*Math.PI*i/4096)+.25*Math.sin(2*Math.PI*800*i/4096)}));
 let error=0;for(let i=0;i<1024;i++) error+=Math.abs(table[i]/32767-Math.sin(2*Math.PI*i/1024));assert(error/1024<.02);
});
