/* faceplates.js — procedural CAD-blueprint line-art faceplate engine.
 *
 * Produces a flat, 2D, stroke-only SVG of a device front panel — no fill,
 * no shading, no gradients. Drawn in a viewBox locked to the real device
 * aspect (19" wide, 1.75" per U), so proportions are always correct. All
 * strokes use currentColor, so the line colour follows the device/theme.
 *
 * A device carries a `face` descriptor: { t: <template id>, d: <detail 1..10> }.
 * Templates are archetypes (mixer, amp, processor, eq, player, power, patch,
 * blank). The same engine renders built-ins and user-composed devices, so
 * everything shares one visual language.
 */
window.Faceplates = (function () {
  "use strict";

  var W = 380; // viewBox width  (≙ 19")
  var UH = 44; // viewBox height per U (matches the on-screen U pixel height)

  /* ---------- number / string helpers ---------- */
  function f(n) {
    return Math.round(n * 100) / 100;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- primitive shapes (markup strings) ---------- */
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
    return (
      '<text x="' + f(x) + '" y="' + f(y) + '" font-size="' + f(size) +
      '" text-anchor="' + (anchor || "start") +
      '" fill="currentColor" stroke="none" font-family="-apple-system,system-ui,sans-serif"' +
      ' style="letter-spacing:.1em">' + esc(s) + "</text>"
    );
  }

  /* ---------- control primitives ---------- */
  function knob(cx, cy, r) {
    return circle(cx, cy, r) + line(cx, cy, cx, cy - r * 0.82) + circle(cx, cy, r * 0.13, true);
  }
  function jack(cx, cy, r) {
    return circle(cx, cy, r) + circle(cx, cy, r * 0.42);
  }
  function button(x, y, w, h) {
    return rrect(x, y, w, h, Math.min(2, h / 2));
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
    for (var i = 0; i < n; i++) {
      var yy = y + (h / Math.max(1, n - 1)) * i;
      s += line(x, yy, x + w, yy);
    }
    return s;
  }
  function meter(x, y, w, h, seg) {
    var s = rrect(x, y, w, h, 1);
    for (var i = 1; i < seg; i++) s += line(x + (w / seg) * i, y, x + (w / seg) * i, y + h);
    return s;
  }

  /* ---------- row helpers ---------- */
  function rowKnobs(x0, x1, cy, n, r) {
    var s = "", step = (x1 - x0) / n;
    for (var i = 0; i < n; i++) s += knob(x0 + step * (i + 0.5), cy, r);
    return s;
  }
  function rowJacks(x0, x1, cy, n, r) {
    var s = "", step = (x1 - x0) / n;
    for (var i = 0; i < n; i++) s += jack(x0 + step * (i + 0.5), cy, r);
    return s;
  }
  function rowButtons(x0, x1, cy, n, w, h) {
    var s = "", step = (x1 - x0) / n;
    for (var i = 0; i < n; i++) s += button(x0 + step * (i + 0.5) - w / 2, cy - h / 2, w, h);
    return s;
  }

  /* ---------- rack ears + screw holes ---------- */
  function ears(H, u) {
    var ew = 19;
    var s = line(ew, 4, ew, H - 4) + line(W - ew, 4, W - ew, H - 4);
    for (var i = 0; i < u; i++) {
      var yTop = i * UH + 8, yBot = i * UH + UH - 8;
      s += circle(ew / 2, yTop, 2) + circle(ew / 2, yBot, 2);
      s += circle(W - ew / 2, yTop, 2) + circle(W - ew / 2, yBot, 2);
    }
    return s;
  }

  /* ---------- templates: (H, u, d) -> features markup ---------- */
  var PAD = 30; // content inset from the panel edge

  function tBlank() {
    return "";
  }

  function tMixer(H, u, d) {
    var x0 = PAD, x1 = W - PAD;
    var sh = Math.min(H - 16, H * 0.66), sy = (H - sh) / 2 - 2;
    var sw = (x1 - x0) * 0.32;
    var s = display(x0, sy, sw, sh);
    var gx0 = x0 + sw + 16;
    var cols = clamp(3 + d, 4, 8);
    var rows = u >= 3 ? 2 : 1;
    var r = Math.min(7, (sh / rows) * 0.24);
    for (var rr = 0; rr < rows; rr++) {
      var cy = rows === 1 ? H * 0.42 : sy + sh * ((rr + 0.5) / rows);
      s += rowKnobs(gx0, x1, cy, cols, r);
    }
    if (u >= 2) s += rowButtons(gx0, x1, H - 12, clamp(cols, 4, 8), 14, 7);
    return s;
  }

  function tAmp(H, u, d) {
    var x0 = PAD, x1 = W - PAD, cy = H * 0.46;
    var r = Math.min(11, H * 0.26);
    var s = knob(x0 + r + 4, cy, r) + knob(x0 + r * 3 + 18, cy, r);
    var vx = x0 + r * 4 + 44, vw = x1 - vx - 22;
    if (vw > 24) s += vents(vx, H * 0.26, vw, H * 0.48, clamp(3 + u, 4, 9));
    s += button(x1 - 14, cy - 7, 13, 14); // power
    return s;
  }

  function tComp(H, u, d) {
    var x0 = PAD, x1 = W - PAD, cy = H * 0.46;
    var n = clamp(2 + d, 3, 9);
    var mW = Math.min(72, (x1 - x0) * 0.26);
    var kEnd = x1 - mW - 16;
    var s = rowKnobs(x0, kEnd, cy, n, Math.min(7, H * 0.15 + 2));
    s += meter(x1 - mW, H * 0.32, mW, H * 0.36, 9);
    if (u >= 2) s += rowButtons(x0, kEnd, H - 13, clamp(n, 3, 8), 14, 7);
    return s;
  }

  function tEq(H, u, d) {
    var x0 = PAD - 4, x1 = W - PAD + 4;
    var n = clamp(6 + d * 2, 9, 31);
    var top = H * 0.16, fh = H * 0.66, step = (x1 - x0) / n;
    var s = "";
    for (var i = 0; i < n; i++) s += fader(x0 + step * (i + 0.5), top, fh, ((i % 5) + 1) / 7);
    return s;
  }

  function tPlayer(H, u, d) {
    var x0 = PAD, x1 = W - PAD, cy = H * 0.46;
    var slotW = (x1 - x0) * 0.4;
    var s = rrect(x0, cy - 4, slotW, 8, 4); // disc slot
    s += display(x0 + slotW + 14, H * 0.3, (x1 - x0) * 0.2, H * 0.4); // counter
    var bx = x1 - 70, n = 4, bw = 12, bh = 10;
    for (var i = 0; i < n; i++) s += button(bx + i * 16, cy - bh / 2, bw, bh);
    return s;
  }

  function tPower(H, u, d) {
    var x0 = PAD, x1 = W - PAD, cy = H * 0.5;
    var s = button(x0, cy - 9, 15, 18); // breaker
    s += knob(x0 + 36, cy, Math.min(10, H * 0.26)); // voltmeter gauge
    var ox0 = x0 + 62;
    s += rowJacks(ox0, x1, cy, clamp(5 + d, 6, 11), Math.min(7, H * 0.15 + 2)); // outlets
    return s;
  }

  function tPatch(H, u, d) {
    var x0 = 26, x1 = W - 26;
    var rows = u >= 3 ? 4 : 2;
    var per = clamp(8 + d * 2, 8, 24);
    var s = "";
    for (var rr = 0; rr < rows; rr++) {
      var cy = H * ((rr + 1) / (rows + 1));
      s += rowJacks(x0, x1, cy, per, Math.min(5, (H / rows) * 0.16 + 1.5));
    }
    return s;
  }

  var MAP = {
    blank: tBlank,
    mixer: tMixer,
    amp: tAmp,
    comp: tComp,
    eq: tEq,
    player: tPlayer,
    power: tPower,
    patch: tPatch,
  };

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

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  /* face descriptor factory */
  function build(t, d) {
    return { t: MAP[t] ? t : "blank", d: d == null ? 5 : clamp(d, 1, 10) };
  }
  function normalizeFace(face) {
    if (!face || typeof face !== "object") return build("blank", 5);
    return build(face.t, face.d);
  }

  /* CAD-style title block: a small badge centred on the bottom edge, filled
     with the panel colour so it masks the line art behind it (like a model
     plate), bordered and labelled with the device name */
  function titleBlock(name, H, bg) {
    if (!name) return "";
    var s = String(name).toUpperCase();
    var fs = Math.min(8.5, H * 0.16 + 3);
    var tw = clamp(s.length * fs * 0.64 + 12, 40, W * 0.5);
    var th = fs + 6;
    var x = (W - tw) / 2;
    var y = H - th - 2;
    return (
      '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(tw) + '" height="' + f(th) +
      '" rx="1.5" fill="' + esc(bg || "#222") + '" stroke="none"/>' +
      rrect(x, y, tw, th, 1.5) +
      text(W / 2, y + th - th * 0.32, s, fs, "middle")
    );
  }

  /* status LED, top-right inside the content area */
  function statusLed(on, H) {
    return circle(W - 30, 9, 2.6, !!on);
  }

  /* ---------- public: full faceplate SVG for a device ---------- */
  function svg(device) {
    var u = Math.max(1, device.u || 1);
    var H = u * UH - 4;
    var face = normalizeFace(device.face);
    var body =
      ears(H, u) +
      (MAP[face.t] || tBlank)(H, u, face.d) +
      titleBlock(device.name, H, device.color) +
      statusLed(device.led, H);
    return (
      '<svg class="fp" viewBox="0 0 ' + W + " " + f(H) +
      '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">' +
      body +
      "</g></svg>"
    );
  }

  return {
    TEMPLATES: TEMPLATES,
    build: build,
    normalizeFace: normalizeFace,
    svg: svg,
  };
})();
