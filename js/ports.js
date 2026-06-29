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
    { key: "xlr", label: "XLR", short: "XLR", abbr: "XLR", color: "#2f6fed", shape: "round", w: 16, h: 16 },
    { key: "jack", label: 'Jack (¼")', short: "Jack", abbr: "JACK", color: "#e08a1e", shape: "round", w: 11, h: 11 },
    { key: "speakon", label: "speakON", short: "speakON", abbr: "SPK", color: "#2f9e57", shape: "round", w: 15, h: 15 },
    { key: "power", label: "Power", short: "Power", abbr: "PWR", color: "#d23b3b", shape: "rect", w: 15, h: 11 },
    { key: "ethernet", label: "Ethernet / etherCON", short: "Ethernet", abbr: "NET", color: "#8a5cf0", shape: "rect", w: 13, h: 12 },
    { key: "midi", label: "MIDI", short: "MIDI", abbr: "MIDI", color: "#1aa6a6", shape: "round", w: 14, h: 14 },
    { key: "usb", label: "USB", short: "USB", abbr: "USB", color: "#6b7280", shape: "rect", w: 13, h: 7 },
    { key: "bnc", label: "BNC", short: "BNC", abbr: "BNC", color: "#c2a01e", shape: "round", w: 9, h: 9 },
    { key: "other", label: "Other", short: "Other", abbr: "PORT", color: "#8a8f98", shape: "rect", w: 11, h: 9 },
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
  function editor(initialPorts, onChange) {
    // work on a live ports array so per-port names + sides survive edits
    var ports = (initialPorts || []).map(function (p) {
      p = p || {};
      return {
        id: typeof p.id === "string" && p.id ? p.id : puid(),
        type: byKey[p.type] ? p.type : "other",
        dir: p.dir === "in" || p.dir === "out" ? p.dir : "out",
        side: p.side === "front" ? "front" : "rear",
        label: typeof p.label === "string" ? p.label : "",
      };
    });

    var wrap = ce("div", "ports-editor");
    function emit() {
      if (onChange) onChange(ports.map(function (p) {
        return { id: p.id, type: p.type, dir: p.dir, side: p.side, label: p.label };
      }));
    }
    function countOf(t, d) {
      return ports.filter(function (p) { return p.type === t && p.dir === d; }).length;
    }
    function addPort(t, d) {
      var n = countOf(t, d) + 1;
      ports.push({ id: puid(), type: t, dir: d, side: "rear", label: def(t).abbr + " " + (d === "in" ? "In" : "Out") + " " + n });
    }
    function removeLast(t, d) {
      for (var i = ports.length - 1; i >= 0; i--) {
        if (ports[i].type === t && ports[i].dir === d) { ports.splice(i, 1); return; }
      }
    }

    function rerender() {
      wrap.innerHTML = "";

      // ── add section: per-type In/Out steppers ──
      var head = ce("div", "ports-row ports-head");
      head.appendChild(ce("span", "ports-row-label", "Add connectors"));
      head.appendChild(ce("span", "ports-col-h", "In"));
      head.appendChild(ce("span", "ports-col-h", "Out"));
      wrap.appendChild(head);
      TYPES.forEach(function (t) {
        var row = ce("div", "ports-row");
        var lab = ce("span", "ports-row-label");
        var dot = ce("span", "ports-dot");
        dot.style.background = t.color;
        lab.appendChild(dot);
        lab.appendChild(document.createTextNode(t.short || t.label));
        lab.title = t.label;
        row.appendChild(lab);
        row.appendChild(stepper(t.key, "in"));
        row.appendChild(stepper(t.key, "out"));
        wrap.appendChild(row);
      });

      // ── per-port list: name + front/rear + remove ──
      if (ports.length) {
        wrap.appendChild(ce("div", "ports-list-h", "Each port — name & location"));
        ports.forEach(function (p) {
          var row = ce("div", "ports-prow");
          var dot = ce("span", "ports-dot");
          dot.style.background = def(p.type).color;
          dot.title = def(p.type).label + (p.dir === "in" ? " · In" : " · Out");
          row.appendChild(dot);

          var inp = document.createElement("input");
          inp.type = "text";
          inp.className = "ports-name";
          inp.value = p.label;
          inp.placeholder = def(p.type).abbr + (p.dir === "in" ? " In" : " Out");
          inp.addEventListener("change", function () {
            p.label = inp.value;
            emit();
          });
          row.appendChild(inp);

          var seg = ce("div", "ports-side");
          var f = sideBtn("F", p.side === "front", "Front");
          var r = sideBtn("R", p.side !== "front", "Rear");
          f.addEventListener("click", function () { p.side = "front"; emit(); rerender(); });
          r.addEventListener("click", function () { p.side = "rear"; emit(); rerender(); });
          seg.appendChild(f);
          seg.appendChild(r);
          row.appendChild(seg);

          var x = ce("button", "ports-x", "×");
          x.type = "button";
          x.title = "Remove this port";
          x.addEventListener("click", function () {
            ports = ports.filter(function (q) { return q.id !== p.id; });
            emit();
            rerender();
          });
          row.appendChild(x);
          wrap.appendChild(row);
        });
      }
    }

    function stepper(key, dir) {
      var s = ce("div", "ports-stepper");
      var minus = stepBtn("−");
      var val = ce("span", "ports-val", String(countOf(key, dir)));
      var plus = stepBtn("+");
      minus.addEventListener("click", function () {
        if (countOf(key, dir) > 0) { removeLast(key, dir); emit(); rerender(); }
      });
      plus.addEventListener("click", function () {
        addPort(key, dir); emit(); rerender();
      });
      s.appendChild(minus);
      s.appendChild(val);
      s.appendChild(plus);
      return s;
    }
    function sideBtn(text, active, title) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ports-side-btn" + (active ? " active" : "");
      b.textContent = text;
      b.title = title;
      return b;
    }

    rerender();
    return wrap;
  }
  function puid() {
    return "port-" + Math.random().toString(36).slice(2, 8);
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
