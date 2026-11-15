import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../js/protocol.js';
import '../js/midi.js';
const {Connection,matchingPair}=globalThis.AshMidiConnection;
const {request,encode,defaults}=globalThis.AshMidiProtocol;
function device(name='Ascetik Ash MIDI') {
  const input={id:'in',name,state:'connected',manufacturer:'Ascetik',onmidimessage:null,async open(){}};
  const sent=[];
  const output={id:'out',name,state:'connected',manufacturer:'Ascetik',async open(){},send(data){
    sent.push([...data]);
    queueMicrotask(()=>input.onmidimessage?.({data:request(data[6]|0x40,data[7],[0,...encode(defaults())])}));
  }};
  const access={inputs:new Map([['in',input]]),outputs:new Map([['out',output]])};
  return {input,output,access,sent};
}
test('automatically obtains SysEx access, pairs only Ash MIDI, and loads once',async()=>{
  const d=device();let permissions=0,loads=0;
  const connection=new Connection({onSettings:()=>loads++},{async requestMIDIAccess(options){assert.deepEqual(options,{sysex:true});permissions++;return d.access;}});
  await connection.start();assert.equal(permissions,1);assert.equal(loads,1);assert.equal(connection.ready,true);
  assert.equal(d.sent[0][6],1);await connection.refresh();assert.equal(d.sent.length,1);
  assert.equal(matchingPair(device('Other controller').access),null);
  assert.equal(matchingPair(device('Ash MIDI').access)?.input.name,'Ash MIDI');
});
test('hotplug reconnect automatically reads current settings and does not replay edits',async()=>{
  const d=device();let loads=0;
  const connection=new Connection({onSettings:()=>loads++},{async requestMIDIAccess(){return d.access;}});
  await connection.start();await connection.send(2,encode(defaults()));
  d.input.state=d.output.state='disconnected';await connection.refresh();assert.equal(connection.ready,false);
  d.input.state=d.output.state='connected';await connection.refresh();assert.equal(connection.ready,true);assert.equal(loads,2);
  assert.deepEqual(d.sent.map(p=>p[6]),[1,2,1]);
});
test('waits for Ash when initially unplugged and ignores unrelated outputs',async()=>{
  const d=device();d.output.state='disconnected';
  const connection=new Connection({}, {async requestMIDIAccess(){return d.access;}});
  await connection.start();assert.equal(connection.ready,false);assert.equal(d.sent.length,0);
  d.output.state='connected';await connection.refresh();assert.equal(connection.ready,true);
});
test('serializes commands and preserves latest request sequencing',async()=>{
  const d=device(),connection=new Connection({}, {async requestMIDIAccess(){return d.access;}});
  await connection.start();await Promise.all([connection.send(2,encode(defaults())),connection.send(3)]);
  assert.deepEqual(d.sent.map(p=>p[6]),[1,2,3]);assert.equal(new Set(d.sent.map(p=>p[7])).size,3);
});
test('permission failures expose retry without an unhandled rejection',async()=>{
  let retry=false,message='';
  const connection=new Connection({onPermission:ok=>{retry=!ok;},onStatus:text=>{message=text;}},{async requestMIDIAccess(){throw Error('Permission denied');}});
  await connection.start();assert.equal(connection.ready,false);assert.equal(retry,true);assert.equal(message,'Permission denied');
});
test('a device error rejects its request without corrupting the next transaction',async()=>{
  const d=device(),connection=new Connection({}, {async requestMIDIAccess(){return d.access;}});
  await connection.start();d.output.send=data=>queueMicrotask(()=>d.input.onmidimessage({data:request(data[6]|0x40,data[7],[2,...encode(defaults())])}));
  await assert.rejects(connection.send(3),/Stop USB audio/);
  d.output.send=data=>queueMicrotask(()=>d.input.onmidimessage({data:request(data[6]|0x40,data[7],[0,...encode(defaults())])}));
  await assert.doesNotReject(connection.send(1));
});

test('cached Ash FM port names connect only after a valid Ash MIDI handshake',async()=>{
  const d=device('Ascetik Ash FM Ash FM');let loaded=0;
  const connection=new Connection({onSettings:()=>loaded++},{async requestMIDIAccess(){return d.access;}});
  await connection.start();assert.equal(connection.ready,true);assert.equal(loaded,1);
  assert.deepEqual(d.sent.map(p=>p[6]),[1]);
});
test('an original synth/FM candidate that fails the protocol is never configured or endlessly retried',async()=>{
  const d=device('Ascetik Ash FM');let probes=0;
  d.output.send=()=>{probes++;throw Error('No Ash MIDI protocol');};
  const connection=new Connection({}, {async requestMIDIAccess(){return d.access;}});
  await connection.start();assert.equal(connection.ready,false);assert.equal(probes,1);
  await connection.refresh();assert.equal(probes,1);
});
