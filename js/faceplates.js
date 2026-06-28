/* faceplates.js — procedural CAD-blueprint line-art faceplate engine.
 *
 * Flat, stroke-only SVG (no shading/gradients), drawn in a viewBox locked to
 * the real device aspect (19" wide, 1.75" per U). Strokes use currentColor, so
 * the line colour follows the device/theme and stays crisp at any zoom.
 *
 * A faceplate is a declarative COMPONENT SPEC: an array of parts placed by
 * normalized coordinates. This makes every device — built-in, custom, or
 * community-contributed — a self-contained, shareable description.
 *
 * A device's `face` can be:
 *   { id: "<model>" }   resolve from SCHEMATICS (built-ins, compact)
 *   { spec: [ ... ] }   inline component list (custom / community, portable)
 *   { t: "<template>" } an archetype generated on the fly (quick custom)
 *
 * Coordinate conventions inside a spec:
 *   x  — fraction (0..1) across the content width (between the rack ears)
 *   y  — fraction (0..1) down the panel height
 *   knob/jack/led/button/text are placed by their CENTRE; screen/meter/vent
 *   by their TOP-LEFT corner; fader by CENTRE-x / TOP-y.
 *   r and text size are fractions of one U (constant physical size); a
 *   screen/meter/vent w is a fraction of width, h a fraction of height.
 */
