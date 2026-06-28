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

  var BUILTIN = [
    // Mixers
    { cat: "Mixers", name: "X32 Rack", brand: "Behringer", u: 3, color: "#23262b" },
    { cat: "Mixers", name: "M32R Live", brand: "Midas", u: 3, color: "#1c1f24" },
    { cat: "Mixers", name: "TF-Rack", brand: "Yamaha", u: 3, color: "#2a2d33" },
    { cat: "Mixers", name: "Qu-Pac", brand: "Allen & Heath", u: 3, color: "#26282c" },
    { cat: "Mixers", name: "StudioLive 32R", brand: "PreSonus", u: 3, color: "#1f2227" },

    // Amplifiers
    { cat: "Amplifiers", name: "XLi 2500", brand: "Crown", u: 2, color: "#1a1a1d" },
    { cat: "Amplifiers", name: "PLD4.5", brand: "QSC", u: 2, color: "#202327" },
    { cat: "Amplifiers", name: "FP10000Q", brand: "Lab Gruppen", u: 2, color: "#26201c" },
    { cat: "Amplifiers", name: "K10", brand: "Powersoft", u: 1, color: "#1d2024" },
    { cat: "Amplifiers", name: "DCi 4|600", brand: "Crown", u: 2, color: "#1a1a1d" },

    // Processing
    { cat: "Processing", name: "266xs", brand: "dbx", u: 1, color: "#23252a" },
    { cat: "Processing", name: "BLU-100", brand: "BSS", u: 1, color: "#1e2a33" },
    { cat: "Processing", name: "DN360", brand: "Klark Teknik", u: 2, color: "#2a2620" },
    { cat: "Processing", name: "PCM96", brand: "Lexicon", u: 1, color: "#202024" },
    { cat: "Processing", name: "M3000", brand: "TC Electronic", u: 1, color: "#1f2429" },
    { cat: "Processing", name: "DEQ2496", brand: "Behringer", u: 1, color: "#23262b" },

    // Playback
    { cat: "Playback", name: "DN-500BD", brand: "Denon", u: 1, color: "#1c1c1f" },
    { cat: "Playback", name: "CD-400U", brand: "Tascam", u: 1, color: "#212429" },
    { cat: "Playback", name: "DN-700C", brand: "Denon", u: 1, color: "#1c1c1f" },

    // Power
    { cat: "Power", name: "PL-8C", brand: "Furman", u: 1, color: "#2b2b2e" },
    { cat: "Power", name: "PL-PRO C", brand: "Furman", u: 1, color: "#2b2b2e" },
    { cat: "Power", name: "PowerLight", brand: "ART", u: 1, color: "#26282c" },

    // Patch & IO
    { cat: "Patch & IO", name: "DL16 Stagebox", brand: "Midas", u: 3, color: "#1c1f24" },
    { cat: "Patch & IO", name: "S16", brand: "Behringer", u: 3, color: "#23262b" },
    { cat: "Patch & IO", name: "TT Patchbay", brand: "Neutrik", u: 1, color: "#2d2d30" },
    { cat: "Patch & IO", name: "Medusa Panel", brand: "Whirlwind", u: 1, color: "#28282b" },
  ];

  /* merge built-in + custom */
  function all() {
    return BUILTIN.concat(State.get().customLibrary);
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
    el.className = "lib-item" + (d.custom ? " custom" : "");
    el.draggable = true;

    // payload used by the rack drop handler
    el.dataset.name = d.name;
    el.dataset.brand = d.brand || "";
    el.dataset.u = d.u;
    el.dataset.color = d.color;

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
    return {
      name: el.dataset.name,
      brand: el.dataset.brand,
      u: parseInt(el.dataset.u, 10),
      color: el.dataset.color,
    };
  }

  return {
    CATEGORIES: CATEGORIES,
    BUILTIN: BUILTIN,
    all: all,
    render: render,
    defFromEl: defFromEl,
  };
})();
