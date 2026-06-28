/* state.js — single source of truth.
 *
 * Holds the entire document: rack settings, placed devices, the user's
 * custom library, the current selection, and view/theme/project chrome.
 *
 * Rules:
 *  - Nothing outside this file mutates `data` directly.
 *  - Mutations go through the helpers below; each calls notify().
 *  - Render code reads via State.get(); it never writes here.
 *
 * Coordinate model:
 *  - The rack has `rack.size` physical rows, numbered 1..size from the TOP.
 *  - A placed device stores `slot` = its top-most physical row (1 = top).
 *  - The U *label* shown on the rail is derived separately from
 *    rack.startUnit + rack.direction, so display numbering is independent
 *    of physical layout. See displayNumber().
 */
window.State = (function () {
  "use strict";

  var subscribers = new Set();
  var data = defaultState();

  function defaultState() {
    return {
      projectName: "Untitled rack",
      view: "front", // front | rear | side
      theme: "light", // light | dark
      rack: {
        size: 12, // number of U rows
        startUnit: 1, // U label given to the first numbered row
        direction: "bottom-up", // bottom-up = U1 at the bottom; top-down = U1 at top
      },
      devices: [], // placed devices
      customLibrary: [], // user-defined device templates
      selectedId: null,
    };
  }

  /* ---------- subscription ---------- */
  function subscribe(fn) {
    subscribers.add(fn);
    return function () {
      subscribers.delete(fn);
    };
  }
  function notify() {
    subscribers.forEach(function (fn) {
      fn(data);
    });
  }
  function get() {
    return data;
  }

  /* ---------- ids ---------- */
  function uid() {
    return "dev-" + Math.random().toString(36).slice(2, 9);
  }

  /* ---------- chrome ---------- */
  function setProjectName(name) {
    data.projectName = (name || "").trim() || "Untitled rack";
    notify();
  }
  function setView(view) {
    if (view !== data.view) {
      data.view = view;
      notify();
    }
  }
  function setTheme(theme) {
    data.theme = theme === "dark" ? "dark" : "light";
    notify();
  }
  function toggleTheme() {
    setTheme(data.theme === "dark" ? "light" : "dark");
  }

  /* ---------- rack settings ---------- */
  function setRackSetting(key, value) {
    var r = data.rack;
    if (key === "size") {
      var n = Math.round(Number(value));
      if (!isFinite(n)) return;
      // never shrink below the lowest physical row a device occupies
      var floor = maxOccupiedRow();
      r.size = clamp(n, Math.max(1, floor), 60);
    } else if (key === "startUnit") {
      var s = Math.round(Number(value));
      if (!isFinite(s)) return;
      r.startUnit = clamp(s, 0, 9999);
    } else if (key === "direction") {
      if (value === "top-down" || value === "bottom-up") r.direction = value;
    }
    notify();
  }
  function addU(delta) {
    setRackSetting("size", data.rack.size + delta);
  }

  /* row 1..size (top → bottom) → U label shown on the rail */
  function displayNumber(row) {
    var r = data.rack;
    if (r.direction === "top-down") return r.startUnit + (row - 1);
    return r.startUnit + (data.rack.size - row);
  }

  /* ---------- placement helpers (pure-ish, read from data) ---------- */
  function maxOccupiedRow() {
    return data.devices.reduce(function (m, d) {
      return Math.max(m, d.slot + d.u - 1);
    }, 0);
  }
  function occupiedRows(ignoreId) {
    var set = new Set();
    data.devices.forEach(function (d) {
      if (d.id === ignoreId) return;
      for (var row = d.slot; row < d.slot + d.u; row++) set.add(row);
    });
    return set;
  }
  function fits(slot, u) {
    return slot >= 1 && slot + u - 1 <= data.rack.size;
  }
  function canPlace(slot, u, ignoreId) {
    if (!fits(slot, u)) return false;
    var occ = occupiedRows(ignoreId);
    for (var row = slot; row < slot + u; row++) if (occ.has(row)) return false;
    return true;
  }
  /* nearest free slot at/around `preferred`, else first free scanning down */
  function findFreeSlot(u, preferred, ignoreId) {
    var size = data.rack.size;
    var tried = [];
    if (preferred != null) {
      // expand outward from the preferred row
      for (var off = 0; off < size; off++) {
        if (preferred - off >= 1) tried.push(preferred - off);
        if (off > 0 && preferred + off <= size) tried.push(preferred + off);
      }
    }
    for (var s = 1; s + u - 1 <= size; s++) tried.push(s);
    for (var i = 0; i < tried.length; i++) {
      if (canPlace(tried[i], u, ignoreId)) return tried[i];
    }
    return null;
  }

  /* ---------- devices ---------- */
  /* def: { name, brand, u, color }  — preferredSlot optional (top row) */
  function addDevice(def, preferredSlot) {
    var u = clamp(Math.round(def.u || 1), 1, data.rack.size);
    var slot = findFreeSlot(u, preferredSlot, null);
    if (slot == null) return null; // rack full / won't fit
    var d = {
      id: uid(),
      name: def.name || "Device",
      brand: def.brand || "",
      u: u,
      color: def.color || "#2a2a2e",
      slot: slot,
      led: true,
      rearLabel: "",
    };
    data.devices.push(d);
    data.selectedId = d.id;
    notify();
    return d.id;
  }
  function removeDevice(id) {
    var before = data.devices.length;
    data.devices = data.devices.filter(function (d) {
      return d.id !== id;
    });
    if (data.selectedId === id) data.selectedId = null;
    if (data.devices.length !== before) notify();
  }
  function updateDevice(id, patch) {
    var d = byId(id);
    if (!d) return;
    Object.keys(patch).forEach(function (k) {
      d[k] = patch[k];
    });
    notify();
  }
  /* move a device to a new top row if it fits */
  function moveDevice(id, slot) {
    var d = byId(id);
    if (!d) return false;
    if (!canPlace(slot, d.u, id)) return false;
    d.slot = slot;
    notify();
    return true;
  }
  function nudge(id, delta) {
    var d = byId(id);
    if (!d) return;
    moveDevice(id, d.slot + delta);
  }
  function clearRack() {
    data.devices = [];
    data.selectedId = null;
    notify();
  }

  /* ---------- selection ---------- */
  function select(id) {
    data.selectedId = id;
    notify();
  }
  function getSelected() {
    return byId(data.selectedId);
  }
  function byId(id) {
    return (
      data.devices.find(function (d) {
        return d.id === id;
      }) || null
    );
  }

  /* ---------- custom library ---------- */
  function addCustomDevice(def) {
    data.customLibrary.push({
      cat: def.cat || "Custom",
      name: def.name || "Custom device",
      brand: def.brand || "",
      u: clamp(Math.round(def.u || 1), 1, 60),
      color: def.color || "#2a2a2e",
      custom: true,
    });
    notify();
  }

  /* ---------- whole-document replace (load / new) ---------- */
  function replace(next) {
    data = normalize(next);
    notify();
  }
  function reset() {
    data = defaultState();
    notify();
  }
  /* defensive: fill in any missing fields on an imported document */
  function normalize(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    var out = {
      projectName: raw.projectName || base.projectName,
      view: ["front", "rear", "side"].indexOf(raw.view) >= 0 ? raw.view : "front",
      theme: raw.theme === "dark" ? "dark" : "light",
      rack: {
        size: clamp(Math.round(Number(raw.rack && raw.rack.size) || 12), 1, 60),
        startUnit: clamp(Math.round(Number(raw.rack && raw.rack.startUnit) || 1), 0, 9999),
        direction:
          raw.rack && raw.rack.direction === "top-down" ? "top-down" : "bottom-up",
      },
      devices: Array.isArray(raw.devices)
        ? raw.devices.map(function (d) {
            return {
              id: d.id || uid(),
              name: d.name || "Device",
              brand: d.brand || "",
              u: clamp(Math.round(Number(d.u) || 1), 1, 60),
              color: d.color || "#2a2a2e",
              slot: clamp(Math.round(Number(d.slot) || 1), 1, 60),
              led: d.led !== false,
              rearLabel: d.rearLabel || "",
            };
          })
        : [],
      customLibrary: Array.isArray(raw.customLibrary)
        ? raw.customLibrary.map(function (c) {
            return {
              cat: c.cat || "Custom",
              name: c.name || "Custom device",
              brand: c.brand || "",
              u: clamp(Math.round(Number(c.u) || 1), 1, 60),
              color: c.color || "#2a2a2e",
              custom: true,
            };
          })
        : [],
      selectedId: null,
    };
    return out;
  }

  /* ---------- small util ---------- */
  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  return {
    // read
    get: get,
    subscribe: subscribe,
    getSelected: getSelected,
    byId: byId,
    displayNumber: displayNumber,
    canPlace: canPlace,
    findFreeSlot: findFreeSlot,
    occupiedRows: occupiedRows,
    maxOccupiedRow: maxOccupiedRow,
    // chrome
    setProjectName: setProjectName,
    setView: setView,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    // rack
    setRackSetting: setRackSetting,
    addU: addU,
    // devices
    addDevice: addDevice,
    removeDevice: removeDevice,
    updateDevice: updateDevice,
    moveDevice: moveDevice,
    nudge: nudge,
    clearRack: clearRack,
    // selection
    select: select,
    // custom library
    addCustomDevice: addCustomDevice,
    // document
    replace: replace,
    reset: reset,
    notify: notify,
  };
})();