window.Faceplates = (function () {
  "use strict";

  var W = 380; // viewBox width  (≙ 19")
  var UH = 44; // viewBox height per U

  /* ---------- helpers ---------- */
  function f(n) {
    return Math.round(n * 100) / 100;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }
  function flat(a) {
    var out = [];
    (a || []).forEach(function (x) {
      if (Array.isArray(x)) out = out.concat(flat(x));
      else if (x) out.push(x);
    });
    return out;
  }

  /* ---------- primitive shapes (markup) ---------- */
  function circle(cx, cy, r, filled) {
    return (
      '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(Math.max(0.3, r)) + '"' +
      (filled ? ' fill="currentColor" stroke="none"' : "") + "/>"
    );
  }
  function line(x1, y1, x2, y2) {
    return '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '"/>';
  }
  function rrect(x, y, w, h, r) {
    return (
      '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(Math.max(0, w)) +
      '" height="' + f(Math.max(0, h)) + '" rx="' + f(r || 0) + '"/>'
    );
  }
  function text(x, y, s, size, anchor) {
    if (s == null || s === "") return "";
    return (
      '<text x="' + f(x) + '" y="' + f(y) + '" font-size="' + f(size) +
      '" text-anchor="' + (anchor || "middle") +
      '" fill="currentColor" stroke="none" font-family="-apple-system,system-ui,sans-serif"' +
      ' style="letter-spacing:.08em">' + esc(s) + "</text>"
    );
  }

  /* ---------- control primitives (px coords) ---------- */
  function knob(cx, cy, r) {
    return circle(cx, cy, r) + line(cx, cy, cx, cy - r * 0.82) + circle(cx, cy, r * 0.13, true);
  }
  function jack(cx, cy, r) {
    return circle(cx, cy, r) + circle(cx, cy, r * 0.4);
  }
  function display(x, y, w, h) {
    var s = rrect(x, y, w, h, 2);
    var n = Math.min(4, Math.max(1, Math.round(h / 14)));
    for (var i = 1; i < n; i++) s += line(x + 3, y + (h / n) * i, x + w - 3, y + (h / n) * i);
    return s;
  }
  function fader(cx, top, h, pos) {
    var cap = 7;
    var capY = top + (h - cap) * (pos == null ? 0.5 : pos);
    return line(cx, top, cx, top + h) + rrect(cx - 4, capY, 8, cap, 1);
  }
  function vents(x, y, w, h, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += line(x, y + (h / Math.max(1, n - 1)) * i, x + w, y + (h / Math.max(1, n - 1)) * i);
    return s;
  }
  function meter(x, y, w, h, seg) {
    var s = rrect(x, y, w, h, 1);
    for (var i = 1; i < seg; i++) s += line(x + (w / seg) * i, y, x + (w / seg) * i, y + h);
    return s;
  }

  /* ---------- spec constructors ---------- */
  function K(x, y, r) { return { k: "knob", x: x, y: y, r: r || 0.16 }; }
  function J(x, y, r) { return { k: "jack", x: x, y: y, r: r || 0.12 }; }
  function L(x, y, r) { return { k: "led", x: x, y: y, r: r || 0.05 }; }
  function B(x, y, w, h) { return { k: "button", x: x, y: y, w: w || 0.32, h: h || 0.16 }; }
  function SC(x, y, w, h) { return { k: "screen", x: x, y: y, w: w || 0.3, h: h || 0.5 }; }
  function MT(x, y, w, h, s) { return { k: "meter", x: x, y: y, w: w || 0.18, h: h || 0.4, seg: s || 9 }; }
  function VT(x, y, w, h, n) { return { k: "vent", x: x, y: y, w: w || 0.4, h: h || 0.5, n: n || 6 }; }
  function FD(x, y, h) { return { k: "fader", x: x, y: y, h: h || 0.62 }; }
  function TX(x, y, s, sz, a) { return { k: "text", x: x, y: y, s: s, size: sz || 0.16, anchor: a }; }

  function knobRow(x0, x1, y, n, r) {
    var a = []; for (var i = 0; i < n; i++) a.push(K(x0 + (x1 - x0) * ((i + 0.5) / n), y, r)); return a;
  }
  function jackRow(x0, x1, y, n, r) {
    var a = []; for (var i = 0; i < n; i++) a.push(J(x0 + (x1 - x0) * ((i + 0.5) / n), y, r)); return a;
  }
  function faderRow(x0, x1, y, n, h) {
    var a = []; for (var i = 0; i < n; i++) a.push(FD(x0 + (x1 - x0) * ((i + 0.5) / n), y, h)); return a;
  }
  function btnRow(x0, x1, y, n, w, h) {
    var a = []; for (var i = 0; i < n; i++) a.push(B(x0 + (x1 - x0) * ((i + 0.5) / n), y, w, h)); return a;
  }
  function ledRow(x0, x1, y, n, r) {
    var a = []; for (var i = 0; i < n; i++) a.push(L(x0 + (x1 - x0) * ((i + 0.5) / n), y, r)); return a;
  }

  /* ---------- spec renderer ---------- */
  function draw(spec, H) {
    var cx0 = 23, cx1 = W - 23, cy0 = 4, cy1 = H - 4;
    var cw = cx1 - cx0, ch = cy1 - cy0;
    function X(n) { return cx0 + n * cw; }
    function Y(n) { return cy0 + n * ch; }
    var out = "";
    flat(spec).forEach(function (c) {
      if (!c.k) return;
      var x = X(c.x), y = Y(c.y);
      switch (c.k) {
        case "knob": out += knob(x, y, (c.r || 0.16) * UH); break;
        case "jack": out += jack(x, y, (c.r || 0.12) * UH); break;
        case "led": out += circle(x, y, (c.r || 0.05) * UH, true); break;
        case "button":
          var bw = (c.w || 0.32) * UH, bh = (c.h || 0.16) * UH;
          out += rrect(x - bw / 2, y - bh / 2, bw, bh, Math.min(2, bh / 2));
          break;
        case "screen": out += display(x, y, (c.w || 0.3) * cw, (c.h || 0.5) * ch); break;
        case "meter": out += meter(x, y, (c.w || 0.18) * cw, (c.h || 0.4) * ch, c.seg || 9); break;
        case "vent": out += vents(x, y, (c.w || 0.4) * cw, (c.h || 0.5) * ch, c.n || 6); break;
        case "fader": out += fader(x, y, (c.h || 0.62) * ch, c.pos); break;
        case "text": out += text(x, y, c.s, (c.size || 0.16) * UH, c.anchor); break;
      }
    });
    return out;
  }

  /* ---------- per-model schematics (resemble the real units) ---------- */
  function mixerConsole(screenRight) {
    // big screen, an encoder bank, channel button grid, level meter, main knob
    var sx = screenRight ? 0.42 : 0.0;
    return [
      SC(sx, 0.12, 0.34, 0.6),
      knobRow(sx, sx + 0.34, 0.86, 6, 0.1),
      btnRow(screenRight ? 0.0 : 0.42, screenRight ? 0.4 : 1.0, 0.22, 8, 0.05, 0.1),
      btnRow(screenRight ? 0.0 : 0.42, screenRight ? 0.4 : 1.0, 0.4, 8, 0.05, 0.1),
      knobRow(screenRight ? 0.0 : 0.42, screenRight ? 0.34 : 0.86, 0.66, 6, 0.13),
      K(screenRight ? 0.92 : 0.93, 0.66, 0.18),
      ledRow(screenRight ? 0.0 : 0.42, screenRight ? 0.4 : 1.0, 0.07, 8, 0.028),
    ];
  }

  var SCHEMATICS = {
    blank: [],

    // Mixers
    x32rack: mixerConsole(false),
    m32r: mixerConsole(false),
    tfrack: [
      SC(0.4, 0.1, 0.58, 0.74), K(0.1, 0.24, 0.16),
      btnRow(0.02, 0.34, 0.56, 3, 0.09, 0.12), MT(0.04, 0.74, 0.3, 0.16, 12),
    ],
    qupac: [
      SC(0.14, 0.1, 0.52, 0.74), K(0.82, 0.32, 0.2),
      btnRow(0.72, 1.0, 0.66, 4, 0.07, 0.12), btnRow(0.72, 1.0, 0.86, 4, 0.07, 0.1),
    ],
    sl32r: [
      jackRow(0.0, 1.0, 0.26, 12, 0.07), ledRow(0.0, 1.0, 0.46, 12, 0.025),
      jackRow(0.0, 1.0, 0.66, 12, 0.07), ledRow(0.0, 1.0, 0.86, 12, 0.025),
    ],

    // Amplifiers
    xli2500: [
      VT(0.0, 0.16, 0.6, 0.66, 9), K(0.78, 0.42, 0.26), K(0.93, 0.42, 0.26),
      L(0.75, 0.12, 0.04), L(0.85, 0.12, 0.04), L(0.95, 0.12, 0.04), B(0.69, 0.84, 0.1, 0.16),
    ],
    pld45: [
      VT(0.0, 0.2, 0.2, 0.6, 7), SC(0.28, 0.2, 0.22, 0.42), K(0.6, 0.34, 0.16),
      btnRow(0.28, 0.72, 0.74, 4, 0.07, 0.14), VT(0.82, 0.2, 0.18, 0.6, 7),
    ],
    fp10000q: [
      B(0.06, 0.46, 0.12, 0.34), ledRow(0.32, 0.64, 0.5, 4, 0.05),
      VT(0.78, 0.3, 0.2, 0.4, 5), TX(0.46, 0.86, "", 0.12),
    ],
    k10: [
      SC(0.04, 0.22, 0.22, 0.56), btnRow(0.34, 0.5, 0.5, 2, 0.07, 0.3),
      ledRow(0.6, 0.82, 0.5, 4, 0.05), B(0.92, 0.5, 0.1, 0.3),
    ],
    dci4600: [
      ledRow(0.28, 0.72, 0.5, 8, 0.04), B(0.9, 0.5, 0.1, 0.3), TX(0.16, 0.55, "", 0.14),
    ],

    // Processing
    dbx266: [
      knobRow(0.06, 0.42, 0.46, 5, 0.13), MT(0.0, 0.78, 0.42, 0.13, 8),
      knobRow(0.58, 0.94, 0.46, 5, 0.13), MT(0.58, 0.78, 0.42, 0.13, 8),
      L(0.04, 0.16, 0.04), L(0.96, 0.16, 0.04), B(0.5, 0.46, 0.05, 0.3),
    ],
    blu100: [
      SC(0.04, 0.26, 0.2, 0.5), ledRow(0.34, 0.92, 0.5, 12, 0.035),
    ],
    dn360: [
      faderRow(0.0, 1.0, 0.06, 20, 0.36), faderRow(0.0, 1.0, 0.54, 20, 0.36),
    ],
    pcm96: [
      SC(0.18, 0.22, 0.4, 0.56), K(0.82, 0.5, 0.22),
      btnRow(0.02, 0.14, 0.5, 2, 0.08, 0.18),
    ],
    m3000: [
      SC(0.3, 0.18, 0.4, 0.6), K(0.12, 0.5, 0.2), K(0.88, 0.5, 0.2),
      btnRow(0.32, 0.68, 0.86, 4, 0.05, 0.12),
    ],
    deq2496: [
      SC(0.02, 0.22, 0.34, 0.56), btnRow(0.42, 0.86, 0.32, 5, 0.05, 0.12),
      btnRow(0.42, 0.86, 0.58, 5, 0.05, 0.12), K(0.93, 0.5, 0.18),
    ],

    // Playback
    dn500bd: [
      SC(0.02, 0.42, 0.34, 0.16), SC(0.42, 0.28, 0.2, 0.44),
      btnRow(0.66, 0.98, 0.5, 5, 0.05, 0.16),
    ],
    cd400u: [
      SC(0.02, 0.42, 0.3, 0.16), SC(0.36, 0.28, 0.18, 0.44), K(0.62, 0.5, 0.12),
      btnRow(0.72, 0.98, 0.5, 4, 0.05, 0.16),
    ],
    dn700c: [
      SC(0.04, 0.3, 0.26, 0.42), btnRow(0.36, 0.84, 0.5, 8, 0.045, 0.18), K(0.92, 0.3, 0.12),
    ],

    // Power
    pl8c: [
      B(0.03, 0.42, 0.12, 0.4), SC(0.2, 0.3, 0.16, 0.44), L(0.42, 0.32, 0.05),
      L(0.84, 0.42, 0.12), L(0.95, 0.42, 0.12),
    ],
    plproc: [
      B(0.03, 0.42, 0.12, 0.4), SC(0.18, 0.3, 0.16, 0.44), ledRow(0.4, 0.66, 0.36, 6, 0.04),
      L(0.85, 0.42, 0.12), L(0.96, 0.42, 0.12),
    ],
    powerlight: [
      B(0.04, 0.45, 0.12, 0.4), ledRow(0.22, 0.78, 0.5, 9, 0.05), B(0.92, 0.45, 0.1, 0.4),
    ],

    // Patch & IO
    dl16: [
      jackRow(0.0, 1.0, 0.2, 12, 0.07), jackRow(0.0, 1.0, 0.5, 12, 0.07),
      jackRow(0.0, 0.66, 0.8, 8, 0.07), ledRow(0.7, 1.0, 0.82, 4, 0.03),
    ],
    s16: [
      SC(0.02, 0.06, 0.16, 0.2), jackRow(0.0, 1.0, 0.34, 12, 0.07),
      jackRow(0.0, 1.0, 0.64, 12, 0.07), ledRow(0.22, 0.98, 0.1, 8, 0.025),
    ],
    ttpatch: [
      jackRow(0.0, 1.0, 0.32, 24, 0.05), jackRow(0.0, 1.0, 0.68, 24, 0.05),
    ],
    medusa: [
      jackRow(0.0, 1.0, 0.42, 12, 0.085),
    ],
  };

  /* ---------- archetype templates (quick custom devices) ---------- */
  function fromTemplate(t, u) {
    switch (t) {
      case "mixer": return [SC(0.0, 0.14, 0.32, 0.6), knobRow(0.4, 1.0, 0.32, 6, 0.14), btnRow(0.4, 1.0, 0.66, 7, 0.06, 0.12)];
      case "amp": return [K(0.1, 0.45, 0.24), K(0.27, 0.45, 0.24), VT(0.44, 0.24, 0.4, 0.5, 7), B(0.92, 0.5, 0.1, 0.3)];
      case "comp": return [knobRow(0.04, 0.66, 0.45, 6, 0.14), MT(0.72, 0.3, 0.24, 0.4, 9)];
      case "eq": return [faderRow(0.0, 1.0, 0.16, 15, 0.64)];
      case "player": return [SC(0.02, 0.42, 0.32, 0.16), SC(0.4, 0.28, 0.18, 0.44), btnRow(0.66, 0.98, 0.5, 5, 0.05, 0.16)];
      case "power": return [B(0.04, 0.45, 0.12, 0.4), SC(0.2, 0.3, 0.16, 0.44), jackRow(0.42, 1.0, 0.5, 7, 0.07)];
      case "patch": return [jackRow(0.0, 1.0, u >= 2 ? 0.3 : 0.34, 16, 0.06), jackRow(0.0, 1.0, u >= 2 ? 0.62 : 0.68, 16, 0.06)];
      default: return [];
    }
  }

  var TEMPLATES = [
    { id: "blank", label: "Blank panel" },
    { id: "mixer", label: "Mixer / console" },
    { id: "amp", label: "Amplifier" },
    { id: "comp", label: "Processor / dynamics" },
    { id: "eq", label: "Graphic EQ" },
    { id: "player", label: "Player / transport" },
    { id: "power", label: "Power conditioner" },
    { id: "patch", label: "Patchbay / I/O" },
  ];

  /* resolve a device's face to a concrete component spec */
  function resolveSpec(device) {
    var face = (device && device.face) || {};
    if (Array.isArray(face.spec)) return face.spec;
    if (face.id && SCHEMATICS[face.id]) return SCHEMATICS[face.id];
    if (face.t) return fromTemplate(face.t, device ? device.u : 1);
    return [];
  }

  /* keep only a clean, persistable face object */
  function normalizeFace(face) {
    if (!face || typeof face !== "object") return { id: "blank" };
    if (Array.isArray(face.spec)) return { spec: face.spec };
    if (typeof face.id === "string") return { id: SCHEMATICS[face.id] ? face.id : "blank" };
    if (typeof face.t === "string") return { t: face.t };
    return { id: "blank" };
  }
  function build(t) {
    return { t: t || "blank" };
  }

  /* ---------- rack ears + screws ---------- */
  function ears(H, u) {
    var ew = 18;
    var s = line(ew, 4, ew, H - 4) + line(W - ew, 4, W - ew, H - 4);
    for (var i = 0; i < u; i++) {
      var yTop = i * UH + 8, yBot = i * UH + UH - 8;
      s += circle(ew / 2, yTop, 2) + circle(ew / 2, yBot, 2);
      s += circle(W - ew / 2, yTop, 2) + circle(W - ew / 2, yBot, 2);
    }
    return s;
  }

  /* masked CAD-style model badge, centred on the bottom edge */
  function titleBlock(name, H, bg) {
    if (!name) return "";
    var s = String(name).toUpperCase();
    var fs = Math.min(8.5, H * 0.16 + 3);
    var tw = clamp(s.length * fs * 0.64 + 12, 40, W * 0.5);
    var th = fs + 6;
    var x = (W - tw) / 2, y = H - th - 2;
    return (
      '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(tw) + '" height="' + f(th) +
      '" rx="1.5" fill="' + esc(bg || "#222") + '" stroke="none"/>' +
      rrect(x, y, tw, th, 1.5) +
      text(W / 2, y + th - th * 0.32, s, fs, "middle")
    );
  }

  /* ---------- public: full faceplate SVG ---------- */
  function svg(device) {
    var u = Math.max(1, device.u || 1);
    var H = u * UH - 4;
    var body =
      ears(H, u) +
      draw(resolveSpec(device), H) +
      titleBlock(device.name, H, device.color) +
      circle(W - 30, 9, 2.6, !!device.led);
    return (
      '<svg class="fp" viewBox="0 0 ' + W + " " + f(H) +
      '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">' +
      body + "</g></svg>"
    );
  }

  return {
    TEMPLATES: TEMPLATES,
    SCHEMATICS: SCHEMATICS,
    svg: svg,
    build: build,
    normalizeFace: normalizeFace,
    resolveSpec: resolveSpec,
    fromTemplate: fromTemplate,
  };
})();
