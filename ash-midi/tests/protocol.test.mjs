import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/protocol.js';
const {defaults,labels,keyboardPots,validate,encode,decode,request,response,preset,importPreset,commands,prefix}=globalThis.AshMidiProtocol;
test('settings and JSON round-trip without mutating the source', () => {
    const s = defaults();
    s.cc[21] = 119;
    s.mode = 1;
    s.channel = 16;
    s.velocity = 1;
    assert.deepEqual(decode(encode(s)), s);
    const p = importPreset(JSON.stringify(preset('Live', s)));
    assert.deepEqual(p, { name: 'Live', settings: s });
    p.settings.cc[0] = 99;
    assert.equal(s.cc[0], 20);
});
test('reject corrupt or incompatible presets atomically', () => {
    for (const change of [{ channel: 0 }, { velocity: 0 }, { mode: 2 }, { cc: [1] }, { cc: Array(22).fill(128) }])
        assert.throws(() => validate({ ...defaults(), ...change }));
    assert.throws(() => importPreset('{broken'));
    assert.throws(() => importPreset(JSON.stringify({ ...preset('test', defaults()), version: 2 })));
});
test('framing, transaction matching fields, and malformed reply rejection', () => {
    assert.deepEqual(request(1, 127), [240, 125, 65, 83, 72, 1, 1, 127, 247]);
    const reply = request(0x42, 7, [0, ...encode(defaults())]);
    assert.deepEqual(response(reply), { command: 2, sequence: 7, status: 0, settings: defaults() });
    assert.equal(response(reply.slice(1)), null);
    reply[5] = 2;
    assert.equal(response(reply), null);
    assert.throws(() => request(1, 128));
});

test('brightness round-trips in state and presets, and old formats default to 32',()=>{
 const s=defaults();s.brightness=99;
 assert.deepEqual(decode(encode(s)),s);
 assert.equal(importPreset(JSON.stringify(preset('Bright',s))).settings.brightness,99);
 const old=defaults();delete old.brightness;
 assert.equal(importPreset(JSON.stringify({format:'ascetik-ash-midi',version:1,name:'Old',settings:old})).settings.brightness,32);
 assert.equal(decode(encode(s).slice(0,25)).brightness,32);
 assert.equal(response(request(0x41,8,[0,...encode(s).slice(0,25)])).settings.brightness,32);
 for(const brightness of [-1,128,1.5,null]) assert.throws(()=>validate({...s,brightness}));
});
