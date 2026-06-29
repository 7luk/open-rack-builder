/* ports.js — the connector model shared across the app.
 *
 * A device carries a flat list of ports: [{ type, dir, label }].
 *   type — connector family (xlr, jack, …); decides colour + drawn shape.
 *   dir  — "in" | "out" | "io" (io = bidirectional / legacy generic).
 *
 * The "Add new device" wizard and the properties panel collect ports as
 * per-type In/Out counts; the rear faceplate, topology nodes and cable
 * routing all read the flat list. A cable only forms between matching types
 * with compatible directions (an output into an input).
 */
window.Ports = (function () {
  "use strict";

  // registry: colour + the drawn connector shape/size (≈ real proportions)
  var TYPES = [
    { key: "xlr", label: "XLR", abbr: "XLR", color: "#2f6fed", shape: "round", w: 16, h: 16 },
    { key: "jack", label: 'Jack (¼")', abbr: "JACK", color: "#e08a1e", shape: "round", w: 11, h: 11 },
    { key: "speakon", label: "speakON", abbr: "SPK", color: "#2f9e57", shape: "round", w: 15, h: 15 },
    { key: "power", label: "Power", abbr: "PWR", color: "#d23b3b", shape: "rect", w: 15, h: 11 },
    { key: "ethernet", label: "Ethernet / etherCON", abbr: "NET", color: "#8a5cf0", shape: "rect", w: 13, h: 12 },
    { key: "midi", label: "MIDI", abbr: "MIDI", color: "#1aa6a6", shape: "round", w: 14, h: 14 },
    { key: "usb", label: "USB", abbr: "USB", color: "#6b7280", shape: "rect", w: 13, h: 7 },
    { key: "bnc", label: "BNC", abbr: "BNC", color: "#c2a01e", shape: "round", w: 9, h: 9 },
    { key: "other", label: "Other", abbr: "PORT", color: "#8a8f98", shape: "rect", w: 11, h: 9 },
  ];
  var byKey = {};
  TYPES.forEach(function (t) {
    byKey[t.key] = t;
  });

  function def(key) {
    return byKey[key] || byKey.other;
  }
  function color(key) {
    return def(key).color;
  }
  function abbr(key) {
    return def(key).abbr;
  }
  function label(key) {
    return def(key).label;
  }

  // can a cable join two ports? same type, and not output↔output / input↔input
  function compatible(typeA, dirA, typeB, dirB) {
    if (typeA !== typeB) return false;
    if (dirA === "io" || dirB === "io") return true;
    return dirA !== dirB; // in <-> out
  }

  // counts object {type:{in,out}} from a flat ports array (io counts as out)
  function countsFromPorts(ports) {
    var c = {};
    (ports || []).forEach(function (p) {
      var k = byKey[p.type] ? p.type : "other";
      if (!c[k]) c[k] = { in: 0, out: 0 };
      if (p.dir === "in") c[k].in++;
      else c[k].out++;
    });
    return c;
  }
  // flat ports array from counts, registry order, In before Out, labelled
  function fromCounts(counts) {
    counts = counts || {};
    var out = [];
    TYPES.forEach(function (t) {
      var c = counts[t.key] || {};
      ["in", "out"].forEach(function (dir) {
        var n = Math.max(0, Math.min(64, parseInt(c[dir], 10) || 0));
        var word = dir === "in" ? "In" : "Out";
        for (var i = 1; i <= n; i++) {
          out.push({ type: t.key, dir: dir, label: t.abbr + " " + word + " " + i });
        }
      });
    });
    return out;
  }
  function total(counts) {
    return TYPES.reduce(function (s, t) {
      var c = (counts || {})[t.key] || {};
      return s + (parseInt(c.in, 10) || 0) + (parseInt(c.out, 10) || 0);
    }, 0);
  }

  // a colour chip with text (used for the community card port summary)
  function chip(type, text) {
    var d = def(type);
    var elx = document.createElement("span");
    elx.className = "port-chip";
    elx.style.background = d.color;
    elx.textContent = text || d.abbr;
    elx.title = d.label;
    return elx;
  }

  // a drawn connector: the type's shape/size/colour (used on the rear plate)
  function glyph(type, dir) {
    var d = def(type);
    var g = document.createElement("span");
    g.className = "port-glyph port-" + d.shape;
    g.style.background = d.color;
    g.style.width = d.w + "px";
    g.style.height = d.h + "px";
    g.title = d.label + (dir === "in" ? " · In" : dir === "out" ? " · Out" : "");
    return g;
  }

  /* per-type In/Out count editor. `initial` is a counts object; `onChange`
     gets a fresh counts object on every change. Returns the editor element. */
  function editor(initial, onChange) {
    var counts = {};
    TYPES.forEach(function (t) {
      var c = (initial && initial[t.key]) || {};
      counts[t.key] = { in: clampN(c.in), out: clampN(c.out) };
    });

    var wrap = ce("div", "ports-editor");
    var head = ce("div", "ports-row ports-head");
    head.appendChild(ce("span", "ports-row-label", "Connector"));
    head.appendChild(ce("span", "ports-col-h", "In"));
    head.appendChild(ce("span", "ports-col-h", "Out"));
    wrap.appendChild(head);

    TYPES.forEach(function (t) {
      var row = ce("div", "ports-row");
      var lab = ce("span", "ports-row-label");
      var dot = ce("span", "ports-dot");
      dot.style.background = t.color;
      lab.appendChild(dot);
      lab.appendChild(document.createTextNode(t.label));
      row.appendChild(lab);
      row.appendChild(stepper(t.key, "in"));
      row.appendChild(stepper(t.key, "out"));
      wrap.appendChild(row);
    });

    function stepper(key, dir) {
      var s = ce("div", "ports-stepper");
      var minus = stepBtn("−");
      var val = ce("span", "ports-val", String(counts[key][dir]));
      var plus = stepBtn("+");
      function set(n) {
        n = Math.max(0, Math.min(64, n));
        counts[key][dir] = n;
        val.textContent = String(n);
        if (onChange) onChange(copy(counts));
      }
      minus.addEventListener("click", function () {
        set(counts[key][dir] - 1);
      });
      plus.addEventListener("click", function () {
        set(counts[key][dir] + 1);
      });
      s.appendChild(minus);
      s.appendChild(val);
      s.appendChild(plus);
      return s;
    }
    return wrap;
  }

  /* ---------- helpers ---------- */
  function clampN(v) {
    return Math.max(0, Math.min(64, parseInt(v, 10) || 0));
  }
  function copy(counts) {
    var c = {};
    for (var k in counts) {
      if (counts.hasOwnProperty(k)) c[k] = { in: counts[k].in, out: counts[k].out };
    }
    return c;
  }
  function ce(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function stepBtn(t) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ports-step-btn";
    b.textContent = t;
    return b;
  }

  return {
    TYPES: TYPES,
    def: def,
    color: color,
    abbr: abbr,
    label: label,
    compatible: compatible,
    countsFromPorts: countsFromPorts,
    fromCounts: fromCounts,
    total: total,
    chip: chip,
    glyph: glyph,
    editor: editor,
  };
})();
