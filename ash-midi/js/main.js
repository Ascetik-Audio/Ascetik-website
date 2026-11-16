(function () {
  'use strict';
  const {defaults,labels,validate,encode,preset,importPreset,commands}=globalThis.AshMidiProtocol;
  const byId=id=>document.getElementById(id);
  const velocity=byId('vel'),channel=byId('midiChannel'),mode=byId('deviceMode'),brightness=byId('brightness');
  const fields=[...document.querySelectorAll('.cc-field')];
  const store=byId('storePreset'),load=byId('loadPreset'),save=byId('savePreset');
  let settings=defaults(),revision=0,sentRevision=0,locked=false,timer=null,flushing=null;
  function status(message,error=false) {byId('monitorLog').textContent=message;byId('monitorLog').classList.toggle('error',error);}
  const connection=new globalThis.AshMidiConnection.Connection({
    onStatus:status,
    onConnection:()=>controls(),
    onSettings:next=>{
      clearTimeout(timer);settings=next;revision=sentRevision=0;render();
    }
  });
  function controls() {
    const disabled=locked||connection.syncing;
    for(const field of [velocity,channel,brightness,mode,...fields,byId('presetName'),save,load]) field.disabled=disabled;
    byId('connect').disabled=disabled;
    store.disabled=disabled||!connection.ready;
  }
  function rangeFill(input) {input.style.setProperty('--range-fill',`${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);}
  function render() {
    velocity.value=settings.velocity;channel.value=settings.channel;mode.value=settings.mode;brightness.value=settings.brightness;
    byId('velVal').textContent=velocity.value;byId('midiChannelVal').textContent=channel.value;
    rangeFill(velocity);rangeFill(channel);rangeFill(brightness);byId('brightnessVal').textContent=brightness.value;
    fields.forEach(field=>{field.value=settings.cc[Number(field.dataset.ccIndex)];field.removeAttribute('aria-invalid');});
    controls();
  }
  function collect() {
    const cc=[...settings.cc];
    fields.forEach(field=>{
      if(!/^\d{1,3}$/.test(field.value)||Number(field.value)>127) {field.setAttribute('aria-invalid','true');throw Error('CC numbers must be 0–127');}
      cc[Number(field.dataset.ccIndex)]=Number(field.value);
    });
    return validate({mode:Number(mode.value),channel:Number(channel.value),velocity:Number(velocity.value),brightness:Number(brightness.value),cc});
  }
  function changed() {
    ++revision;
    if(!connection.ready) {status('Settings changed locally — connect Ash to configure the device');return;}
    clearTimeout(timer);timer=setTimeout(()=>{void flush().catch(e=>status(e.message,true));},80);
  }
  function flush() {
    if(flushing) return flushing;
    const run=async()=>{
      while(connection.ready&&sentRevision<revision) {
        const current=revision;const snapshot=validate(settings);
        await connection.send(commands.set,encode(snapshot));sentRevision=current;
      }
    };
    flushing=run().finally(()=>{flushing=null;});return flushing;
  }
  async function action(callback) {
    if(locked||connection.syncing) return;locked=true;controls();clearTimeout(timer);
    try {await flush();await callback();}catch(e){status(e.message,true);}finally{locked=false;controls();}
  }
  byId('connect').addEventListener('click',()=>action(()=>connection.retry()));
  for(const input of [velocity,channel,brightness]) input.addEventListener('input',()=>{
    settings[input===velocity?'velocity':input===channel?'channel':'brightness']=Number(input.value);
    byId(input===velocity?'velVal':input===channel?'midiChannelVal':'brightnessVal').textContent=input.value;rangeFill(input);changed();
  });
  mode.addEventListener('change',()=>{settings.mode=Number(mode.value);render();changed();});
  fields.forEach(field=>{
    const i=Number(field.dataset.ccIndex);field.title=`${labels[i]} CC number`;field.setAttribute('aria-label',`${labels[i]} CC number`);
    field.addEventListener('input',()=>{field.value=field.value.replace(/\D/g,'').slice(0,3);field.removeAttribute('aria-invalid');});
    field.addEventListener('change',()=>{
      if(field.value==='') {field.value=settings.cc[i];return;}
      const value=Math.min(127,Number(field.value));field.value=value;settings.cc[i]=value;changed();
    });
    field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();field.blur();}});
  });
  store.addEventListener('click',()=>void action(async()=>{
    settings=collect();++revision;await flush();await connection.send(commands.save);status('Settings stored on the device');
  }));
  save.addEventListener('click',()=>{
    try {
      const name=byId('presetName').value.trim()||'ascetik-ash-midi';
      const blob=new Blob([JSON.stringify(preset(name,collect()),null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;
      link.download=name.replace(/[^a-z0-9_-]/gi,'-')+'.json';document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);status('Device settings saved to file');
    }catch(e){status(e.message,true);}
  });
  const file=byId('presetFile');load.addEventListener('click',()=>file.click());
  file.addEventListener('change',()=>void action(async()=>{
    try {
      const selected=file.files?.[0];if(!selected)return;if(selected.size>65536)throw Error('Preset file is too large');
      const imported=importPreset(await selected.text());settings=imported.settings;byId('presetName').value=imported.name;
      ++revision;render();
      if(connection.ready) {await flush();status('JSON loaded and sent to device');}else status('JSON loaded locally');
    }finally{file.value='';}
  }));
  render();status('Click Connect to Ash-MIDI to get started.');
})();
