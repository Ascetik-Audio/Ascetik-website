/* Shared automatic Ash firmware installer. No file copying or BOOTSEL required. */
(() => {
  'use strict';
  const host = document.querySelector('.firmware-update');
  if (!host) return;
  const manifest = window.ASH_FIRMWARE;
  const row = document.createElement('div'); row.className = 'firmware-row';
  const version = document.createElement('span');
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'INSTALL FIRMWARE';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const progress = document.createElement('progress'); progress.max = 100; progress.value = 0; progress.hidden = true;
  progress.setAttribute('aria-label', 'Firmware installation progress');
  row.append(version, button); host.append(row, status, progress);
  if (!manifest || !/^[A-Za-z0-9.-]+\.uf2$/.test(manifest.file) || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '')) {
    version.textContent = 'Latest firmware unavailable. Reload the page to retry.'; button.disabled = true; return;
  }
  version.textContent = `Latest firmware: v${manifest.version} · ${manifest.date}`;
  if (!window.isSecureContext || !navigator.usb || !navigator.serial) {
    button.disabled = true;
    status.textContent = 'Automatic flashing requires desktop Chrome or Edge with USB and serial access (HTTPS or localhost).';
    return;
  }
  const bootFilter = { vendorId: 0x2e8a, productId: 0x0003 };
  const isBoot = d => d.vendorId === bootFilter.vendorId && d.productId === bootFilter.productId;
  const isAsh = p => { const i = p.getInfo(); return i.usbVendorId === 0x2e8a && i.usbProductId === 0x000a; };
  let stage = 'start', busy = false, imagePromise;
  function image() {
    if (!imagePromise) imagePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `firmware-image.js?v=${manifest.sha256}`;
      script.onload = async () => {
        try {
          const encoded = window.ASH_FIRMWARE_IMAGE;
          if (typeof encoded !== 'string') throw Error('Firmware image unavailable');
          const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          if (Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') !== manifest.sha256)
            throw Error('Firmware files are out of date. Reload the editor.');
          resolve(window.AshPicoBoot.parseUF2(bytes.buffer));
        } catch (e) { reject(e); }
      };
      script.onerror = () => reject(Error('Firmware image could not be loaded. Reload the editor.'));
      document.head.append(script);
    });
    return imagePromise;
  }
  // Validate the published image before allowing a device to be reset.
  button.disabled = true;
  Promise.all([image(), navigator.usb.getDevices(), navigator.serial.getPorts()])
    .then(([, devices, ports]) => {
      if (!devices.some(isBoot) && !ports.some(isAsh)) stage = 'serial';
      button.disabled = false;
    }).catch(e => { status.textContent = e.message; });
  const recover = document.createElement('button');
  recover.type = 'button'; recover.textContent = 'CONNECT BOOTLOADER'; recover.hidden = true;
  host.append(recover);
  recover.addEventListener('click', () => {
    if (busy) return;
    stage = 'boot'; button.click();
  });
  async function grantedBoot() { return (await navigator.usb.getDevices()).filter(isBoot); }
  async function waitBoot() {
    for (let i = 0; i < 40; i++) {
      const devices = await grantedBoot();
      if (devices.length === 1) return devices[0];
      if (devices.length > 1) return null;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }
  function needsBootPermission() {
    stage = 'boot';
    button.textContent = 'ALLOW USB & FLASH';
    status.textContent = 'Ash is ready. Press ALLOW USB & FLASH and select RP2 Boot in the browser permission prompt.';
  }
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; button.disabled = true; recover.hidden = true;
    let boot, port, flasher;
    try {
      // A new permission picker must be called directly from a click, before awaits.
      if (stage === 'serial') port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x2e8a, usbProductId: 0x000a }] });
      else if (stage === 'boot') boot = await navigator.usb.requestDevice({ filters: [bootFilter] });
      else {
        const boots = await grantedBoot();
        if (boots.length === 1) boot = boots[0];
        else {
          const ports = (await navigator.serial.getPorts()).filter(isAsh);
          if (ports.length === 1) port = ports[0];
          else {
            // getPorts() consumed the gesture on some browsers: use another click.
            stage = 'serial'; button.textContent = 'SELECT ASH & FLASH';
            status.textContent = 'Press SELECT ASH & FLASH to allow access to your connected Ash.';
            return;
          }
        }
      }
      if (!boot) {
        status.textContent = 'Restarting Ash in update mode…';
        await port.open({ baudRate: 1200 });
        await port.setSignals({ dataTerminalReady: true });
        try { await port.setSignals({ dataTerminalReady: false }); }
        catch (error) { if (error.name !== 'NetworkError') throw error; }
        try { await port.close(); } catch (_) { /* The reset disconnects serial. */ }
        port = null;
        boot = await waitBoot();
        if (!boot) { needsBootPermission(); return; }
      }
      const sectors = await image();
      status.textContent = 'Installing firmware. Keep Ash connected…';
      progress.hidden = false; progress.value = 0;
      flasher = new window.AshPicoBoot.PicoBoot(boot);
      await flasher.open();
      await flasher.flash(sectors, (done, total) => {
        progress.value = Math.round(done * 100 / total);
        status.textContent = `Installing and verifying firmware… ${progress.value}%`;
      });
      stage = 'start'; button.textContent = 'INSTALL FIRMWARE';
      status.textContent = `Firmware v${manifest.version} verified. Ash is restarting.`;
    } catch (error) {
      recover.hidden = false;
      if (error.name === 'NotFoundError') status.textContent = 'Device selection cancelled. Press the button to try again.';
      else status.textContent = `${error.message} If Ash is in update mode, press the button to reconnect and retry.`;
      if (boot) { stage = 'boot'; button.textContent = 'RECONNECT & FLASH'; }
    } finally {
      if (port) { try { await port.close(); } catch (_) {} }
      if (flasher) { try { await flasher.close(); } catch (_) {} }
      busy = false; button.disabled = false;
    }
  });
})();
