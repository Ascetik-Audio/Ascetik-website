import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
function setup() {
  const html=readFileSync(new URL('index.html',root),'utf8');
  class Element {
    constructor(){this.value='';this.listeners={};this.style={setProperty(){}};this.classList={toggle(){}};this.dataset={};}
    get value(){return this._value;}set value(v){this._value=String(v);}
    addEventListener(event,handler){this.listeners[event]=handler;}
    setAttribute(){}removeAttribute(){}
    blur(){this.listeners.change?.();}
    dispatch(event){return this.listeners[event]?.({preventDefault(){},key:'Enter'});}
  }
  const ids=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const fields=[...html.matchAll(/data-cc-index="(\d+)"/g)].map(m=>{const e=new Element();e.dataset.ccIndex=m[1];return e;});
  ids.get('brightness').min='0';ids.get('brightness').max='127';ids.get('vel').min='1';ids.get('vel').max='127';ids.get('midiChannel').min='1';ids.get('midiChannel').max='16';
  let connection;
  class Connection {
    constructor(handlers){this.handlers=handlers;this.ready=false;this.syncing=false;this.sent=[];connection=this;}
    start(){this.ready=true;this.handlers.onSettings(context.AshMidiProtocol.defaults());this.handlers.onConnection();}
    async retry(){this.start();}
    async send(command,payload){this.sent.push({command,payload});return context.AshMidiProtocol.defaults();}
  }
  const context=vm.createContext({document:{getElementById:id=>{assert(ids.has(id),`Missing element ${id}`);return ids.get(id);},querySelectorAll:selector=>{assert.equal(selector,'.cc-field');return fields;}},setTimeout,clearTimeout,AshMidiConnection:{Connection},console});
  vm.runInContext(readFileSync(new URL('js/protocol.js',root),'utf8'),context);
  vm.runInContext(readFileSync(new URL('js/main.js',root),'utf8'),context);
  return {ids,fields,connection};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,120));
test('page waits for Connect, renders all 22 mappings, and keeps their actual indices',async()=>{
  const {fields,connection,ids}=setup();assert.equal(connection.ready,false);
  await ids.get('connect').dispatch('click');assert(connection.ready);assert.equal(fields.length,22);
  const leaf=fields.find(f=>f.dataset.ccIndex==='21'),button=fields.find(f=>f.dataset.ccIndex==='13');
  assert.equal(leaf.value,'41');assert.equal(button.value,'33');
  // Leaf follows the eight buttons; its MIDI mapping remains index 21.
  assert.equal(fields.at(-1),leaf);
  leaf.value='119';leaf.dispatch('change');await settle();
  let sent=connection.sent.at(-1);assert.equal(sent.command,2);assert.equal(sent.payload[24],119);assert.equal(sent.payload[16],33);
  ids.get('storePreset').dispatch('click');await settle();
  assert.equal(connection.sent.at(-1).command,3);
  sent=connection.sent.at(-2);assert.equal(sent.command,2);assert.equal(sent.payload[24],119);assert.equal(sent.payload[16],33);
});
test('channel and velocity sliders send live settings without an Apply button',async()=>{
  const {ids,connection}=setup();await ids.get('connect').dispatch('click');ids.get('vel').value='83';ids.get('vel').dispatch('input');
  ids.get('midiChannel').value='12';ids.get('midiChannel').dispatch('input');await settle();
  assert.equal(connection.sent.length,1);assert.equal(connection.sent[0].payload[1],12);assert.equal(connection.sent[0].payload[2],83);
  assert.equal(ids.get('velVal').textContent,'83');
});

test('brightness slider loads state and sends its value before storing to EEPROM',async()=>{
  const {ids,connection}=setup();await ids.get('connect').dispatch('click');assert.equal(ids.get('brightness').value,'32');
  ids.get('brightness').value='95';ids.get('brightness').dispatch('input');await settle();
  assert.equal(ids.get('brightnessVal').textContent,'95');assert.equal(connection.sent.at(-1).payload[25],95);
  ids.get('storePreset').dispatch('click');await settle();
  assert.equal(connection.sent.at(-1).command,3);assert.equal(connection.sent.at(-2).payload[25],95);
});
