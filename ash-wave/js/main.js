(()=>{
'use strict';
const $=id=>document.getElementById(id),P=globalThis.AshMidiProtocol,W=globalThis.AshWaveWav;
const tables=[null,null],loaded=[0,0];let connected=false,busy=false;
function status(message,error=false) {$('monitorLog').textContent=message;$('monitorLog').style.color=error?'#808080':'';}
function controls() {
 $('connect').disabled=busy||connection.syncing;
 $('deviceControls').disabled=busy;$('store').disabled=!connected||busy;
 ['A','B'].forEach((name,i)=>{$(`send${name}`).disabled=!connected||busy||!tables[i];$(`file${name}`).disabled=busy;$(`choose${name}`).disabled=busy;});
}
function updateSlider(id) {
 const slider=$(id),min=Number(slider.min),max=Number(slider.max);
 slider.style.setProperty('--range-fill',`${(Number(slider.value)-min)/(max-min)*100}%`);
 $(`${id}Val`).textContent=slider.value;
}
function settings(s) {
 $('balance').value=s.balance;$('brightness').value=s.brightness;
 for(const id of ['balance','brightness']) updateSlider(id);
}
const connection=new globalThis.AshMidiConnection.Connection({
 onStatus:status,onSettings:settings,onConnection:ready=>{connected=ready;controls();}
});
async function run(job) {
 if(busy) return;busy=true;controls();
 try {await job();}catch(e) {status(e.message,true);}finally {busy=false;controls();}
}
for(const id of ['balance','brightness']) {
 updateSlider(id);
 $(id).addEventListener('input',()=>updateSlider(id));
}
for(const id of ['balance','brightness']) $(id).addEventListener('change',()=>{
 if(!connected) return;
 return run(async()=>{
 const reply=await connection.send(P.commands.set,[0,Number($('balance').value),Number($('brightness').value)]);
 settings(reply);status('Device settings updated.');
 });
});
$('connect').addEventListener('click',()=>run(()=>connection.retry()));
$('store').addEventListener('click',()=>run(async()=>{await connection.send(P.commands.save);status('Both device tables, brightness, USB audio balance stored to EEPROM.');}));
function draw(name,table) {
 const canvas=$(`preview${name}`),ctx=canvas.getContext('2d');
 const width=canvas.clientWidth,height=canvas.clientHeight,scale=window.devicePixelRatio||1;
 if(!width||!height) return;
 canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
 ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
 ctx.clearRect(0,0,width,height);ctx.lineWidth=2;
 ctx.strokeStyle='#808080';ctx.beginPath();ctx.moveTo(0,height/2);ctx.lineTo(width,height/2);ctx.stroke();
 if(!table) return;ctx.strokeStyle='#FFFFFF';ctx.beginPath();
 table.forEach((v,i)=>{const x=i*width/(table.length-1),y=height/2-v/32768*(height*.46);if(i) ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
}
['A','B'].forEach((name,id)=>{
 draw(name,null);
 $(`choose${name}`).addEventListener('click',()=>$(`file${name}`).click());
 $(`file${name}`).addEventListener('change',async()=>{
   const generation=++loaded[id],file=$(`file${name}`).files[0];tables[id]=null;draw(name,null);controls();
   if(!file) {$(`name${name}`).textContent='No file selected.';return;}
   try {
     if(file.size>64*1024*1024) throw Error('Choose a WAV file smaller than 64 MB.');
     const table=W.decode(await file.arrayBuffer());if(generation!==loaded[id]) return;
     tables[id]=table;draw(name,table);$(`name${name}`).textContent=file.name;status(`Table ${name} converted. Send it to update the device.`);
   }catch(e) {if(generation===loaded[id]) {$(`name${name}`).textContent='Conversion failed.';status(e.message,true);}}
   controls();
 });
 $(`send${name}`).addEventListener('click',()=>run(async()=>{
   const table=tables[id];if(!table) throw Error('Choose a WAV file first.');
   $('transferProgress').hidden=false;$('transferProgress').value=0;
   try {
     status(`Sending table ${name}…`);await connection.send(P.commands.beginTable,[id]);
     for(let offset=0;offset<1024;offset+=64) {await connection.send(P.commands.tableChunk,P.chunk(table,id,offset));$('transferProgress').value=offset+64;}
     await connection.send(P.commands.commitTable,P.commit(table,id));
     $(`name${name}`).textContent=$(`file${name}`).files[0].name;status(`Table ${name} updated. Use Store to EEPROM to keep it after power-off.`);
   }finally {$('transferProgress').hidden=true;}
 }));
});
const previewResize=new ResizeObserver(()=>['A','B'].forEach((name,id)=>draw(name,tables[id])));
for(const name of ['A','B']) previewResize.observe($(`preview${name}`));
controls();
status('Press Connect to device to connect Ascetik Ash Wave.');
})();
