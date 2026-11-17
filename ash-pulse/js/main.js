(() => {
 'use strict';
 const P=AshPulse,$=id=>document.getElementById(id);
 let raw=P.defaults(),kit=0,voice=0,samples=ASH_PULSE_DEFAULTS.map(s=>({...s,pcm:Int16Array.from(s.pcm)}));
 let context;
 let port,reader,writer,connected=false,deviceBusy=false,line='',pendingWrite=Promise.resolve();
 const active=new Map();
 function status(message,error=false){$('monitorLog').textContent=message;$('monitorLog').classList.toggle('error',error);}
 function fail(e){status(e.message||String(e),true);}
 async function audio(){if(!context) context=new AudioContext();await context.resume();return context;}
 function buffer(s){const b=context.createBuffer(1,s.pcm.length,s.rate);const v=b.getChannelData(0);for(let i=0;i<v.length;i++) v[i]=s.pcm[i]/32768;return b;}
 function sound(d,time,pitch){
  const sample=samples[kit*3+d];if(!sample) return;
  const previous=active.get(d);if(previous){previous.gain.gain.cancelScheduledValues(time);previous.gain.gain.setValueAtTime(.3,time);previous.gain.gain.linearRampToValueAtTime(0,time+.001);try{previous.source.stop(time+.001);}catch(_){}}
  const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer(sample);source.playbackRate.value=pitch;
  gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(.3,time+.001);source.connect(gain).connect(context.destination);source.start(time);
  const item={source,gain};active.set(d,item);source.onended=()=>{source.disconnect();gain.disconnect();if(active.get(d)===item) active.delete(d);};
 }
 for(let k=0;k<4;k++){const b=document.createElement('button');b.type='button';b.textContent='KIT '+(k+1);b.onclick=()=>{kit=k;renderSamples();queueDevice();};$('kits').append(b);}
 for(let d=0;d<3;d++){const b=document.createElement('button');b.type='button';b.textContent='DRUM '+(d+1);b.onclick=()=>{voice=d;renderSamples();};$('voices').append(b);}
 function renderSamples(){
  Array.from($('kits').children).forEach((b,i)=>b.setAttribute('aria-pressed',String(i===kit)));Array.from($('voices').children).forEach((b,i)=>b.setAttribute('aria-pressed',String(i===voice)));
  const s=samples[kit*3+voice];$('selectedTitle').textContent=`Kit ${kit+1} / Drum ${voice+1}`;$('selectedName').textContent=s?`${s.name} / ${(s.pcm.length/s.rate).toFixed(2)} s`:'Empty sample';$('audition').disabled=!s;$('clear').disabled=!s;
  const bytes=samples.reduce((n,s)=>n+(s?s.pcm.length*2:0),0);$('space').value=bytes;$('usage').textContent=`Storage: ${(bytes/1000).toFixed(1)} / 1200 KB used`;
  const canvas=$('wave'),c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.strokeStyle='#808080';c.beginPath();c.moveTo(0,120);c.lineTo(1000,120);c.stroke();
  if(s){c.strokeStyle='#fff';c.beginPath();for(let x=0;x<1000;x++){const a=Math.floor(x*s.pcm.length/1000),b=Math.max(a+1,Math.floor((x+1)*s.pcm.length/1000));let lo=0,hi=0;for(let i=a;i<b&&i<s.pcm.length;i++){lo=Math.min(lo,s.pcm[i]);hi=Math.max(hi,s.pcm[i]);}c.moveTo(x,120+lo*110/32768);c.lineTo(x,120+hi*110/32768);}c.stroke();}
 }
 $('choose').onclick=()=>$('file').click();
 $('file').onchange=async()=>{const file=$('file').files[0],index=kit*3+voice;$('file').value='';if(!file)return;try{
  if(file.size>24000000)throw Error('WAV is too large. Use a shorter sample.');
  const data=await file.arrayBuffer(),view=new DataView(data);const tag=(i)=>String.fromCharCode(...new Uint8Array(data,i,4));if(data.byteLength<12||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw Error('Choose a WAV file.');
  await audio();const decoded=await context.decodeAudioData(data);if(decoded.duration*24000*2>1200000)throw Error('Sample exceeds the bank budget.');
  const offline=new OfflineAudioContext(1,Math.max(2,Math.ceil(decoded.duration*24000)),24000),mono=offline.createBuffer(1,decoded.length,decoded.sampleRate),dest=mono.getChannelData(0);
  for(let ch=0;ch<decoded.numberOfChannels;ch++){const source=decoded.getChannelData(ch);for(let i=0;i<source.length;i++)dest[i]+=source[i]/decoded.numberOfChannels;}
  const source=offline.createBufferSource();source.buffer=mono;source.connect(offline.destination);source.start();const rendered=await offline.startRendering(),pcm=Int16Array.from(rendered.getChannelData(0),v=>Math.round(Math.max(-1,Math.min(1,v))*(v<0?32768:32767)));
  const bytes=samples.reduce((n,s,i)=>n+(s&&i!==index?s.pcm.length*2:0),pcm.length*2);if(bytes>1200000)throw Error('Sample bank exceeds 1.2 MB. Clear or shorten another sample.');
  samples[index]={name:file.name.slice(0,256),rate:24000,pcm};renderSamples();status('WAV loaded.');
 }catch(e){fail(e);}};
 $('audition').onclick=async()=>{try{await audio();sound(voice,context.currentTime,P.decode(raw).pitch);}catch(e){fail(e);}};
 $('clear').onclick=()=>{samples[kit*3+voice]=null;renderSamples();};
 function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('backup').onclick=()=>download('ash-pulse.ashs',JSON.stringify({format:'ash-pulse-1',raw,kit,samples:samples.map(s=>s?{...s,pcm:Array.from(s.pcm)}:null)}),'application/json');
 $('restore').onclick=()=>$('backupFile').click();
 $('backupFile').onchange=async()=>{const file=$('backupFile').files[0];$('backupFile').value='';if(!file)return;try{if(file.size>10000000)throw Error('Backup too large.');const restored=P.validState(JSON.parse(await file.text()));({raw,kit,samples}=restored);renderSamples();queueDevice();status('Backup restored.');}catch(e){fail(e);}};
 let sendTimer;
 function queueDevice(){if(!connected)return;clearTimeout(sendTimer);sendTimer=setTimeout(()=>write('P '+raw.join(' ')+' '+kit+'\n').catch(fail),40);}
 function write(text){pendingWrite=pendingWrite.catch(()=>{}).then(async()=>{if(!writer)throw Error('Ash disconnected.');await writer.write(new TextEncoder().encode(text));});return pendingWrite;}
 function updateSlider(id) {
  const input=$(id);$(id+'Val').textContent=input.value;
  input.style.setProperty('--range-fill',Number(input.value)*100/127+'%');
 }
 function settingsEnabled(on) {$('deviceControls').disabled=!on;$('saveSettings').disabled=!on;}
 for(const [id,value] of [['balance',64],['brightness',32]]) {
  $(id).value=value;updateSlider(id);
  $(id).oninput=()=>updateSlider(id);
  $(id).onchange=()=>{if(connected)write('S '+$('balance').value+' '+$('brightness').value+'\n').catch(fail);};
 }
 settingsEnabled(false);
 $('saveSettings').onclick=async()=>{if(!connected)return;try{await write('S '+$('balance').value+' '+$('brightness').value+'\n');await write('W\n');}catch(e){fail(e);}};
 function receive(text){line+=text;if(line.length>4096){line='';throw Error('Invalid serial response.');}let i;while((i=line.indexOf('\n'))>=0){const message=line.slice(0,i).trim();line=line.slice(i+1);const parts=message.split(' ');if(parts[0]==='PULSE'&&parts.length===16){const values=parts.slice(1).map(Number);if(!values.every(Number.isInteger)||values.slice(0,13).some(v=>v<0||v>4095)||values[13]<0||values[13]>3||![0,1].includes(values[14]))continue;raw=values.slice(0,13);kit=values[13];renderSamples();if(!connected){connected=true;clearTimeout(handshake);$('connect').textContent='DISCONNECT';status('Ash Pulse connected. Kit selection follows the device.');}}
  else if(parts[0]==='SETTINGS'&&parts.length===3) {
   const values=parts.slice(1).map(Number);
   if(connected&&values.every(v=>Number.isInteger(v)&&v>=0&&v<=127)) {['balance','brightness'].forEach((id,i)=>{$(id).value=values[i];updateSlider(id);});settingsEnabled(true);}
  } else if(message==='SAVED')status('Settings saved to Ash.');
  else if(message.startsWith('ERR'))status(message,true);
 }}
 let handshake;
 async function disconnect(){clearTimeout(handshake);clearTimeout(sendTimer);connected=false;settingsEnabled(false);$('connect').textContent='CONNECT TO ASH-PULSE';if(reader)await reader.cancel().catch(()=>{});}
 $('connect').onclick=async()=>{
  if(port){await disconnect();return;}if(deviceBusy)return;
  deviceBusy=true;$('connect').disabled=true;
  try{port=await navigator.serial.requestPort({filters:[{usbVendorId:0x2e8a,usbProductId:0x000a}]});await port.open({baudRate:115200});writer=port.writable.getWriter();reader=port.readable.getReader();line='';await write('Q\n');status('Checking Ash Pulse firmware…');handshake=setTimeout(()=>{status('No Pulse response. Install Ash Pulse firmware, then reconnect.',true);disconnect();},3000);
   $('connect').disabled=false;
   const decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;receive(decoder.decode(value,{stream:true}));}
  }catch(e){if(e.name!=='NotFoundError')fail(e);else status('Connection cancelled.');}
  finally{clearTimeout(handshake);connected=false;settingsEnabled(false);if(reader){reader.releaseLock();reader=null;}if(writer){await pendingWrite.catch(()=>{});writer.releaseLock();writer=null;}if(port){await port.close().catch(()=>{});port=null;}deviceBusy=false;$('connect').disabled=!navigator.serial;$('connect').textContent='CONNECT TO ASH-PULSE';}
 };
 if(!navigator.serial||!isSecureContext){$('connect').disabled=true;$('connect').title='Use desktop Chrome or Edge over HTTPS or localhost to connect.';}
 renderSamples();
})();
