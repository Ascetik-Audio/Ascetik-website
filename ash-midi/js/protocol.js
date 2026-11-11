// Ash MIDI configuration protocol. No runtime dependencies.
(()=>{
'use strict';
const labels = ['Vibrato', 'Filter', 'Scale', 'Root', 'Depth', 'Delay', 'Waveform', 'Mode', 'Octave', 'Attack', 'Sustain', 'Decay', 'Release', ...Array.from({ length: 8 }, (_, i) => `Button ${i + 1}`), 'Leaf touch'];
const keyboardPots = new Set([2, 3, 7, 8]);
const prefix = [0x7d, 0x41, 0x53, 0x48, 1];
const commands = { get: 1, set: 2, save: 3, load: 4, reset: 5, led: 6 };
function defaults() { return { mode: 0, channel: 1, velocity: 127, brightness:32, cc: Array.from({ length: 22 }, (_, i) => 20 + i) }; }
function integer(n, min, max) { return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max; }
function validate(value) {
    if (!value || typeof value !== 'object')
        throw Error('Settings must be an object.');
    const s = value;
    if (!integer(s.mode, 0, 1) || !integer(s.channel, 1, 16) || !integer(s.velocity, 1, 127) || !integer(s.brightness===undefined?32:s.brightness,0,127) || !Array.isArray(s.cc) || s.cc.length !== 22 || !s.cc.every(n => integer(n, 0, 127)))
        throw Error('Invalid settings: check mode, channel, velocity and all 22 CC numbers.');
    return { mode: s.mode, channel: s.channel, velocity: s.velocity, brightness:s.brightness===undefined?32:s.brightness, cc: [...s.cc] };
}
function encode(s) { s = validate(s); return [s.mode, s.channel, s.velocity, ...s.cc, s.brightness]; }
function decode(data) {
    if (data.length !== 25 && data.length !== 26)
        throw Error('Invalid device settings length.');
    return validate({ mode: data[0], channel: data[1], velocity: data[2], cc: data.slice(3,25), brightness:data.length===26?data[25]:32 });
}
function request(command, sequence, payload = []) {
    if (![command, sequence, ...payload].every(n => integer(n, 0, 127)))
        throw Error('Invalid MIDI data.');
    return [0xf0, ...prefix, command, sequence, ...payload, 0xf7];
}
function response(bytes) {
    const p = Array.from(bytes);
    if (![35,36].includes(p.length) || p[0] !== 0xf0 || p.at(-1) !== 0xf7 || !prefix.every((v, i) => v === p[i + 1]) || !p.slice(1, -1).every(n => integer(n, 0, 127)) || p[6] < 0x40)
        return null;
    return { command: p[6] & 0x3f, sequence: p[7], status: p[8], settings: decode(p.slice(9, -1)) };
}
function preset(name, settings) { return { format: 'ascetik-ash-midi', version: 1, name, settings: validate(settings) }; }
function importPreset(text) {
    const p = JSON.parse(text);
    if (p?.format !== 'ascetik-ash-midi' || p.version !== 1 || typeof p.name !== 'string' || p.name.length > 64)
        throw Error('This is not a supported Ash MIDI preset.');
    return { name: p.name, settings: validate(p.settings) };
}

globalThis.AshMidiProtocol={defaults,labels,keyboardPots,validate,encode,decode,request,response,preset,importPreset,commands,prefix};
})();
