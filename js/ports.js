/* ports.js — the connector model shared across the app.
 *
 * A device carries a flat list of ports: [{ type, label }]. The "Add new
 * device" wizard and the properties panel collect them as per-type counts;
 * everything else (rear faceplate, topology nodes, and later cable routing)
 * reads the flat list. Each port is a stable anchor a cable can attach to —
 * even devices with a real-photo faceplate map their pictured connectors onto
 * these virtual ports so routing stays consistent.
 */
window.Ports = (function () {
  "use strict";

  // ordered registry; colours read on both light and dark with white text
  var TYPES = [
    { key: "xlr", label: "XLR", abbr: "XLR", color: "#2f6fed" },
    { key: "jack", label: 'Jack (¼")', abbr: "JACK", color: "#e08a1e" },
    { key: "speakon", label: "speakON", abbr: "SPK", color: "#2f9e57" },
    { key: "power", label: "Power", abbr: "PWR", color: "#d23b3b" },
    { key: "ethernet", label: "Ethernet / etherCON", abbr: "NET", color: "#8a5cf0" },
    { key: "midi", label: "MIDI", abbr: "MIDI", color: "#1aa6a6" },
    { key: "usb", label: "USB", abbr: "USB", color: "#6b7280" },
    { key: "bnc", label: "BNC", abbr: "BNC", color: "#c2a01e" },
    { key: "other", label: "Other", abbr: "PORT", color: "#8a8f98" },
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

  // counts object {xlr:2,...} from a flat ports array
  function countsFromPorts(ports) {
    var c = {};
    (ports || []).forEach(function (p) {
      var k = byKey[p.type] ? p.type : "other";
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }
  // flat ports array from counts, in registry order, labelled "ABBR n"
  function fromCounts(counts) {
    counts = counts || {};
    var out = [];
    TYPES.forEach(function (t) {
      var n = Math.max(0, Math.min(64, parseInt(counts[t.key], 10) || 0));
      for (var i = 1; i <= n; i++) out.push({ type: t.key, label: t.abbr + " " + i });
    });
    return out;
  }
  function total(counts) {
    return TYPES.reduce(function (s, t) {
      return s + (parseInt((counts || {})[t.key], 10) || 0);
    }, 0);
  }

  // a small colour-coded chip element for one port (used on the rear plate)
  function chip(type, text) {
    var d = def(type);
    var el = document.createElement("span");
    el.className = "port-chip";
    el.style.background = d.color;
    el.textContent = text || d.abbr;
    el.title = d.label;
    return el;
  }

  /* a reusable per-type count editor. `initial` is a counts object; `onChange`
     gets a fresh counts object on every change. Returns the editor element. */
  function editor(initial, onChange) {
    var counts = {};
    TYPES.forEach(function (t) {
      counts[t.key] = Math.max(0, parseInt((initial || {})[t.key], 10) || 0);
    });

    var wrap = document.createElement("div");
    wrap.className = "ports-editor";

    TYPES.forEach(function (t) {
      var row = document.createElement("div");
      row.className = "ports-row";

      var dot = document.createElement("span");
      dot.className = "ports-dot";
      dot.style.background = t.color;

      var lab = document.createElement("span");
      lab.className = "ports-row-label";
      lab.textContent = t.label;

      var step = document.createElement("div");
      step.className = "ports-stepper";
      var minus = stepBtn("−");
      var val = document.createElement("span");
      val.className = "ports-val";
      val.textContent = String(counts[t.key]);
      var plus = stepBtn("+");

      function set(n) {
        n = Math.max(0, Math.min(64, n));
        counts[t.key] = n;
        val.textContent = String(n);
        if (onChange) onChange(copy(counts));
      }
      minus.addEventListener("click", function () {
        set(counts[t.key] - 1);
      });
      plus.addEventListener("click", function () {
        set(counts[t.key] + 1);
      });

      step.appendChild(minus);
      step.appendChild(val);
      step.appendChild(plus);
      row.appendChild(dot);
      row.appendChild(lab);
      row.appendChild(step);
      wrap.appendChild(row);
    });
    return wrap;
  }
  function stepBtn(t) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ports-step-btn";
    b.textContent = t;
    return b;
  }
  function copy(o) {
    var c = {};
    for (var k in o) if (o.hasOwnProperty(k)) c[k] = o[k];
    return c;
  }

  return {
    TYPES: TYPES,
    def: def,
    color: color,
    abbr: abbr,
    label: label,
    countsFromPorts: countsFromPorts,
    fromCounts: fromCounts,
    total: total,
    chip: chip,
    editor: editor,
  };
})();
