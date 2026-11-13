English | [Русский](README.ru.md)

# Stream Deck Emulator

> [!WARNING]
> This is an unofficial project. It is not affiliated with, endorsed by or supported by Elgato or Corsair. Stream Deck is a trademark of Corsair Memory, Inc.

<p align="center">
  <img alt="Stream Deck Emulator: volume and brightness on Stream Deck +, then media controls on Stream Deck Neo" src="assets/demo.gif" width="800">
</p>

A virtual Stream Deck for the real Stream Deck application. The emulator presents itself to Windows as a USB device, so the Stream Deck app, your plugins and your profiles behave exactly as they do with hardware.

It is built for plugin developers who do not own every model.

## Supported Models

| Model                              | Id            | Emulated                                           |
| ---------------------------------- | ------------- | -------------------------------------------------- |
| Stream Deck +                      | `plus`        | 8 keys, 4 dials, touch strip                       |
| Stream Deck Neo                    | `neo`         | 8 keys, 2 touch keys, info screen                  |
| Stream Deck MK.2                   | `mk2`         | 15 keys                                            |
| Stream Deck XL                     | `xl`          | 32 keys (8x4)                                      |
| Stream Deck + XL                   | `plus-xl`     | 36 keys (9x4), 6 dials, touch strip                |
| Stream Deck Module                 | `module`      | 15 keys (5x3)                                      |
| Stream Deck Module Vertical        | `module-vert` | 15 keys (3x5), same product id as Module           |
| Stream Deck Studio                 | `studio`      | 32 keys (16x2), 2 dials at the left and right      |
| Stream Deck Pedal                  | `pedal`       | 3 keys, no displays                                |
| Corsair Galleon 100 (experimental) | `galleon-100` | 12 keys (3x4), 2 dials above a 720x384 touchscreen |

All models speak the v2 protocol. The original Stream Deck and the Mini use the older v1 protocol and are not emulated yet.

## Features

- **Browser UI**: Click keys, scroll, drag and press dials, click, hold or drag on the touch strip, and see what the app draws on every screen. Dials can be dragged in any direction: right or up turns right, left or down turns left, and a diagonal drag turns by the difference between the two.
- **Several Devices at Once**: Connect and disconnect each model on its own. The others keep working.
- **Headless Start**: Connect models from the command line without opening the browser.

## Requirements

