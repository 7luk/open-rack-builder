/* library.js — built-in device database + left library panel rendering.
 *
 * Schema for every device template: { cat, name, brand, u, color }.
 * Built-in devices live in BUILTIN; user devices live in State.customLibrary.
 * The two are merged at render time. Faceplate colors lean dark, matching
 * real gear; the props panel swatches stay in the same family.
 */
window.Library = (function () {
  "use strict";

  var CATEGORIES = [
    "Mixers",
    "Amplifiers",
    "Processing",
    "Playback",
    "Power",
    "Patch & IO",
  ];

  // `depth` is the chassis depth in mm (front rail → rear-most point),
  // used by the side / x-ray view. Values are approximate real-world specs.
  var BUILTIN = [
    // Mixers
    { cat: "Mixers", name: "X32 Rack", brand: "Behringer", u: 3, color: "#23262b", depth: 330, face: { id: "x32rack" } },
    { cat: "Mixers", name: "M32R Live", brand: "Midas", u: 3, color: "#1c1f24", depth: 330, face: { id: "m32r" } },
    { cat: "Mixers", name: "TF-Rack", brand: "Yamaha", u: 3, color: "#2a2d33", depth: 290, face: { id: "tfrack" } },
    { cat: "Mixers", name: "Qu-Pac", brand: "Allen & Heath", u: 3, color: "#26282c", depth: 235, face: { id: "qupac" } },
    { cat: "Mixers", name: "StudioLive 32R", brand: "PreSonus", u: 3, color: "#1f2227", depth: 330, face: { id: "sl32r" } },

    // Amplifiers
    { cat: "Amplifiers", name: "XLi 2500", brand: "Crown", u: 2, color: "#1a1a1d", depth: 375, face: { id: "xli2500" } },
    { cat: "Amplifiers", name: "PLD4.5", brand: "QSC", u: 2, color: "#202327", depth: 420, face: { id: "pld45" } },
    { cat: "Amplifiers", name: "FP10000Q", brand: "Lab Gruppen", u: 2, color: "#26201c", depth: 444, face: { id: "fp10000q" } },
    { cat: "Amplifiers", name: "K10", brand: "Powersoft", u: 1, color: "#1d2024", depth: 400, face: { id: "k10" } },
    { cat: "Amplifiers", name: "DCi 4|600", brand: "Crown", u: 2, color: "#1a1a1d", depth: 410, face: { id: "dci4600" } },

    // Processing
    { cat: "Processing", name: "266xs", brand: "dbx", u: 1, color: "#23252a", depth: 150, face: { id: "dbx266" } },
    { cat: "Processing", name: "BLU-100", brand: "BSS", u: 1, color: "#1e2a33", depth: 285, face: { id: "blu100" } },
    { cat: "Processing", name: "DN360", brand: "Klark Teknik", u: 2, color: "#2a2620", depth: 150, face: { id: "dn360" } },
    { cat: "Processing", name: "PCM96", brand: "Lexicon", u: 1, color: "#202024", depth: 360, face: { id: "pcm96" } },
    { cat: "Processing", name: "M3000", brand: "TC Electronic", u: 1, color: "#1f2429", depth: 220, face: { id: "m3000" } },
    { cat: "Processing", name: "DEQ2496", brand: "Behringer", u: 1, color: "#23262b", depth: 220, face: { id: "deq2496" } },

    // Playback
    { cat: "Playback", name: "DN-500BD", brand: "Denon", u: 1, color: "#1c1c1f", depth: 280, face: { id: "dn500bd" } },
    { cat: "Playback", name: "CD-400U", brand: "Tascam", u: 1, color: "#212429", depth: 280, face: { id: "cd400u" } },
    { cat: "Playback", name: "DN-700C", brand: "Denon", u: 1, color: "#1c1c1f", depth: 270, face: { id: "dn700c" } },

    // Power
    { cat: "Power", name: "PL-8C", brand: "Furman", u: 1, color: "#2b2b2e", depth: 165, face: { id: "pl8c" } },
    { cat: "Power", name: "PL-PRO C", brand: "Furman", u: 1, color: "#2b2b2e", depth: 250, face: { id: "plproc" } },
    { cat: "Power", name: "PowerLight", brand: "ART", u: 1, color: "#26282c", depth: 200, face: { id: "powerlight" } },

    // Patch & IO
    { cat: "Patch & IO", name: "DL16 Stagebox", brand: "Midas", u: 3, color: "#1c1f24", depth: 95, face: { id: "dl16" } },
    { cat: "Patch & IO", name: "S16", brand: "Behringer", u: 3, color: "#23262b", depth: 90, face: { id: "s16" } },
    { cat: "Patch & IO", name: "TT Patchbay", brand: "Neutrik", u: 1, color: "#2d2d30", depth: 60, face: { id: "ttpatch" } },
    { cat: "Patch & IO", name: "Medusa Panel", brand: "Whirlwind", u: 1, color: "#28282b", depth: 55, face: { id: "medusa" } },
  ];

  // community devices, loaded from community-devices.json at startup
  var community = [];
  function setCommunity(list) {
    community = (Array.isArray(list) ? list : []).map(function (d) {
      return {
        cat: d.cat || "Community",
        name: d.name || "Device",
        brand: d.brand || "",
        u: Math.max(1, Math.min(12, parseInt(d.u, 10) || 1)),
        color: d.color || "#2a2a2e",
        depth: Math.max(20, Math.min(2000, parseInt(d.depth, 10) || 250)),
        face: d.face || { id: "blank" },
        community: true,
      };
    });
  }

  /* merge built-in + community + custom */
  function all() {
    return BUILTIN.concat(community, State.get().customLibrary);
  }

  /* group merged list by category, honouring a search filter */
  function grouped(query) {
    var q = (query || "").trim().toLowerCase();
    var match = function (d) {
      if (!q) return true;
      return (
        d.name.toLowerCase().indexOf(q) >= 0 ||
        (d.brand || "").toLowerCase().indexOf(q) >= 0 ||
        d.cat.toLowerCase().indexOf(q) >= 0
      );
    };
    var groups = {};
    all().forEach(function (d) {
      if (!match(d)) return;
      (groups[d.cat] = groups[d.cat] || []).push(d);
    });
    return groups;
  }

  /* render the list into `container`; `query` is the current search text */
  function render(container, query) {
    var groups = grouped(query);
    container.innerHTML = "";

    // keep custom categories that aren't in the canonical order
    var cats = CATEGORIES.slice();
    Object.keys(groups).forEach(function (c) {
      if (cats.indexOf(c) < 0) cats.push(c);
    });

    var any = false;
    cats.forEach(function (cat) {
      var items = groups[cat];
      if (!items || !items.length) return;
      any = true;

      var head = document.createElement("div");
      head.className = "lib-category";
      head.textContent = cat;
      container.appendChild(head);

      items.forEach(function (d) {
        container.appendChild(itemEl(d));
      });
    });

    if (!any) {
      var empty = document.createElement("div");
      empty.className = "lib-empty";
      empty.textContent = "No devices match your search.";
      container.appendChild(empty);
    }
  }

  function itemEl(d) {
    var el = document.createElement("div");
    el.className = "lib-item" + (d.custom || d.community ? " custom" : "");
    el.draggable = true;

    // payload used by the rack drop handler
    el.dataset.name = d.name;
    el.dataset.brand = d.brand || "";
    el.dataset.u = d.u;
    el.dataset.color = d.color;
    el.dataset.depth = d.depth || 250;
    el.dataset.face = JSON.stringify(d.face || { id: "blank" });

    var swatch = document.createElement("div");
    swatch.className = "lib-swatch";
    swatch.style.background = d.color;

    var meta = document.createElement("div");
    meta.className = "lib-meta";
    var name = document.createElement("div");
    name.className = "lib-name";
    name.textContent = d.name;
    var brand = document.createElement("div");
    brand.className = "lib-brand";
    brand.textContent = d.brand || "Custom";
    meta.appendChild(name);
    meta.appendChild(brand);

    var badge = document.createElement("div");
    badge.className = "u-badge";
    badge.textContent = d.u + "U";

    el.appendChild(swatch);
    el.appendChild(meta);
    el.appendChild(badge);
    return el;
  }

  function defFromEl(el) {
    var face;
    try {
      face = JSON.parse(el.dataset.face || "{}");
    } catch (e) {
      face = { id: "blank" };
    }
    return {
      name: el.dataset.name,
      brand: el.dataset.brand,
      u: parseInt(el.dataset.u, 10),
      color: el.dataset.color,
      depth: parseInt(el.dataset.depth, 10) || 250,
      face: face,
    };
  }

  return {
    CATEGORIES: CATEGORIES,
    BUILTIN: BUILTIN,
    all: all,
    render: render,
    defFromEl: defFromEl,
    setCommunity: setCommunity,
  };
})();
