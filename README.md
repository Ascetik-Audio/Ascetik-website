# Ash web editors

- [Ash-Wave](ash-wave/index.html)
- [Ash-MIDI](ash-midi/index.html)
- Ash-FM: reserved for a future editor.

All editors use `styles.css`, `img/ascetik.png`, and the shared firmware installer
scripts in `js/`. Keep device-specific
HTML, JavaScript, protocols and tests in each editor folder. The logo is identical
to the original assets. Device scripts and connection behavior are unchanged.

Serve this entire folder (rather than one editor subfolder) so shared assets resolve:

```sh
python3 -m http.server 8765
```

Then open `http://localhost:8765/ash-wave/` or `http://localhost:8765/ash-midi/`.
Opening each index.html directly also resolves shared assets, subject to browser
Web MIDI support. `../ash-midi/web` is a compatibility link to `Ash-MIDI` so older
project commands and test paths continue working.

## Latest firmware copies

Current Ash firmware projects publish their latest UF2 and supporting files into
`<lowercase-project-name>/firmware/`, for example
`ash-midi/firmware/Ash-MIDI-v12-11-26.1.uf2`.
Keep `firmware.json`, `firmware-info.js`, `firmware-image.js`, and the UF2 together
in that folder. Application JavaScript stays in each editor's `js/` folder.

Versions are generated automatically as `DD-MM-YY.BUILD_NUMBER` by the shared
build hook. The build counter continues across dates. Keep the authoritative
`version.json` in each firmware project beside `platformio.ini`. Dates come from
the UF2's modification time in Europe/Berlin. Only the latest automatically
published copy is retained per firmware folder.

The original `Ash Firmware` project is excluded.

The shared build hook is `../00 Template/copy_firmware.py`. Use it for new Ash
firmware projects as well. Firmware-only folders may not yet contain an editor.

Each variant has a firmware page with a INSTALL FIRMWARE button. The shared build
hook publishes version metadata, SHA-256, and a browser-loadable UF2 image.
Metadata and images load even when opening index.html directly from disk.

Automatic installation requires desktop Chrome/Edge with Web Serial and WebUSB
in a secure context (HTTPS or localhost; file URLs depend on browser policy).
The editor resets Ash using its existing 1200-baud serial reset, then uses the
RP2040 ROM PICOBOOT interface to write and read back each touched flash sector.
Untouched sectors are retained. Browser device permissions can require additional
clicks the first time; once granted, the flash button can complete the sequence.
The first serial selection must be Ash; the bootloader selection is RP2 Boot.
Do not disconnect during installation. Failed writes can be retried while the
board remains in BOOTSEL mode. Hardware verification is still required.
