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
    { cat: "Mixers", name: "X32 Rack", brand: "Behringer", u: 3, color: "#23262b", depth: 330 },
    { cat: "Mixers", name: "M32R Live", brand: "Midas", u: 3, color: "#1c1f24", depth: 330 },
    { cat: "Mixers", name: "TF-Rack", brand: "Yamaha", u: 3, color: "#2a2d33", depth: 290 },
    { cat: "Mixers", name: "Qu-Pac", brand: "Allen & Heath", u: 3, color: "#26282c", depth: 235 },
    { cat: "Mixers", name: "StudioLive 32R", brand: "PreSonus", u: 3, color: "#1f2227", depth: 330 },

    // Amplifiers
    { cat: "Amplifiers", name: "XLi 2500", brand: "Crown", u: 2, color: "#1a1a1d", depth: 375 },
    { cat: "Amplifiers", name: "PLD4.5", brand: "QSC", u: 2, color: "#202327", depth: 420 },
    { cat: "Amplifiers", name: "FP10000Q", brand: "Lab Gruppen", u: 2, color: "#26201c", depth: 444 },
    { cat: "Amplifiers", name: "K10", brand: "Powersoft", u: 1, color: "#1d2024", depth: 400 },
    { cat: "Amplifiers", name: "DCi 4|600", brand: "Crown", u: 2, color: "#1a1a1d", depth: 410 },

    // Processing
    { cat: "Processing", name: "266xs", brand: "dbx", u: 1, color: "#23252a", depth: 150 },
    { cat: "Processing", name: "BLU-100", brand: "BSS", u: 1, color: "#1e2a33", depth: 285 },
    { cat: "Processing", name: "DN360", brand: "Klark Teknik", u: 2, color: "#2a2620", depth: 150 },
    { cat: "Processing", name: "PCM96", brand: "Lexicon", u: 1, color: "#202024", depth: 360 },
    { cat: "Processing", name: "M3000", brand: "TC Electronic", u: 1, color: "#1f2429", depth: 220 },
    { cat: "Processing", name: "DEQ2496", brand: "Behringer", u: 1, color: "#23262b", depth: 220 },

    // Playback
    { cat: "Playback", name: "DN-500BD", brand: "Denon", u: 1, color: "#1c1c1f", depth: 280 },
    { cat: "Playback", name: "CD-400U", brand: "Tascam", u: 1, color: "#212429", depth: 280 },
    { cat: "Playback", name: "DN-700C", brand: "Denon", u: 1, color: "#1c1c1f", depth: 270 },

    // Power
    { cat: "Power", name: "PL-8C", brand: "Furman", u: 1, color: "#2b2b2e", depth: 165 },
    { cat: "Power", name: "PL-PRO C", brand: "Furman", u: 1, color: "#2b2b2e", depth: 250 },
    { cat: "Power", name: "PowerLight", brand: "ART", u: 1, color: "#26282c", depth: 200 },

    // Patch & IO
    { cat: "Patch & IO", name: "DL16 Stagebox", brand: "Midas", u: 3, color: "#1c1f24", depth: 95 },
    { cat: "Patch & IO", name: "S16", brand: "Behringer", u: 3, color: "#23262b", depth: 90 },
    { cat: "Patch & IO", name: "TT Patchbay", brand: "Neutrik", u: 1, color: "#2d2d30", depth: 60 },
    { cat: "Patch & IO", name: "Medusa Panel", brand: "Whirlwind", u: 1, color: "#28282b", depth: 55 },
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
        rearLabel: d.rearLabel || "",
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

  // per-category collapsed state (transient UI; keyed by category name)
  var collapsed = {};

  /* render the list into `container`; `query` is the current search text */
  function render(container, query) {
    var q = (query || "").trim();
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

      // an active search forces every matching category open
      var isCollapsed = !q && !!collapsed[cat];

      var head = document.createElement("button");
      head.type = "button";
      head.className = "lib-category" + (isCollapsed ? " collapsed" : "");
      var caret = document.createElement("span");
      caret.className = "lib-cat-caret";
      caret.textContent = "▾";
      var label = document.createElement("span");
      label.className = "lib-cat-label";
      label.textContent = cat;
      var count = document.createElement("span");
      count.className = "lib-cat-count";
      count.textContent = items.length;
      head.appendChild(caret);
      head.appendChild(label);
      head.appendChild(count);
      head.addEventListener("click", function () {
        collapsed[cat] = !collapsed[cat];
        render(container, query);
      });
      container.appendChild(head);

      var group = document.createElement("div");
      group.className = "lib-group" + (isCollapsed ? " collapsed" : "");
      items.forEach(function (d) {
        group.appendChild(itemEl(d));
      });
      container.appendChild(group);
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

    // payload used by the rack drop handler
    el.dataset.name = d.name;
    el.dataset.brand = d.brand || "";
    el.dataset.u = d.u;
    el.dataset.color = d.color;
    el.dataset.depth = d.depth || 250;
    el.dataset.rearLabel = d.rearLabel || "";
    el.dataset.ports = JSON.stringify(d.ports || []);

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

    // provenance flag: dev-authored takes precedence over plain community
    var flag = flagFor(d);
    if (flag) meta.appendChild(flag);

    var badge = document.createElement("div");
    badge.className = "u-badge";
    badge.textContent = d.u + "U";

    el.appendChild(swatch);
    el.appendChild(meta);
    el.appendChild(badge);
    return el;
  }

  // a small provenance pill: "DEV" for project-dev devices, else "community"
  function flagFor(d) {
    var f = document.createElement("span");
    if (d.fromDev) {
      f.className = "lib-flag dev";
      f.textContent = "DEV";
      f.title = "Made by the Open Rack Builder developer";
      return f;
    }
    if (d.community) {
      f.className = "lib-flag community";
      f.textContent = "community";
      f.title = "From the community library";
      return f;
    }
    return null;
  }

  function defFromEl(el) {
    var ports = [];
    try {
      ports = JSON.parse(el.dataset.ports || "[]");
    } catch (e) {
      ports = [];
    }
    return {
      name: el.dataset.name,
      brand: el.dataset.brand,
      u: parseInt(el.dataset.u, 10),
      color: el.dataset.color,
      depth: parseInt(el.dataset.depth, 10) || 250,
      rearLabel: el.dataset.rearLabel || "",
      ports: ports,
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
