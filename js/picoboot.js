/* RP2040 ROM PICOBOOT protocol, as specified by Raspberry Pi's pico-sdk.
 * Only the Ash board's 2 MiB flash address range is accepted. */
(function (root) {
  'use strict';
  const BASE = 0x10000000, END = BASE + 2 * 1024 * 1024;
  function deadline(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('USB operation timed out. Reconnect and retry.')), 15000);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
  function parseUF2(buffer) {
    const bytes = new Uint8Array(buffer), pages = new Map(), numbers = new Set();
    if (!bytes.length || bytes.length % 512) throw Error('Invalid UF2 length');
    const count = bytes.length / 512;
    for (let offset = 0; offset < bytes.length; offset += 512) {
      const v = new DataView(bytes.buffer, bytes.byteOffset + offset, 512);
      if (v.getUint32(0, true) !== 0x0a324655 || v.getUint32(4, true) !== 0x9e5d5157 ||
          v.getUint32(508, true) !== 0x0ab16f30) throw Error('Invalid UF2 block');
      const flags = v.getUint32(8, true), address = v.getUint32(12, true);
      const size = v.getUint32(16, true), number = v.getUint32(20, true);
      if (flags !== 0x2000 || v.getUint32(28, true) !== 0xe48bff56)
        throw Error('Unsupported firmware file.');
      if (size !== 256 || address % 256 || address < BASE || address + size > END ||
          v.getUint32(24, true) !== count || number >= count || numbers.has(number) || pages.has(address))
        throw Error('Invalid firmware file.');
      numbers.add(number);
      pages.set(address, bytes.slice(offset + 32, offset + 288));
    }
    if (!pages.has(BASE)) throw Error('Firmware has no boot block');
    // Read/modify/write each touched sector to preserve data outside the image.
    const sectors = new Map();
    for (const [address, data] of [...pages].sort((a, b) => a[0] - b[0])) {
      const sector = address - address % 4096;
      if (!sectors.has(sector)) sectors.set(sector, []);
      sectors.get(sector).push({ offset: address - sector, data });
    }
    return sectors;
  }
  class PicoBoot {
    constructor(device) { this.device = device; this.token = 0; }
    async open() {
      await this.device.open();
      if (!this.device.configuration) await this.device.selectConfiguration(1);
      const iface = this.device.configuration.interfaces.find(i => i.alternates.some(a =>
        a.interfaceClass === 255 && a.endpoints.some(e => e.type === 'bulk' && e.direction === 'in') &&
        a.endpoints.some(e => e.type === 'bulk' && e.direction === 'out')));
      if (!iface) throw Error('Update mode not found.');
      const alt = iface.alternates.find(a => a.interfaceClass === 255 &&
        a.endpoints.some(e => e.type === 'bulk' && e.direction === 'in') &&
        a.endpoints.some(e => e.type === 'bulk' && e.direction === 'out'));
      this.iface = iface.interfaceNumber;
      await this.device.claimInterface(this.iface);
      if (iface.alternate.alternateSetting !== alt.alternateSetting)
        await this.device.selectAlternateInterface(this.iface, alt.alternateSetting);
      this.input = alt.endpoints.find(e => e.type === 'bulk' && e.direction === 'in').endpointNumber;
      this.output = alt.endpoints.find(e => e.type === 'bulk' && e.direction === 'out').endpointNumber;
      const reset = await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'interface',
        request: 0x41, value: 0, index: this.iface });
      if (reset.status !== 'ok') throw Error('Could not start update mode.');
    }
    async out(data) {
      const result = await deadline(this.device.transferOut(this.output, data));
      if (result.status !== 'ok' || result.bytesWritten !== data.byteLength) throw Error('USB write failed');
    }
    async inputBytes(length) {
      const result = await deadline(this.device.transferIn(this.input, length || 64));
      if (result.status !== 'ok' || !result.data || result.data.byteLength !== length)
        throw Error('USB read failed');
      return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength).slice();
    }
    async command(id, args = new Uint8Array(), data = null, readLength = 0) {
      const packet = new Uint8Array(32), v = new DataView(packet.buffer);
      v.setUint32(0, 0x431fd10b, true); v.setUint32(4, ++this.token, true);
      packet[8] = id; packet[9] = args.length;
      v.setUint32(12, data ? data.length : readLength, true); packet.set(args, 16);
      await this.out(packet);
      if (data) await this.out(data);
      const read = readLength ? await this.inputBytes(readLength) : null;
      if (id & 0x80) await this.out(new Uint8Array());
      else await this.inputBytes(0);
      const status = await deadline(this.device.controlTransferIn({ requestType: 'vendor', recipient: 'interface',
        request: 0x42, value: 0, index: this.iface }, 16));
      if (status.status !== 'ok' || !status.data || status.data.byteLength !== 16 ||
          status.data.getUint32(0, true) !== this.token || status.data.getUint32(4, true) !== 0 ||
          status.data.getUint8(8) !== id || status.data.getUint8(9) !== 0)
        throw Error('Firmware update rejected.');
      return read;
    }
    range(address, length) {
      const args = new Uint8Array(8), v = new DataView(args.buffer);
      v.setUint32(0, address, true); v.setUint32(4, length, true); return args;
    }
    async flash(sectors, progress) {
      await this.command(1, new Uint8Array([1]));
      await this.command(6);
      let done = 0;
      for (const [address, pages] of sectors) {
        const data = await this.command(0x84, this.range(address, 4096), null, 4096);
        for (const page of pages) data.set(page.data, page.offset);
        await this.command(3, this.range(address, 4096));
        await this.command(5, this.range(address, 4096), data);
        const read = await this.command(0x84, this.range(address, 4096), null, 4096);
        if (!read.every((value, i) => value === data[i])) throw Error('Firmware verification failed');
        progress(++done, sectors.size);
      }
      // Reboot only after every written sector passed read-back verification.
      const args = new Uint8Array(12);
      new DataView(args.buffer).setUint32(8, 500, true);
      await this.command(2, args);
    }
    async close() { if (this.device.opened) await this.device.close(); }
  }
  root.AshPicoBoot = { parseUF2, PicoBoot };
})(globalThis);
