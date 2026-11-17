(()=>{
'use strict';
function decode(buffer) {
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<44||buffer.byteLength>64*1024*1024) throw Error('Choose a WAV file smaller than 64 MB.');
 const view=new DataView(buffer),tag=o=>String.fromCharCode(...new Uint8Array(buffer,o,4));
 if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||view.getUint32(4,true)+8>buffer.byteLength) throw Error('Invalid RIFF WAV file.');
 const end=view.getUint32(4,true)+8;let format=null,data=null;
 for(let pos=12;pos+8<=end;) {
   const name=tag(pos),size=view.getUint32(pos+4,true),start=pos+8;
   if(start+size>end) throw Error('Truncated WAV chunk.');
   if(name==='fmt ') {
     if(size<16) throw Error('Invalid WAV format.');
     format={type:view.getUint16(start,true),channels:view.getUint16(start+2,true),rate:view.getUint32(start+4,true),align:view.getUint16(start+12,true),bits:view.getUint16(start+14,true)};
     // WAVE_FORMAT_EXTENSIBLE PCM / float, with the canonical subtype GUID.
     if(format.type===65534) {
       if(size<40||view.getUint16(start+16,true)<22||view.getUint16(start+18,true)!==format.bits) throw Error('Unsupported extensible WAV format.');
       const guid=new Uint8Array(buffer,start+24,16),tail=[0,0,0,0,16,0,128,0,0,170,0,56,155,113];
       if(!tail.every((v,i)=>guid[i+2]===v)) throw Error('Unsupported WAV subtype.');
       format.type=view.getUint16(start+24,true);
     }
   }
   if(name==='data'&&!data) data={start,size};pos=start+size+(size&1);
 }
 if(!format||!data) throw Error('WAV format or audio data is missing.');
 const {type,channels,rate,align,bits}=format;
 if(![1,3].includes(type)||!Number.isInteger(channels)||channels<1||channels>8||rate<1||!(type===1?[8,16,24,32]:[32,64]).includes(bits)||align!==channels*bits/8||data.size%align) throw Error('Use PCM 8/16/24/32-bit or float 32/64-bit WAV.');
 const frames=data.size/align;if(frames<2||frames>1048576) throw Error('Choose one waveform cycle (2–1048576 samples).');
 const samples=new Float64Array(frames);let mean=0;
 for(let i=0;i<frames;i++) {
   let sum=0;for(let c=0;c<channels;c++) {
     const o=data.start+i*align+c*bits/8;let x;
     if(type===3) x=bits===32?view.getFloat32(o,true):view.getFloat64(o,true);
     else if(bits===8) x=(view.getUint8(o)-128)/128;
     else if(bits===16) x=view.getInt16(o,true)/32768;
     else if(bits===24) {let n=view.getUint8(o)|(view.getUint8(o+1)<<8)|(view.getUint8(o+2)<<16);if(n&0x800000) n-=0x1000000;x=n/8388608;}
     else x=view.getInt32(o,true)/2147483648;
     if(!Number.isFinite(x)) throw Error('WAV contains invalid samples.');sum+=x;
   }
   samples[i]=sum/channels;mean+=samples[i]/frames;
 }
 // Periodic windowed-sinc resampling. Anti-alias before reducing cycle length.
 const converted=new Float64Array(1024),cutoff=Math.min(1,1024/frames),radius=Math.min(frames*2,Math.ceil(16/cutoff));
 const sinc=x=>Math.abs(x)<1e-9?1:Math.sin(Math.PI*x)/(Math.PI*x);
 let peak=0;
 for(let i=0;i<1024;i++) {
   const pos=i*frames/1024,center=Math.floor(pos);let value=0,weight=0;
   for(let k=center-radius+1;k<=center+radius;k++) {
     const d=pos-k,w=cutoff*sinc(d*cutoff)*(.5+.5*Math.cos(Math.PI*d/radius));
     const index=((k%frames)+frames)%frames;value+=(samples[index]-mean)*w;weight+=w;
   }
   converted[i]=value/weight;peak=Math.max(peak,Math.abs(converted[i]));
 }
 if(peak<1e-10) throw Error('No usable waveform in this WAV.');
 return Int16Array.from(converted,v=>Math.max(-32768,Math.min(32767,Math.round(v/peak*32767))));
}
globalThis.AshWaveWav={decode};
})();
