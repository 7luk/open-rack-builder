# Contributing devices

The device library is community-driven. Anything in `community-devices.json`
ships to everyone — the app fetches it at startup and merges it into the
library (under a faint "community" dot). Each device is a self-contained JSON
object that carries its own CAD-blueprint faceplate, so no code changes are
needed to add one.

## Two ways to submit a device

**Easiest — from the app.** Build or place a device, select it, and click
**Submit to library** in the properties panel. That opens a prefilled GitHub
issue containing the device's JSON. A maintainer pastes it into
`community-devices.json`. (You can also click **Export** to download the JSON
and share it with anyone — they import it via *File → Import device file…*.)

**By pull request.** Add your device object to the array in
`community-devices.json` and open a PR.

## Device object

```json
{
  "cat": "Processing",
  "name": "RNC1773",
  "brand": "FMR Audio",
  "u": 1,
  "color": "#7a1f1f",
  "face": { "spec": [ /* components, see below */ ] }
}
```

- `cat` — one of: `Mixers`, `Amplifiers`, `Processing`, `Playback`, `Power`,
  `Patch & IO` (or any string; unknown categories appear at the end).
- `u` — height in rack units (1–12).
- `color` — faceplate hex colour. Line art auto-contrasts (light on dark, dark
  on light).
- `face.spec` — the faceplate as a list of line-art components.

## Faceplate spec

A faceplate is an array of components. Coordinates are normalized so a device
looks right at any size:

- `x`, `w` — fraction (0–1) of the panel **width** (between the rack ears).
- `y`, `h` — fraction (0–1) of the panel **height**.
- `r`, `size` — fraction of **one U** (so knobs stay a constant physical size
  regardless of how many U tall the panel is).

`knob`, `jack`, `led`, `button`, `text` are placed by their **centre**;
`screen`, `meter`, `vent` by their **top-left** corner; `fader` by centre-x /
top-y.

| `k`      | fields                          | looks like                       |
|----------|---------------------------------|----------------------------------|
| `knob`   | `x, y, r`                       | rotary with indicator            |
| `jack`   | `x, y, r`                       | XLR / TRS connector              |
| `led`    | `x, y, r`                       | small filled dot                 |
| `button` | `x, y, w, h`                    | rounded rectangle                |
| `screen` | `x, y, w, h`                    | display (thin = a slot)          |
| `meter`  | `x, y, w, h, seg`               | segmented level meter            |
| `vent`   | `x, y, w, h, n`                 | `n` ventilation slots            |
| `fader`  | `x, y, h`                       | channel fader                    |
| `text`   | `x, y, s, size, anchor`         | silkscreen label                 |

Example — a simple 1U compressor (four knobs, a meter, a bypass button):

```json
{ "k": "knob",   "x": 0.12, "y": 0.5,  "r": 0.16 },
{ "k": "knob",   "x": 0.27, "y": 0.5,  "r": 0.16 },
{ "k": "knob",   "x": 0.42, "y": 0.5,  "r": 0.16 },
{ "k": "knob",   "x": 0.57, "y": 0.5,  "r": 0.16 },
{ "k": "meter",  "x": 0.68, "y": 0.32, "w": 0.16, "h": 0.36, "seg": 6 },
{ "k": "button", "x": 0.92, "y": 0.5,  "w": 0.34, "h": 0.32 }
```

Tip: place a device in the app, click **Export**, and edit the resulting
`face.spec` — the model name is added automatically as a title-block badge, so
you don't draw it.
