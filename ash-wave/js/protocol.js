(()=>{
'use strict';
const prefix=[0x7d,0x41,0x53,0x48,2];
const commands={get:1,set:2,save:3,beginTable:7,tableChunk:8,commitTable:9};
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
function request(command,sequence,payload=[]) {
 if(![command,sequence,...payload].every(v=>integer(v,0,127))) throw Error('Invalid MIDI data.');
 return [0xf0,...prefix,command,sequence,...payload,0xf7];
}
function validate(s) {
 if(!s||!integer(s.mode,0,1)||!integer(s.balance,0,127)||!integer(s.brightness,0,127)) throw Error('Invalid device settings.');
 return {mode:s.mode,balance:s.balance,brightness:s.brightness};
}
function encode(s) {s=validate(s);return [s.mode,s.balance,s.brightness];}
function response(bytes) {
 const p=Array.from(bytes);
 if(p.length!==13||p[0]!==0xf0||p[12]!==0xf7||!prefix.every((v,i)=>p[i+1]===v)||!p.slice(1,-1).every(v=>integer(v,0,127))||p[6]<64) return null;
 try {return {command:p[6]&63,sequence:p[7],status:p[8],settings:validate({mode:p[9],balance:p[10],brightness:p[11]})};}catch{return null;}
}
function checksum(bytes) {
 let crc=0xffffffff;for(const byte of bytes) {crc^=byte;for(let i=0;i<8;i++) crc=(crc>>>1)^(0xedb88320&-(crc&1));}return (~crc)>>>0;
}
function tableBytes(table) {
 if(!(table instanceof Int16Array)||table.length!==1024) throw Error('A wavetable must have 1024 signed 16-bit samples.');
 const bytes=new Uint8Array(2048),view=new DataView(bytes.buffer);table.forEach((v,i)=>view.setInt16(i*2,v,true));return bytes;
}
function chunk(table,id,offset,count=64) {
 tableBytes(table);if(!integer(id,0,1)||!integer(offset,0,1023)||!integer(count,1,64)||offset+count>1024) throw Error('Invalid table chunk.');
 const data=[id,offset&127,offset>>7];
 for(let i=offset;i<offset+count;i++) {const v=table[i]&65535;data.push(v&127,(v>>7)&127,(v>>14)&3);}return data;
}
function commit(table,id) {
 if(!integer(id,0,1)) throw Error('Invalid table.');const crc=checksum(tableBytes(table));return [id,...Array.from({length:5},(_,i)=>(crc>>>(i*7))&127)];
}
globalThis.AshMidiProtocol={prefix,commands,request,response,validate,encode,checksum,tableBytes,chunk,commit};
})();
