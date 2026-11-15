(() => {
'use strict';
const {CAPACITY,HEADER,previewLoop,normalizePCM,encodeBank,decodeBank,number7,pack,unpack,crc32}=window.AshSampleBank;
const $=id=>document.getElementById(id),status=$('monitorLog');
let slots=Array(8).fill(null),selected=0,busy=false,context,source,previewGain,singleSlotSupported=false;
function log(message,error=false){status.textContent=message;status.style.color=error?'#808080':'';}
function connected(){return connection.ready;}
function update(){
 const used=slots.reduce((n,s)=>n+(s?.pcm.length||0)*2,0);$('usage').textContent=`${(used/48000).toFixed(2)} / ${((CAPACITY-HEADER)/48000).toFixed(2)} seconds · ${(used/1024).toFixed(0)} KB used`;
 $('space').max=CAPACITY-HEADER;$('space').value=used;
 $('slots').replaceChildren(...slots.map((s,i)=>{const b=document.createElement('button');b.textContent=`${String(i+1).padStart(2,'0')} · ${s?.name||'Empty'}`;b.className=i===selected?'active':'';b.setAttribute('aria-pressed',String(i===selected));b.onclick=()=>{stopPreview();selected=i;update();};b.disabled=busy;return b;}));
 $('deviceControls').disabled=busy||!connected();
 const s=slots[selected];$('selectedTitle').textContent=`Slot ${String(selected+1).padStart(2,'0')}`;$('selectedName').textContent=s?.name||'No file selected.';
 $('send').disabled=busy||!connected()||!s;
 for(const id of ['read','saveSettings']) $(id).disabled=busy||!connected();
 for(const id of ['choose','backup','restore','connect']) $(id).disabled=busy;
 $('connect').disabled=busy||connection.syncing;
 for(const [id,active] of [['modeLoop',!!s&&!s.oneShot],['modeOneShot',!!s&&!!s.oneShot]]){const button=$(id);button.disabled=busy||!s;button.setAttribute('aria-pressed',String(active));}
 if(!source)$('preview').textContent='PREVIEW';
 for(const id of ['preview','remove']) $(id).disabled=busy||!s;
 draw();
}
function draw(){
 const canvas=$('wave'),ctx=canvas.getContext('2d'),sample=slots[selected];
 const width=canvas.clientWidth||1000,height=canvas.clientHeight||120,scale=globalThis.devicePixelRatio||1;
 canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
 ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
 ctx.clearRect(0,0,width,height);ctx.lineWidth=2;
 ctx.strokeStyle='#808080';ctx.beginPath();ctx.moveTo(0,height/2);ctx.lineTo(width,height/2);ctx.stroke();
 if(!sample)return;
 ctx.strokeStyle='#FFFFFF';ctx.beginPath();
 sample.pcm.forEach((v,i)=>{const x=i*width/(sample.pcm.length-1),y=height/2-v/32768*(height*.46);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
}
if(typeof ResizeObserver!=='undefined')new ResizeObserver(draw).observe($('wave'));
function guard(fn){return async()=>{if(busy)return;busy=true;update();try{await fn();}catch(e){log(e.message,true);}finally{busy=false;$('progress').hidden=true;update();}};}
function request(cmd,payload=[]){return connection.send(cmd,payload);}
function updateSlider(id){const slider=$(id);slider.style.setProperty('--range-fill',`${Number(slider.value)/127*100}%`);$(`${id}Val`).textContent=slider.value;}
function settings(r){if(r.data?.length>=4)singleSlotSupported=r.data.length>=5&&!!(r.data[4]&1);$('mode').value=r.mode;$('balance').value=r.balance;$('brightness').value=r.brightness;for(const id of ['balance','brightness'])updateSlider(id);}
const connection=new globalThis.AshMidiConnection.Connection({onStatus:log,onSettings:settings,onConnection:()=>update()});
$('connect').onclick=guard(()=>connection.retry());
$('choose').onclick=()=>$('file').click();
$('file').onchange=guard(async()=>{
 const file=$('file').files[0];if(!file)return;stopPreview();
 context??=new AudioContext();const decoded=await context.decodeAudioData(await file.arrayBuffer());
 const frames=Math.round(decoded.duration*24000);if(frames<2||frames*2>CAPACITY-HEADER) throw Error('Sample is too long or too short. Trim it in an audio editor first.');
 const offline=new OfflineAudioContext(1,frames,24000),node=offline.createBufferSource();node.buffer=decoded;node.connect(offline.destination);node.start();
 const rendered=await offline.startRendering(),data=rendered.getChannelData(0),pcm=normalizePCM(data);
 const candidate=slots.slice();candidate[selected]={name:file.name.replace(/\.wav$/i,''),pcm,loopStart:0,loopEnd:pcm.length};encodeBank(candidate);slots=candidate;log(`Slot ${String(selected+1).padStart(2,'0')} converted and normalized. Send this slot to update the device.`);$('file').value='';
});
function setPlaybackMode(oneShot){stopPreview();const s=slots[selected];if(!s)return;if(oneShot)s.oneShot=true;else delete s.oneShot;update();}
$('modeLoop').onclick=()=>setPlaybackMode(false);
$('modeOneShot').onclick=()=>setPlaybackMode(true);
$('remove').onclick=guard(async()=>{
 stopPreview();const slot=selected;
 if(connected())await transferSlot(slot,null);
 slots[slot]=null;
 log(`Slot ${String(slot+1).padStart(2,'0')} cleared${connected()?' on Ash and in the editor':' in the editor'}.`);
});
function stopPreview(){
 if(!source)return;
 const playing=source;source=null;
 const now=context.currentTime;
 previewGain.gain.cancelScheduledValues(now);previewGain.gain.setValueAtTime(previewGain.gain.value,now);previewGain.gain.linearRampToValueAtTime(0,now+.01);
 playing.stop(now+.012);$('preview').textContent='PREVIEW';
}
$('preview').onclick=async()=>{
 if(source){stopPreview();return;}
 try{
  context??=new AudioContext();await context.resume();
  const loop=previewLoop(slots[selected]),buffer=context.createBuffer(1,loop.data.length,24000);buffer.copyToChannel(loop.data,0);
  source=context.createBufferSource();source.buffer=buffer;source.loop=!slots[selected].oneShot;source.loopStart=loop.loopStart/24000;source.loopEnd=loop.loopEnd/24000;
  previewGain=context.createGain();previewGain.gain.setValueAtTime(0,context.currentTime);previewGain.gain.linearRampToValueAtTime(.3,context.currentTime+.01);
  source.connect(previewGain).connect(context.destination);const playing=source;playing.onended=()=>{if(source===playing){source=null;update();}};source.start();$('preview').textContent='STOP PREVIEW';
 }catch(e){log(e.message,true);}
};

function download(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('backup').onclick=()=>{try{download(encodeBank(slots),'Ash-Sample-bank.ashs');log('Bank backup downloaded.');}catch(e){log(e.message,true);}};
$('restore').onclick=()=>$('bankFile').click();
$('bankFile').onchange=guard(async()=>{stopPreview();const file=$('bankFile').files[0];if(file){slots=decodeBank(new Uint8Array(await file.arrayBuffer()));log('Backup loaded into editor. Use SEND SLOT for each slot to install on Ash.');}$('bankFile').value='';});
function progress(value,max){$('progress').hidden=false;$('progress').max=max;$('progress').value=value;}
async function transferSlot(slot,sample){
 if(!singleSlotSupported)throw Error('Install the latest Ash Sample firmware and reconnect to update device slots.');
 const normalized=sample?{...sample,pcm:normalizePCM(Float32Array.from(sample.pcm,x=>x/32768))}:null;
 const single=Array(8).fill(null);single[slot]=normalized;
 const bank=encodeBank(single),pcm=bank.subarray(HEADER),entry=bank.subarray(32+slot*40,72+slot*40);
 log(`${sample?'Sending':'Clearing'} slot ${String(slot+1).padStart(2,'0')}…`);
 let begun=false;
 try{
  await request(12,[slot,normalized?.oneShot?1:0,...pack(entry),...number7(crc32(pcm),5)]);begun=true;
  for(let offset=0;offset<pcm.length;offset+=256){await request(13,[...number7(offset),...pack(pcm.subarray(offset,offset+256))]);progress(Math.min(pcm.length,offset+256),pcm.length);}
  await request(14);slots[slot]=normalized;log(`Slot ${String(slot+1).padStart(2,'0')} updated. Other device slots unchanged.`);
 }catch(e){if(begun){try{await request(11);}catch{}}throw e;}
}
$('send').onclick=guard(async()=>{
 stopPreview();
 const slot=selected,sample=slots[slot];
 if(!sample)throw Error('Choose a sample before sending this slot.');
 await transferSlot(slot,sample);
});
$('read').onclick=guard(async()=>{
 stopPreview();log('Reading sample bank…');
 const first=unpack((await request(10,number7(0))).data);if(first.length!==256)throw Error('Invalid bank response');
 const length=new DataView(first.buffer).getUint32(8,true);if(length<HEADER||length>CAPACITY)throw Error('Invalid bank length');
 const bank=new Uint8Array(length);bank.set(first);
 for(let offset=256;offset<length;offset+=256){const part=unpack((await request(10,number7(offset))).data);if(part.length!==Math.min(256,length-offset))throw Error('Incomplete bank response');bank.set(part,offset);progress(offset+part.length,length);}
 slots=decodeBank(bank);log('Sample bank loaded from device.');
});
function settingsPayload(){const values=[+$('mode').value,+$('balance').value,+$('brightness').value];if(![0,1].includes(values[0])||values.slice(1).some(v=>!Number.isInteger(v)||v<0||v>127))throw Error('Balance and brightness must be whole numbers from 0 to 127.');return values;}
const applySettings=guard(async()=>{settings(await request(2,settingsPayload()));log('Device settings updated.');});
$('saveSettings').onclick=guard(async()=>{await request(2,settingsPayload());await request(3);log('Settings stored on the device');});
for(const id of ['balance','brightness']){updateSlider(id);$(id).oninput=()=>updateSlider(id);$(id).onchange=()=>{if(connected())return applySettings();};}
$('mode').onchange=()=>{if(connected())return applySettings();};
update();

log('Press Connect to device to connect Ascetik Ash Sample.');

})();
