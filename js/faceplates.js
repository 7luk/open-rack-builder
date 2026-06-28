/* faceplates.js — procedural CAD-blueprint line-art faceplate engine.
 *
 * Flat, stroke-only SVG (no shading/gradients), drawn in a viewBox locked to
 * the real device aspect (19" wide, 1.75" per U). Strokes use currentColor, so
 * the line colour follows the device/theme and stays crisp at any zoom.
 *
 * A faceplate is a declarative COMPONENT SPEC: an array of parts placed by
 * normalized coordinates. Built-ins have FRONT and REAR schematics modelled on
 * the real units (researched from manuals / manufacturer pages). Custom and
 * community devices carry their own spec, so everything is portable.
 *
 * A device's `face` can be:
 *   { id: "<model>" }                  resolve from SCHEMATICS / REAR
 *   { spec:[...], rearSpec:[...] }      inline (custom / community)
 *   { t: "<template>" }                quick archetype
 *
 * Coords inside a spec:
 *   x, w  — fraction (0..1) of panel WIDTH (between the rack ears)
 *   y, h  — fraction (0..1) of panel HEIGHT
 *   r, size — fraction of one U (constant physical size)
 *   knob/jack/led/button/text are placed by CENTRE; screen/meter/vent by
 *   TOP-LEFT; fader by centre-x / top-y.
 */
