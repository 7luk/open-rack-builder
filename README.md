# Open Rack Builder

A browser-only rack planning tool for live audio professionals — PA, mixers,
amps, processing, and patch gear. No frameworks, no build tools, no server.
It's plain static files, so it runs equally well opened locally or served from
any static host such as GitHub Pages.

## Features

- **19" rack canvas** with correct U numbering, adjustable start offset, and
  top→bottom or bottom→top direction.
- **Device library** of common live-audio gear, searchable and categorized
  (mixers, amplifiers, processing, playback, power, patch & IO). Add your own
  custom devices, or pull from the community registry.
- **CAD-blueprint faceplates** — every device renders as flat, aspect-correct
  line art that resembles the real unit (screens, knobs, faders, jacks, vents,
  meters), drawn procedurally as SVG so it stays crisp at any zoom.
- **Drag and drop** from the library onto any free slot; click to select and
  edit faceplate label, brand, color, status LED, and rear patch labels;
  drag placed devices to reposition them.
- **Three views** — front faceplates, rear patch panel, and a side U-stack —
  all rendered from the same state.
- **Zoomable** canvas (scroll wheel) with a lifted rack plate.
- **Light / dark** themes that flip the whole UI via CSS variables.
- **Persistence** — autosaves to the browser, exports/imports the full project
  as `.json`, and prints a clean PDF parts list.
- **Community devices** — a shared `community-devices.json` registry loads at
  startup; contribute your own (faceplate included) straight from the app. See
  [CONTRIBUTING.md](CONTRIBUTING.md).

## Run it

Locally, just open the file — no install step, everything runs client-side:

```
open index.html
```


## Project structure

```
index.html          shell and layout only, no logic
css/
  reset.css         base reset + CSS variable system (light/dark)
  layout.css        three-column grid, header, menu bar
  rack.css          rack frame, slots, device faceplates
  sidebar.css       library panel and properties panel
js/
  state.js          single source of truth (rack, devices, library, selection)
  library.js        device database + library panel rendering
  rack.js           rack frame builder + device renderer (front/rear/side)
  props.js          properties panel — reads and writes back to state
  persist.js        save()/load() wrapper (localStorage + JSON import/export)
  export.js         PDF export (print window with a formatted parts table)
  app.js            entry point, wires everything together
```

### Design rules

- **State is the single source of truth.** Render functions take state in and
  produce DOM out; they never read values back from the DOM to make decisions.
- **Extending a device** means adding a key to the device object — no
  structural changes.
- **The persist layer** sits behind `save()` / `load()`, so swapping to
  IndexedDB or a backend later is a one-file change.

## License

MIT
