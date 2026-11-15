const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const web = path.resolve(__dirname, '..');
const context = { setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(path.join(web, 'picoboot.js'), 'utf8'), context);
const { parseUF2, PicoBoot } = context.AshPicoBoot;
for (const name of ['ash-wave', 'ash-midi', 'ash-fm', 'ash-8osc']) {
  test(`${name}: published firmware, digest, embedded image and UF2 agree`, () => {
    const folder = path.join(web, name, 'firmware');
    const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'firmware.json')));
    const image = fs.readFileSync(path.join(folder, metadata.file));
    assert.equal(crypto.createHash('sha256').update(image).digest('hex'), metadata.sha256);
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(folder, 'firmware-image.js'), 'utf8'), ctx);
    assert.deepEqual(Buffer.from(ctx.window.ASH_FIRMWARE_IMAGE, 'base64'), image);
    assert.ok(parseUF2(image).size > 0);
    const broken = Buffer.from(image); broken[0] = 0;
    assert.throws(() => parseUF2(broken));
    const wrongFamily = Buffer.from(image); wrongFamily.writeUInt32LE(0, 28);
    assert.throws(() => parseUF2(wrongFamily));
    const badAddress = Buffer.from(image); badAddress.writeUInt32LE(0x10200000, 12);
    assert.throws(() => parseUF2(badAddress));
    assert.throws(() => parseUF2(image.subarray(0, image.length - 512)));
  });
}
class FakeBoot {
  constructor(corrupt = false) {
    this.corrupt = corrupt; this.memory = new Uint8Array(4096).fill(0x5a); this.commands = [];
    this.configuration = { interfaces: [{ interfaceNumber: 1, alternate: { alternateSetting: 0 },
      alternates: [{ interfaceClass: 255, alternateSetting: 0, endpoints: [
        { type: 'bulk', direction: 'in', endpointNumber: 2 },
        { type: 'bulk', direction: 'out', endpointNumber: 2 }] }] }] };
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async claimInterface(number) { assert.equal(number, 1); }
  async controlTransferOut() { return { status: 'ok' }; }
  async controlTransferIn() {
    const data = new DataView(new ArrayBuffer(16));
    data.setUint32(0, this.packet.getUint32(4, true), true); data.setUint8(8, this.id);
    return { status: 'ok', data };
  }
  async transferOut(endpoint, data) {
    assert.equal(endpoint, 2);
    if (this.expectData) {
      this.memory.set(data); this.expectData = false; this.written = true;
    } else if (data.byteLength) {
      assert.equal(data.byteLength, 32);
      this.packet = new DataView(data.buffer, data.byteOffset, data.byteLength);
      assert.equal(this.packet.getUint32(0, true), 0x431fd10b);
      this.id = data[8]; this.commands.push(this.id);
      if (this.id === 3) this.memory.fill(0xff);
      if (this.id === 5) this.expectData = true;
    }
    return { status: 'ok', bytesWritten: data.byteLength };
  }
  async transferIn(endpoint, length) {
    assert.equal(endpoint, 2);
    const bytes = length === 4096 ? this.memory.slice() : new Uint8Array();
    if (length === 4096 && this.corrupt && this.written) bytes[0] ^= 1;
    return { status: 'ok', data: new DataView(bytes.buffer) };
  }
}
const image = () => new Map([[0x10000000, [{ offset: 256, data: new Uint8Array(256).fill(0xaa) }]]]);
test('USB installer preserves sector bytes outside image and verifies before reboot', async () => {
  const device = new FakeBoot(), flasher = new PicoBoot(device), updates = [];
  await flasher.open(); await flasher.flash(image(), (...args) => updates.push(args));
  assert.deepEqual(device.commands, [1, 6, 0x84, 3, 5, 0x84, 2]);
  assert.ok(device.memory.subarray(0, 256).every(b => b === 0x5a));
  assert.ok(device.memory.subarray(256, 512).every(b => b === 0xaa));
  assert.ok(device.memory.subarray(512).every(b => b === 0x5a));
  assert.deepEqual(updates, [[1, 1]]);
  await flasher.close(); assert.equal(device.opened, false);
});
test('verification failure prevents reboot', async () => {
  const device = new FakeBoot(true), flasher = new PicoBoot(device);
  await flasher.open();
  await assert.rejects(flasher.flash(image(), () => {}), /verification failed/);
  assert.ok(!device.commands.includes(2));
});
test('USB transfer failures stop installation', async () => {
  const device = new FakeBoot(), flasher = new PicoBoot(device);
  await flasher.open(); device.transferOut = async () => ({ status: 'stall', bytesWritten: 0 });
  await assert.rejects(flasher.flash(image(), () => {}), /USB write failed/);
  assert.deepEqual(device.commands, []);
});