window.Faceplates = (function () {
  "use strict";

  var W = 380; // viewBox width (≙ 19")
  var UH = 44; // viewBox height per U

  /* ---------- helpers ---------- */
  function f(n) { return Math.round(n * 100) / 100; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function flat(a) {
    var out = [];
    (a || []).forEach(function (x) {
      if (Array.isArray(x)) out = out.concat(flat(x));
      else if (x) out.push(x);
    });
    return out;
  }

  /* ---------- primitive shapes ---------- */
  function circle(cx, cy, r, filled) {
    return '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(Math.max(0.3, r)) + '"' +
      (filled ? ' fill="currentColor" stroke="none"' : "") + "/>";
  }
  function lineEl(x1, y1, x2, y2) {
    return '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '"/>';
  }
  function rrect(x, y, w, h, r) {
    return '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(Math.max(0, w)) +
      '" height="' + f(Math.max(0, h)) + '" rx="' + f(r || 0) + '"/>';
  }
  function textEl(x, y, s, size, anchor) {
    if (s == null || s === "") return "";
    return '<text x="' + f(x) + '" y="' + f(y) + '" font-size="' + f(size) +
      '" text-anchor="' + (anchor || "middle") +
      '" fill="currentColor" stroke="none" font-family="-apple-system,system-ui,sans-serif"' +
      ' style="letter-spacing:.06em">' + esc(s) + "</text>";
  }

  /* ---------- control primitives (px) ---------- */
  function pKnob(cx, cy, r) {
    return circle(cx, cy, r) + lineEl(cx, cy, cx, cy - r * 0.82) + circle(cx, cy, r * 0.13, true);
  }
  function pJack(cx, cy, r) { return circle(cx, cy, r) + circle(cx, cy, r * 0.4); }
  function pDisplay(x, y, w, h) {
    var s = rrect(x, y, w, h, 2);
    var n = Math.min(4, Math.max(1, Math.round(h / 14)));
    for (var i = 1; i < n; i++) s += lineEl(x + 3, y + (h / n) * i, x + w - 3, y + (h / n) * i);
    return s;
  }
  function pFader(cx, top, h, pos) {
    var cap = 7, capY = top + (h - cap) * (pos == null ? 0.5 : pos);
    return lineEl(cx, top, cx, top + h) + rrect(cx - 4, capY, 8, cap, 1);
  }
  function pVents(x, y, w, h, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += lineEl(x, y + (h / Math.max(1, n - 1)) * i, x + w, y + (h / Math.max(1, n - 1)) * i);
    return s;
  }
  function pMeter(x, y, w, h, seg) {
    var s = rrect(x, y, w, h, 1);
    for (var i = 1; i < seg; i++) s += lineEl(x + (w / seg) * i, y, x + (w / seg) * i, y + h);
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
  function TX(x, y, s, sz, a) { return { k: "text", x: x, y: y, s: s, size: sz || 0.14, anchor: a }; }

  function rowOf(maker, x0, x1, y, n, arg) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(maker(x0 + (x1 - x0) * ((i + 0.5) / n), y, arg));
    return a;
  }
  function colOf(maker, x, y0, y1, n, arg) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(maker(x, n === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * (i / (n - 1)), arg));
    return a;
  }
  function knobRow(x0, x1, y, n, r) { return rowOf(K, x0, x1, y, n, r); }
  function jackRow(x0, x1, y, n, r) { return rowOf(J, x0, x1, y, n, r); }
  function ledRow(x0, x1, y, n, r) { return rowOf(L, x0, x1, y, n, r); }
  function faderRow(x0, x1, y, n, h) { return rowOf(FD, x0, x1, y, n, h); }
  function knobCol(x, y0, y1, n, r) { return colOf(K, x, y0, y1, n, r); }
  function ledCol(x, y0, y1, n, r) { return colOf(L, x, y0, y1, n, r); }
  function btnRow(x0, x1, y, n, w, h) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(B(x0 + (x1 - x0) * ((i + 0.5) / n), y, w, h));
    return a;
  }
  function btnCol(x, y0, y1, n, w, h) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(B(x, n === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * (i / (n - 1)), w, h));
    return a;
  }
  function btnGrid(x0, x1, y0, y1, cols, rows, w, h) {
    var a = [];
    for (var ri = 0; ri < rows; ri++)
      for (var ci = 0; ci < cols; ci++)
        a.push(B(cols === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * ci / (cols - 1),
          rows === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * ri / (rows - 1), w, h));
    return a;
  }
  function ledGrid(x0, x1, y0, y1, cols, rows, r) {
    var a = [];
    for (var ri = 0; ri < rows; ri++)
      for (var ci = 0; ci < cols; ci++)
        a.push(L(cols === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * ci / (cols - 1),
          rows === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * ri / (rows - 1), r));
    return a;
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
        case "knob": out += pKnob(x, y, (c.r || 0.16) * UH); break;
        case "jack": out += pJack(x, y, (c.r || 0.12) * UH); break;
        case "led": out += circle(x, y, (c.r || 0.05) * UH, true); break;
        case "button":
          var bw = (c.w || 0.32) * UH, bh = (c.h || 0.16) * UH;
          out += rrect(x - bw / 2, y - bh / 2, bw, bh, Math.min(2, bh / 2));
          break;
        case "screen": out += pDisplay(x, y, (c.w || 0.3) * cw, (c.h || 0.5) * ch); break;
        case "meter": out += pMeter(x, y, (c.w || 0.18) * cw, (c.h || 0.4) * ch, c.seg || 9); break;
        case "vent": out += pVents(x, y, (c.w || 0.4) * cw, (c.h || 0.5) * ch, c.n || 6); break;
        case "fader": out += pFader(x, y, (c.h || 0.62) * ch, c.pos); break;
        case "text": out += textEl(x, y, c.s, (c.size || 0.14) * UH, c.anchor); break;
      }
    });
    return out;
  }

  /* ============================================================
   *  FRONT schematics — modelled on the real front panels
   * ============================================================ */
  var SCHEMATICS = {
    blank: [],

    /* Behringer X32 Rack / Midas M32R: 5" TFT, 6 push-encoders beneath,
       function-button cluster, level + phones knobs */
    x32rack: [
      SC(0.02, 0.12, 0.30, 0.52), knobRow(0.02, 0.32, 0.80, 6, 0.10),
      btnGrid(0.40, 0.74, 0.16, 0.40, 6, 2, 0.05, 0.09),
      knobRow(0.40, 0.74, 0.66, 5, 0.11),
      K(0.86, 0.5, 0.15), K(0.96, 0.5, 0.12), ledRow(0.40, 0.74, 0.92, 6, 0.025),
    ],

    /* Yamaha TF-Rack: large touchscreen, Touch&Turn knob beside it, 4 user
       knobs below, bank/user buttons left, phones */
    tfrack: [
      SC(0.30, 0.12, 0.42, 0.6), K(0.80, 0.28, 0.16), knobRow(0.30, 0.72, 0.86, 4, 0.11),
      btnCol(0.06, 0.16, 0.86, 4, 0.07, 0.10), btnGrid(0.14, 0.26, 0.18, 0.74, 2, 3, 0.05, 0.09),
      K(0.93, 0.66, 0.12), B(0.93, 0.3, 0.06, 0.16),
    ],

    /* Allen & Heath Qu-Pac: central touchscreen, 15 soft buttons (3x5) left,
       16 select buttons along the bottom, data encoder right */
    qupac: [
      SC(0.28, 0.10, 0.50, 0.58), btnGrid(0.03, 0.20, 0.12, 0.84, 3, 5, 0.045, 0.085),
      btnRow(0.28, 0.78, 0.9, 16, 0.02, 0.08), btnRow(0.30, 0.58, 0.8, 4, 0.04, 0.09),
      K(0.87, 0.4, 0.18),
    ],

    /* PreSonus StudioLive 32R: front face is dense with combo inputs (2 rows
       of 12) + outputs, plus a small control cluster */
    sl32r: [
      jackRow(0.03, 0.71, 0.3, 12, 0.115), jackRow(0.03, 0.71, 0.66, 12, 0.115),
      B(0.85, 0.18, 0.1, 0.13), J(0.80, 0.55, 0.11), K(0.91, 0.55, 0.14),
      ledRow(0.80, 0.97, 0.84, 4, 0.045),
    ],

    /* Crown XLi 2500: power switch, big vent grille, sig/clip/fault LED trios,
       two large detented level knobs */
    xli2500: [
      B(0.05, 0.5, 0.07, 0.62), VT(0.16, 0.12, 0.42, 0.76, 9),
      ledCol(0.63, 0.25, 0.62, 3, 0.045), ledCol(0.69, 0.25, 0.62, 3, 0.045),
      K(0.80, 0.46, 0.22), K(0.94, 0.46, 0.22),
    ],

    /* QSC PLD4.5: side vents, TFT LCD, nav buttons + scroll encoder, channel
       select/mute grid, power button */
    pld45: [
      VT(0.02, 0.18, 0.11, 0.64, 6), SC(0.17, 0.18, 0.26, 0.48),
      btnRow(0.17, 0.43, 0.8, 4, 0.05, 0.12), K(0.54, 0.36, 0.16),
      btnGrid(0.62, 0.86, 0.24, 0.6, 4, 2, 0.04, 0.10), B(0.94, 0.4, 0.05, 0.5),
    ],

    /* Lab Gruppen FP10000Q: intake grille, 4 channel pots, central per-channel
       LED display, FP+ grille, remote/power */
    fp10000q: [
      VT(0.02, 0.12, 0.26, 0.76, 6), knobCol(0.36, 0.18, 0.82, 4, 0.14),
      ledGrid(0.50, 0.62, 0.18, 0.82, 3, 4, 0.05), VT(0.71, 0.12, 0.15, 0.76, 4),
      btnCol(0.93, 0.30, 0.66, 2, 0.08, 0.18),
    ],

    /* Powersoft K10: intake vents flank a central LCD, per-channel LED bars,
       SmartCard slot, 4 buttons, power */
    k10: [
      VT(0.02, 0.12, 0.11, 0.76, 3), MT(0.16, 0.18, 0.045, 0.64, 7),
      SC(0.23, 0.14, 0.30, 0.50), btnRow(0.24, 0.52, 0.80, 4, 0.05, 0.18),
      SC(0.56, 0.26, 0.035, 0.46), MT(0.63, 0.18, 0.045, 0.64, 7),
      VT(0.70, 0.12, 0.12, 0.76, 3), B(0.90, 0.2, 0.07, 0.6),
    ],

    /* Crown DCi 4|600 (DriveCore Install): minimal — grilles, 4 per-channel LED
       columns, bridge LEDs, ring-lit power */
    dci4600: [
      VT(0.02, 0.12, 0.30, 0.76, 6),
      MT(0.40, 0.16, 0.045, 0.55, 7), MT(0.47, 0.16, 0.045, 0.55, 7),
      MT(0.54, 0.16, 0.045, 0.55, 7), MT(0.61, 0.16, 0.045, 0.55, 7),
      L(0.435, 0.84, 0.05), L(0.575, 0.84, 0.05), VT(0.66, 0.12, 0.22, 0.76, 6),
      L(0.93, 0.28, 0.05), L(0.93, 0.44, 0.05), B(0.92, 0.62, 0.07, 0.26),
    ],

    /* dbx 266xs: two channel strips — 4 knobs + GR meter + status LEDs each */
    dbx266: [
      knobRow(0.05, 0.42, 0.45, 4, 0.13), MT(0.03, 0.78, 0.4, 0.12, 8),
      L(0.05, 0.16, 0.04), L(0.4, 0.16, 0.04),
      knobRow(0.58, 0.95, 0.45, 4, 0.13), MT(0.57, 0.78, 0.4, 0.12, 8),
      L(0.6, 0.16, 0.04), L(0.95, 0.16, 0.04), B(0.5, 0.45, 0.04, 0.3),
    ],

    /* BSS BLU-100: flat panel — input/output LED meter groups + status LEDs */
    blu100: [
      MT(0.27, 0.2, 0.07, 0.6, 3), MT(0.39, 0.2, 0.07, 0.6, 3), MT(0.51, 0.2, 0.07, 0.6, 3),
      MT(0.65, 0.2, 0.07, 0.6, 2), MT(0.75, 0.2, 0.07, 0.6, 2), ledRow(0.83, 0.96, 0.5, 4, 0.05),
    ],

    /* Klark Teknik DN360: dual 30-band graphic EQ — two fader rows + per-row
       control block (LED, switches, level) */
    dn360: [
      faderRow(0.03, 0.76, 0.10, 30, 0.34), faderRow(0.03, 0.76, 0.54, 30, 0.34),
      L(0.82, 0.12, 0.05), btnRow(0.84, 0.96, 0.22, 2, 0.05, 0.14), K(0.89, 0.40, 0.12),
      L(0.82, 0.56, 0.05), btnRow(0.84, 0.96, 0.66, 2, 0.05, 0.14), K(0.89, 0.84, 0.12),
    ],

    /* Lexicon PCM96: input meter, wide OLED, machine keys, big SELECT encoder +
       3 soft encoders, button cluster, CF slot, power */
    pcm96: [
      MT(0.03, 0.22, 0.05, 0.56, 6), SC(0.10, 0.18, 0.27, 0.62), btnCol(0.42, 0.34, 0.66, 2, 0.05, 0.2),
      K(0.51, 0.5, 0.17), knobRow(0.58, 0.76, 0.5, 3, 0.12),
      btnGrid(0.80, 0.90, 0.34, 0.66, 2, 2, 0.05, 0.2), SC(0.89, 0.30, 0.05, 0.16), B(0.96, 0.5, 0.035, 0.3),
    ],

    /* TC Electronic M3000: power+card slot, dual meters, LCD, button field,
       single large ADJUST wheel at far right */
    m3000: [
      B(0.045, 0.30, 0.05, 0.24), SC(0.02, 0.62, 0.075, 0.14),
      MT(0.11, 0.24, 0.035, 0.52, 8), MT(0.15, 0.24, 0.035, 0.52, 8), ledCol(0.205, 0.30, 0.70, 3, 0.05),
      SC(0.245, 0.28, 0.20, 0.44), btnRow(0.50, 0.80, 0.32, 5, 0.055, 0.2), btnRow(0.50, 0.80, 0.68, 5, 0.055, 0.2),
      K(0.92, 0.5, 0.19),
    ],

    /* Behringer DEQ2496: input meter, big graphic LCD, module-button grid,
       three push-encoder wheels */
    deq2496: [
      MT(0.025, 0.18, 0.05, 0.64, 10), SC(0.10, 0.16, 0.30, 0.66),
      btnRow(0.44, 0.83, 0.30, 7, 0.05, 0.22), btnRow(0.44, 0.83, 0.70, 7, 0.05, 0.22),
      knobCol(0.92, 0.24, 0.76, 3, 0.13),
    ],

    /* Denon DN-500BD: power + USB, Blu-ray tray, eject, FL display, status LEDs,
       transport cluster */
    dn500bd: [
      B(0.05, 0.72, 0.05, 0.22), J(0.05, 0.32, 0.1), SC(0.13, 0.18, 0.30, 0.64),
      B(0.475, 0.5, 0.04, 0.22), SC(0.55, 0.30, 0.20, 0.40),
      ledCol(0.785, 0.30, 0.70, 3, 0.05), btnGrid(0.85, 0.95, 0.32, 0.68, 3, 2, 0.04, 0.2),
    ],

    /* Tascam CD-400U: power + aux, slot + eject, keypad, LCD, multi-jog,
       transport, SD/USB, phones */
    cd400u: [
      B(0.04, 0.30, 0.045, 0.22), J(0.045, 0.74, 0.1), SC(0.09, 0.21, 0.23, 0.13),
      btnRow(0.13, 0.31, 0.72, 5, 0.035, 0.17), SC(0.385, 0.28, 0.15, 0.44),
      K(0.62, 0.46, 0.16), btnRow(0.69, 0.78, 0.32, 3, 0.03, 0.18),
      J(0.86, 0.5, 0.1), K(0.94, 0.34, 0.14), J(0.94, 0.72, 0.1),
    ],

    /* Denon DN-700C: phones knob+jack, power, USB, display, soft keys, media +
       transport rows, jog/enter wheel */
    dn700c: [
      K(0.05, 0.30, 0.14), B(0.05, 0.66, 0.04, 0.22), J(0.13, 0.66, 0.1), J(0.18, 0.5, 0.1),
      SC(0.20, 0.18, 0.20, 0.12), btnRow(0.215, 0.415, 0.62, 6, 0.03, 0.2),
      SC(0.47, 0.28, 0.20, 0.44), btnGrid(0.74, 0.875, 0.32, 0.70, 4, 2, 0.03, 0.18), K(0.94, 0.5, 0.16),
    ],

    /* Furman PL-8C: power/dimmer rocker, dimmer knob, status LEDs, front outlet,
       two pull-out rack lamps */
    pl8c: [
      B(0.04, 0.5, 0.06, 0.5), K(0.16, 0.5, 0.12), L(0.30, 0.38, 0.045), L(0.30, 0.62, 0.045),
      J(0.46, 0.5, 0.09), J(0.55, 0.5, 0.09), J(0.86, 0.5, 0.12), J(0.96, 0.5, 0.12),
    ],

    /* Furman PL-Pro/PL-8C-style with LED voltmeter */
    plproc: [
      B(0.03, 0.5, 0.06, 0.5), K(0.14, 0.5, 0.12), MT(0.24, 0.3, 0.22, 0.4, 10),
      L(0.52, 0.38, 0.045), L(0.52, 0.62, 0.045), J(0.64, 0.5, 0.09), J(0.73, 0.5, 0.09),
      J(0.87, 0.5, 0.12), J(0.96, 0.5, 0.12),
    ],

    /* ART power conditioner: pull-out lamp, power switch+LED, breaker, VOLTS +
       AMPS meters, lights switch, dimmer, pull-out lamp */
    powerlight: [
      B(0.06, 0.5, 0.05, 0.62), B(0.16, 0.45, 0.07, 0.42), L(0.16, 0.18, 0.045),
      B(0.255, 0.45, 0.045, 0.3), MT(0.33, 0.2, 0.16, 0.55, 9), MT(0.52, 0.2, 0.16, 0.55, 9),
      B(0.78, 0.45, 0.07, 0.42), K(0.88, 0.42, 0.16), B(0.95, 0.5, 0.05, 0.62),
    ],

    /* Midas DL16 / Behringer S16: front carries all XLRs — 16 inputs (2 rows of
       8) + 8 outputs, plus control cluster */
    dl16: [
      jackRow(0.05, 0.64, 0.2, 8, 0.115), jackRow(0.05, 0.64, 0.48, 8, 0.115),
      jackRow(0.05, 0.64, 0.76, 8, 0.115), TX(0.06, 0.07, "INPUTS", 0.10, "start"),
      TX(0.06, 0.63, "OUTPUTS", 0.10, "start"), SC(0.72, 0.1, 0.22, 0.18),
      MT(0.705, 0.34, 0.045, 0.4, 8), ledRow(0.80, 0.92, 0.33, 3, 0.04), K(0.86, 0.48, 0.16),
      btnRow(0.80, 0.92, 0.74, 2, 0.09, 0.1), J(0.80, 0.91, 0.1), K(0.92, 0.91, 0.13),
    ],

    /* Neutrik TT/bantam patchbay: two rows of 48 small jacks */
    ttpatch: [
      jackRow(0.02, 0.98, 0.3, 48, 0.045), jackRow(0.02, 0.98, 0.7, 48, 0.045),
    ],

    /* Whirlwind Medusa: a row of 12 panel-mount XLRs */
    medusa: [
      jackRow(0.04, 0.96, 0.5, 12, 0.115),
    ],
  };
  SCHEMATICS.m32r = SCHEMATICS.x32rack; // same platform as the X32 Rack
  SCHEMATICS.s16 = SCHEMATICS.dl16; // same stagebox layout family

  /* ============================================================
   *  REAR schematics — real I/O panels
   * ============================================================ */
  function powerInlet() { return B(0.96, 0.5, 0.05, 0.6); }
  function defaultRear(u) {
    return [B(0.04, 0.5, 0.05, 0.5), jackRow(0.14, 0.92, 0.5, Math.max(6, Math.min(20, 6 * u)), 0.1)];
  }

  var REAR = {
    blank: [],
    x32rack: [
      TX(0.05, 0.1, "INPUTS", 0.08, "start"), jackRow(0.03, 0.55, 0.3, 8, 0.085), jackRow(0.03, 0.55, 0.62, 8, 0.085),
      TX(0.62, 0.18, "OUT", 0.08, "start"), jackRow(0.60, 0.84, 0.45, 4, 0.09),
      J(0.90, 0.28, 0.085), J(0.90, 0.5, 0.085), J(0.90, 0.72, 0.085), powerInlet(),
    ],
    tfrack: [
      jackRow(0.03, 0.6, 0.28, 8, 0.08), jackRow(0.03, 0.6, 0.6, 8, 0.08),
      jackRow(0.66, 0.9, 0.45, 8, 0.07), J(0.94, 0.25, 0.08), powerInlet(),
    ],
    qupac: [
      jackRow(0.03, 0.6, 0.28, 8, 0.08), jackRow(0.03, 0.6, 0.6, 8, 0.08),
      jackRow(0.66, 0.86, 0.45, 4, 0.09), J(0.92, 0.3, 0.09), powerInlet(),
    ],
    sl32r: [
      B(0.04, 0.3, 0.05, 0.3), J(0.04, 0.72, 0.08), J(0.11, 0.72, 0.08), J(0.17, 0.45, 0.09),
      jackRow(0.26, 0.62, 0.28, 8, 0.085), jackRow(0.26, 0.84, 0.62, 8, 0.085),
    ],
    xli2500: [
      J(0.10, 0.6, 0.12), J(0.24, 0.6, 0.12), TX(0.17, 0.22, "IN", 0.1),
      J(0.56, 0.5, 0.15), J(0.74, 0.5, 0.15), TX(0.65, 0.18, "OUT", 0.1), powerInlet(),
    ],
    pld45: [
      jackRow(0.05, 0.4, 0.5, 4, 0.11), TX(0.22, 0.2, "IN", 0.1),
      jackRow(0.5, 0.85, 0.5, 4, 0.13), TX(0.67, 0.2, "OUT", 0.1), J(0.92, 0.3, 0.08), powerInlet(),
    ],
    fp10000q: [
      VT(0.02, 0.06, 0.96, 0.12, 8), J(0.05, 0.55, 0.1), J(0.14, 0.4, 0.09), J(0.14, 0.7, 0.09),
      jackRow(0.42, 0.66, 0.55, 4, 0.1), jackRow(0.74, 0.96, 0.55, 4, 0.1),
    ],
    k10: [
      J(0.05, 0.5, 0.13), VT(0.13, 0.15, 0.1, 0.7, 3), J(0.27, 0.4, 0.1),
      J(0.42, 0.45, 0.12), J(0.52, 0.45, 0.12), J(0.74, 0.45, 0.13), J(0.88, 0.45, 0.13),
    ],
    dci4600: [
      J(0.05, 0.3, 0.12), J(0.05, 0.72, 0.07), VT(0.12, 0.12, 0.1, 0.76, 4),
      J(0.27, 0.3, 0.11), knobRow(0.4, 0.61, 0.8, 4, 0.07),
      J(0.74, 0.28, 0.13), J(0.88, 0.28, 0.13), J(0.74, 0.72, 0.13), J(0.88, 0.72, 0.13),
    ],
    dbx266: [
      jackRow(0.05, 0.45, 0.5, 4, 0.11), TX(0.22, 0.18, "CH 1", 0.09),
      jackRow(0.52, 0.88, 0.5, 4, 0.11), TX(0.68, 0.18, "CH 2", 0.09), powerInlet(),
    ],
    blu100: [
      J(0.04, 0.5, 0.1), J(0.18, 0.5, 0.1), J(0.26, 0.5, 0.09), J(0.33, 0.36, 0.08), J(0.33, 0.66, 0.08),
      jackRow(0.45, 0.96, 0.5, 6, 0.1),
    ],
    dn360: [
      J(0.05, 0.5, 0.12), B(0.24, 0.5, 0.04, 0.3),
      J(0.78, 0.3, 0.12), J(0.9, 0.3, 0.12), J(0.78, 0.7, 0.12), J(0.9, 0.7, 0.12),
    ],
    pcm96: [
      jackRow(0.14, 0.32, 0.5, 4, 0.1), jackRow(0.4, 0.52, 0.5, 3, 0.09), J(0.6, 0.5, 0.09),
      jackRow(0.68, 0.96, 0.5, 6, 0.11),
    ],
    m3000: [
      B(0.10, 0.4, 0.035, 0.28), jackRow(0.16, 0.33, 0.5, 4, 0.1), jackRow(0.39, 0.66, 0.5, 6, 0.09),
      jackRow(0.72, 0.86, 0.5, 4, 0.09), J(0.94, 0.5, 0.11),
    ],
    deq2496: [
      B(0.10, 0.4, 0.035, 0.3), jackRow(0.17, 0.28, 0.5, 3, 0.1), jackRow(0.34, 0.44, 0.5, 3, 0.1),
      jackRow(0.5, 0.66, 0.5, 4, 0.11), J(0.72, 0.5, 0.12), jackRow(0.79, 0.95, 0.5, 4, 0.12),
    ],
    dn500bd: [
      jackRow(0.06, 0.21, 0.5, 4, 0.1), ledGrid(0.27, 0.41, 0.34, 0.66, 4, 2, 0.05),
      J(0.47, 0.5, 0.1), J(0.55, 0.5, 0.13), J(0.63, 0.5, 0.12), J(0.7, 0.5, 0.11), J(0.78, 0.5, 0.12), powerInlet(),
    ],
    cd400u: [
      J(0.06, 0.5, 0.11), J(0.13, 0.5, 0.1), jackRow(0.19, 0.26, 0.5, 2, 0.1), J(0.34, 0.5, 0.12),
      SC(0.42, 0.32, 0.07, 0.36), jackRow(0.55, 0.6, 0.5, 2, 0.1), jackRow(0.67, 0.72, 0.5, 2, 0.12), powerInlet(),
    ],
    dn700c: [
      jackRow(0.08, 0.14, 0.5, 2, 0.12), jackRow(0.2, 0.25, 0.5, 2, 0.1), J(0.31, 0.5, 0.11), J(0.38, 0.5, 0.1),
      J(0.45, 0.5, 0.12), J(0.58, 0.5, 0.12), J(0.74, 0.5, 0.14), powerInlet(),
    ],
    pl8c: [jackRow(0.06, 0.82, 0.5, 8, 0.13), powerInlet()],
    plproc: [jackRow(0.06, 0.84, 0.5, 9, 0.12), powerInlet()],
    powerlight: [jackRow(0.1, 0.82, 0.5, 8, 0.12), powerInlet()],
    dl16: [
      J(0.09, 0.5, 0.12), J(0.21, 0.5, 0.12), J(0.35, 0.5, 0.12), TX(0.21, 0.2, "AES50", 0.08),
      J(0.49, 0.5, 0.1), J(0.59, 0.5, 0.1), J(0.68, 0.5, 0.1), J(0.78, 0.5, 0.085),
      B(0.91, 0.6, 0.06, 0.4),
    ],
    ttpatch: [jackRow(0.02, 0.98, 0.3, 48, 0.045), jackRow(0.02, 0.98, 0.7, 48, 0.045)],
    medusa: [jackRow(0.04, 0.96, 0.5, 12, 0.115)],
  };
  REAR.m32r = REAR.x32rack;
  REAR.s16 = REAR.dl16;

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
    { id: "blank", label: "Blank panel" }, { id: "mixer", label: "Mixer / console" },
    { id: "amp", label: "Amplifier" }, { id: "comp", label: "Processor / dynamics" },
    { id: "eq", label: "Graphic EQ" }, { id: "player", label: "Player / transport" },
    { id: "power", label: "Power conditioner" }, { id: "patch", label: "Patchbay / I/O" },
  ];

  /* resolve a device's face to a concrete spec for the given side */
  function resolveSpec(device, side) {
    var face = (device && device.face) || {};
    var u = device ? device.u : 1;
    if (side === "rear") {
      if (Array.isArray(face.rearSpec)) return face.rearSpec;
      if (face.id && REAR[face.id]) return REAR[face.id];
      return defaultRear(u);
    }
    if (Array.isArray(face.spec)) return face.spec;
    if (face.id && SCHEMATICS[face.id]) return SCHEMATICS[face.id];
    if (face.t) return fromTemplate(face.t, u);
    return [];
  }
  function normalizeFace(face) {
    if (!face || typeof face !== "object") return { id: "blank" };
    if (Array.isArray(face.spec)) {
      var out = { spec: face.spec };
      if (Array.isArray(face.rearSpec)) out.rearSpec = face.rearSpec;
      return out;
    }
    if (typeof face.id === "string") return { id: SCHEMATICS[face.id] ? face.id : "blank" };
    if (typeof face.t === "string") return { t: face.t };
    return { id: "blank" };
  }
  function build(t) { return { t: t || "blank" }; }

  /* ---------- chrome: ears, badge, status led ---------- */
  function ears(H, u) {
    var ew = 18;
    var s = lineEl(ew, 4, ew, H - 4) + lineEl(W - ew, 4, W - ew, H - 4);
    for (var i = 0; i < u; i++) {
      var yTop = i * UH + 8, yBot = i * UH + UH - 8;
      s += circle(ew / 2, yTop, 2) + circle(ew / 2, yBot, 2);
      s += circle(W - ew / 2, yTop, 2) + circle(W - ew / 2, yBot, 2);
    }
    return s;
  }
  function titleBlock(name, H, bg) {
    if (!name) return "";
    var s = String(name).toUpperCase();
    var fs = Math.min(8.5, H * 0.16 + 3);
    var tw = clamp(s.length * fs * 0.64 + 12, 40, W * 0.5);
    var th = fs + 6, x = (W - tw) / 2, y = H - th - 2;
    return '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(tw) + '" height="' + f(th) +
      '" rx="1.5" fill="' + esc(bg || "#222") + '" stroke="none"/>' +
      rrect(x, y, tw, th, 1.5) + textEl(W / 2, y + th - th * 0.32, s, fs, "middle");
  }

  /* ---------- public: full faceplate SVG (side = 'front' | 'rear') ---------- */
  function svg(device, side) {
    var u = Math.max(1, device.u || 1);
    var H = u * UH - 4;
    var body =
      ears(H, u) +
      draw(resolveSpec(device, side), H) +
      titleBlock(device.name, H, device.color) +
      (side === "rear" ? "" : circle(W - 30, 9, 2.6, !!device.led));
    return '<svg class="fp" viewBox="0 0 ' + W + " " + f(H) +
      '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">' +
      body + "</g></svg>";
  }

  return {
    TEMPLATES: TEMPLATES, SCHEMATICS: SCHEMATICS, REAR: REAR,
    svg: svg, build: build, normalizeFace: normalizeFace, resolveSpec: resolveSpec, fromTemplate: fromTemplate,
  };
})();