- **Operating System**: Windows 10 or 11
- **USB/IP Client**: [usbip-win2](https://github.com/vadimgrn/usbip-win2), which creates the virtual USB device (tested with 0.9.7.8)
- **Elgato Stream Deck Software**

## Quick Start

1. Install usbip-win2.
2. Download `stream-deck-emulator-windows-amd64.exe` from the [latest release](https://github.com/valentderah/stream-deck-emulator/releases/latest) and run it.
3. Open <http://127.0.0.1:8484>.
4. Pick a model in the list above the keys and press **Connect**. It appears in the Stream Deck app within a few seconds.
5. Press **Disconnect** to unplug it. The Stream Deck app remembers the device and its profiles, as it does with real hardware.

For a device-only view, open `/kiosk/<model>` (for example, `/kiosk/studio`).
The centered panel scales to the browser's width and connects the selected model automatically.
Click the Stream Deck Emulator title to reload the current page.

## YAML layouts

All stock browser layouts are defined in [`internal/ui/layouts.yaml`](internal/ui/layouts.yaml)
and embedded in the executable. The dropdown also includes **Stream Deck + XL
(Studio layout)**: all 36 buttons in two rows of 18, the touch strip beneath them,
and three dials stacked vertically on each side. Open `/kiosk/plus-xl-studio`
to use that layout in kiosk mode.

Layouts are **views of a source device**, not new USB devices. Switching between
the stock + XL and its Studio layout shares the connection, images and input
state. The Stream Deck application still sees the original + XL with its original
USB identity, key order, six dials and 1200x100 touch strip.

To add your own views, or replace bundled views by ID, create a YAML file and
start the emulator with `-layouts my-layouts.yaml`. Files are loaded at startup;
restart the emulator after editing. Existing layout IDs replace bundled views;
new IDs are appended to the dropdown. Every view also works at `/kiosk/<layout-id>`.
The file need only contain your additions/overrides, not all stock layouts.

For example, this rearranges the eight buttons of a Stream Deck + into one row:

```yaml
layouts:
  - id: plus-wide
    name: Stream Deck + (Wide)
    source:
      vendorId: 0x0fd9
      productId: 0x0084
    width: 8
    height: 3
    elements:
      - type: key
        index: 0
        count: 8
        columns: 8
        x: 0
        y: 0
        width: 1
        height: 1
      - type: strip
        x: 0
        y: 1.2
        width: 8
        height: 1
      - type: dial
        index: 0
        count: 4
        x: 0.5
        y: 2.2
        width: 0.8
        height: 0.8
        gapX: 1.2
```

- `id`: unique lowercase letters/numbers separated by hyphens; used in the
  kiosk URL and saved dropdown selection. Stock model IDs are reserved for views
  of that model.
- `name`: the displayed dropdown label.
- `source.vendorId` / `source.productId`: the known device's USB IDs, as hex
  numbers (`0x0084`) or decimal integers. If multiple models have the same IDs,
  add `source.modelId` to disambiguate (for example `module` / `module-vert`).
- Top-level `width` / `height`: canvas dimensions in arbitrary units.
- `elements`: rectangles with `type`, `x`, `y`, `width`, `height`. Types are
  `key`, `dial`, `strip`, `screen` and `touchKey`. The top-left origin is `(0,0)`;
  all rectangles scale proportionally in both web and kiosk modes.
- `index`: zero-based **source** index, default `0`. Key and dial indices retain
  the original device order, regardless of where you place them. `touchKey`
  indices start at `0` separately from regular keys.
- `count`: number of consecutive indices, default `1`. `columns` defaults to
  `count`; set it to `1` for a vertical stack. `gapX` / `gapY` are non-negative
  gaps between repeated rectangles, default `0`. Separate elements can reorder
  any individual controls.

Every source button, dial, touch key and display must appear exactly once.
Rectangles must fit the canvas and cannot overlap. The touch strip is one display
(not independent screens); the host still draws its dial regions, and browser
touches map back to its original pixel coordinates even when resized. `screen`
is the Neo's non-touch info display. Invalid/ambiguous sources, unknown YAML
fields, duplicate IDs/indices, incomplete mappings and invalid geometry cause a
startup error rather than silently falling back. Files are limited to one YAML
document and 1 MiB. USB protocol definitions remain in Go; YAML defines only
presentation.

## Limitations

- Galleon 100 support is experimental. It emulates only the Stream Deck section,
  not the keyboard. The layout follows device photos: two dials, a touchscreen
  with four digital areas (2x2), then twelve physical keys (3x4). The four areas
  are regions of one touchscreen, not extra HID keys. USB identity
  `1b1c:2b18`, 120px key images and the 720x384 display follow the shared
  Stream Pulse catalogue and are unverified. Image orientation, unit-info panel
  dimensions, feature payloads and v2 HID behavior are provisional; most feature
  reports reuse the Plus implementation. Recognition by Stream Deck software
  is not guaranteed. A real-device HID capture is needed to confirm these values.
  Application firmware report `0x05` advertises `3.06.006`, matching version
  metadata in Stream Deck's bundled Corsair K100 MK2 firmware. The shared
  `3.01.005` value is rejected as legacy for this model and triggers repeated
  updates. This is only an emulated version report: firmware flashing is not
  implemented, and no firmware image is installed or executed by the emulator.
- The Neo is implemented from open-source protocol descriptions and has not been compared with a real device. Report anything the app shows differently.
- The XL, + XL, Module, Studio and Pedal are in the same state: their product ids, key sizes, rotation and panel sizes are best-effort values. The Module Vertical, Mobile and Corsair Keyboard have no Elgato USB product, so they use placeholder product ids (`0xf001` to `0xf003`) and the Stream Deck app will not recognise them.
- See [Finding the real product ids](#finding-the-real-product-ids) to replace the guesses with values from your own hardware.

- The web UI has no authentication. Keep it on a loopback address; anyone who can open the page can press your keys.

## Finding the real product ids

With a real Stream Deck plugged in, run these in PowerShell. Elgato's vendor id is `0FD9`; the four hex digits after `PID_` are the product id (for example `PID_0084` is `0x0084`, the Stream Deck +).

```powershell
# Product id, name and serial of every connected Stream Deck
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\VID_0FD9*' } |
  Select-Object FriendlyName, InstanceId

# The same, with the product id as a number
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^USB\\VID_0FD9&PID_([0-9A-F]{4})' } |
  ForEach-Object { [pscustomobject]@{ Name = $_.FriendlyName; ProductId = '0x' + $Matches[1] } }
```

To read the unit info (key grid, key size, panel size) that the emulator replays, build a device interface path for `hidprobe` and run it with the real device attached:

```powershell
$id = (Get-PnpDevice -Class HIDClass -PresentOnly | Where-Object { $_.InstanceId -like 'HID\VID_0FD9*' } | Select-Object -First 1).InstanceId
$path = '\\?\' + ($id -replace '\\', '#') + '#{4d1e55b2-f16f-11cf-88cb-001111000030}'
go run ./cmd/hidprobe -path $path
```

Compare the output with the `unitInfo(...)` call of the model in `internal/deck/model.go`, then send the values in an issue or change the model directly.

## Reference

<details>
<summary>Command-line flags</summary>

| Flag         | Default          | Meaning                                                                                                |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `-usbip`     | `127.0.0.1:3240` | USB/IP listen address                                                                                  |
| `-ui`        | `127.0.0.1:8484` | Web UI listen address                                                                                  |
| `-usbip-cli` | search           | Path of the `usbip` client. By default the emulator looks on `PATH`, then in `C:\Program Files\USBip`. |
| `-connect`   | none             | Models to connect at start, for example `-connect plus,neo`.                                           |
| `-layouts`   | bundled          | YAML file adding or replacing browser/kiosk layouts.                                                   |
| `-version`   |                  | Print the version and exit.                                                                            |

</details>

<details>
<summary>HTTP API</summary>

The web UI talks to the emulator over HTTP, and scripts can do the same: press keys, turn dials and read back what the app drew. The API is not stable yet.

`{id}` is a model id: `plus`, `neo` or `mk2`. The examples use a POSIX shell and the default address.

| Request                             | Result                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| `GET /api/devices`                  | Models with their layout and connection state                        |
| `GET /api/layouts`                  | Layout IDs, names, source device IDs and expanded element rectangles |
| `POST /api/devices/{id}/connect`    | Plug the device in                                                   |
| `POST /api/devices/{id}/disconnect` | Unplug the device                                                    |
| `POST /api/devices/{id}/input`      | Press a key or a dial, turn a dial, touch the strip                  |
| `GET /api/devices/{id}/key/{index}` | Key image, JPEG                                                      |
| `GET /api/devices/{id}/strip`       | Touch strip image, PNG                                               |
| `GET /api/devices/{id}/screen`      | Info screen image, JPEG                                              |
| `GET /api/events`                   | Server-sent events about display and connection changes              |

A successful `POST` answers `204`. An error answers with a JSON body such as `{"code":"unsupported_input"}`. A key or screen the app has not drawn yet answers `204` without a body.

Keys are numbered from 0, left to right and top to bottom. The touch keys of the Neo follow the regular keys: 8 and 9. Dials are numbered from 0, left to right.

Studio's two dials flank the key grid, centered between its two rows: dial 0 on the left and dial 1 on the right. Scroll or drag to rotate and click to press, as on the + models.

Galleon's dials appear above its touchscreen and keys. Use
`-connect galleon-100` to try attaching it, or open `/kiosk/galleon-100` for its
browser panel. Touch coordinates span 720x384; the four area centers are
`(180,96)`, `(540,96)`, `(180,288)` and `(540,288)`. Taps, long presses and drags
use the existing `touch` API. The host draws the area contents and boundaries;
the emulator does not synthesize four extra key images. Its bundled YAML view
puts the dials and touchscreen before the key grid; the legacy
`knobPlacement: "above"` metadata in `GET /api/devices` is retained for API compatibility.

Press and release key 0:

```bash
curl -X POST http://127.0.0.1:8484/api/devices/plus/input -d '{"type":"key","index":0,"down":true}'
curl -X POST http://127.0.0.1:8484/api/devices/plus/input -d '{"type":"key","index":0,"down":false}'
```

Turn dial 1 by three ticks, then press it. A negative `ticks` turns the other way.

```bash
curl -X POST http://127.0.0.1:8484/api/devices/plus/input -d '{"type":"dialRotate","index":1,"ticks":3}'
curl -X POST http://127.0.0.1:8484/api/devices/plus/input -d '{"type":"dialPress","index":1,"down":true}'
curl -X POST http://127.0.0.1:8484/api/devices/plus/input -d '{"type":"dialPress","index":1,"down":false}'
```

Touch the strip. `kind` is `1` for a tap, `2` for a long press and `3` for a drag from `x`, `y` to `x2`, `y2`. Coordinates are in strip pixels, 800 by 100 on the Stream Deck +.

```bash
curl -X POST http://127.0.0.1:8484/api/devices/plus/input -d '{"type":"touch","kind":1,"x":100,"y":50}'
curl -X POST http://127.0.0.1:8484/api/devices/plus/input -d '{"type":"touch","kind":3,"x":100,"y":50,"x2":400,"y2":50}'
```

Save what the app drew on key 0:

```bash
curl -o key0.jpg http://127.0.0.1:8484/api/devices/plus/key/0
```

Key and info screen JPEGs are returned as the app sent them. `rotated` in `GET /api/devices` indicates a 180-degree display correction (Neo, MK.2, XL and Module variants). `quarterTurn` indicates a 90-degree clockwise correction for + XL key JPEGs. The browser applies these corrections without changing key order. Touch strip PNGs are already upright: + XL regions are rotated clockwise before composition, keeping touch coordinates unchanged.

The browser allows one download per image at a time. Updates received during a
download are combined into one refresh of the latest frame afterward, so rapid
display changes do not repeatedly abort image responses. Closing or reloading
a page can still cause a connection-closed write error in the emulator log;
`ui: encode strip` with a TCP write error indicates an interrupted download,
not a failure to encode the PNG.

</details>

<details>
<summary>Building from source</summary>

Building requires Go 1.27 or higher.
Running the browser tests also requires Node.js 22.12 or higher:
`node --test`. No npm packages are needed.

```
go build -trimpath -o bin/emulator.exe ./cmd/emulator
bin\emulator.exe
```

Run the Go tests with `go test ./...`. With Node.js 22.12 or newer, run the browser layout tests with `node --test internal/ui/deck.test.mjs`.
To test kiosk sizing in Chromium, set `CHROME_BIN` to a Chromium executable and run `node --test internal/ui/kiosk.test.mjs`.

</details>
