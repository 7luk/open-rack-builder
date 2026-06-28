/* rack.js — rack frame builder + device renderer.
 *
 * Pure render: every function reads from State.get() and produces DOM.
 * It never reads layout values back out of the DOM to make decisions.
 * Three view renderers (front / rear / side) draw the same state data.
 *
 * Zoom is local UI state (not part of the document) — wheel over the
 * canvas scales the stage; it is not persisted.
 */
window.Rack = (function () {
  "use strict";

  var U_PX = 44; // keep in sync with --u-height
  var mount; // .rack-mount
  var stage; // .canvas-stage
  var canvas; // .canvas
  var zoomReadout;
  var zoom = 1;
  var MIN_ZOOM = 0.5;
  var MAX_ZOOM = 2;

  function init(refs) {
    mount = refs.mount;
    stage = refs.stage;
    canvas = refs.canvas;
    zoomReadout = refs.zoomReadout;
    bindCanvas();
  }

  /* ---------- public render entry ---------- */
  function render() {
    var s = State.get();
    mount.innerHTML = "";
    if (s.view === "side") {
      mount.appendChild(buildSide(s));
    } else {
      mount.appendChild(buildRackPlate(s));
    }
    applyZoom();
  }

  /* ---------- front / rear share the rack plate ---------- */
  function buildRackPlate(s) {
    var size = s.rack.size;
    var plate = document.createElement("div");
    plate.className = "rack-plate";

    plate.appendChild(buildRail(s, "left"));

    // center slot column
    var slots = document.createElement("div");
    slots.className = "slots";
    slots.style.height = size * U_PX + "px";

    // invisible per-U drop targets (used to compute drop row + highlight)
    for (var row = 1; row <= size; row++) {
      var slot = document.createElement("div");
      slot.className = "slot";
      slot.style.top = (row - 1) * U_PX + "px";
      slot.dataset.row = row;
      slots.appendChild(slot);
    }

    // devices as absolutely positioned overlays
    s.devices.forEach(function (d) {
      slots.appendChild(
        s.view === "rear" ? buildDeviceRear(d, s) : buildDeviceFront(d, s)
      );
    });

    plate.appendChild(slots);
    plate.appendChild(buildRail(s, "right"));
    bindDrop(slots);
    return plate;
  }

  function buildRail(s, side) {
    var rail = document.createElement("div");
    rail.className = "rail rail-" + side;
    for (var row = 1; row <= s.rack.size; row++) {
      var cell = document.createElement("div");
      cell.className = "rail-cell";

      var top = document.createElement("div");
      top.className = "screw";
      var bottom = document.createElement("div");
      bottom.className = "screw";
      cell.appendChild(top);

      // U number on the right rail only
      if (side === "right") {
        var num = document.createElement("div");
        num.className = "u-number";
        num.textContent = State.displayNumber(row);
        cell.appendChild(num);
      }

      cell.appendChild(bottom);
      rail.appendChild(cell);
    }
    return rail;
  }

  /* ---------- front faceplate ---------- */
  function buildDeviceFront(d, s) {
    var el = deviceShell(d, s);
    el.style.background = d.color;
    el.style.color = textOn(d.color);

    var led = document.createElement("div");
    led.className = "device-led" + (d.led ? " on" : "");

    var labels = document.createElement("div");
    labels.className = "device-labels";
    var name = document.createElement("div");
    name.className = "device-name";
    name.textContent = d.name;
    var brand = document.createElement("div");
    brand.className = "device-brand";
    brand.textContent = d.brand || "";
    labels.appendChild(name);
    if (d.brand) labels.appendChild(brand);

    var knobs = document.createElement("div");
    knobs.className = "device-knobs";
    var count = Math.min(4, Math.max(2, d.u + 1));
    for (var i = 0; i < count; i++) {
      var k = document.createElement("div");
      k.className = "knob";
      knobs.appendChild(k);
    }

    el.appendChild(led);
    el.appendChild(labels);
    el.appendChild(knobs);
    return el;
  }

  /* ---------- rear view ---------- */
  function buildDeviceRear(d, s) {
    var el = deviceShell(d, s);
    el.classList.add("rear");

    var name = document.createElement("div");
    name.className = "rear-name";
    name.textContent = d.name;

    var ports = document.createElement("div");
    ports.className = "rear-ports";
    if (d.rearLabel && d.rearLabel.trim()) {
      d.rearLabel
        .split(/[,\n]/)
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean)
        .slice(0, 8)
        .forEach(function (t) {
          var p = document.createElement("span");
          p.className = "rear-port";
          p.textContent = t;
          ports.appendChild(p);
        });
    } else {
      // default jacks when no labels are set
      var jacks = Math.min(6, d.u * 2);
      for (var i = 0; i < jacks; i++) {
        var j = document.createElement("span");
        j.className = "rear-jack";
        ports.appendChild(j);
      }
    }

    el.appendChild(name);
    el.appendChild(ports);
    return el;
  }

  /* shared overlay shell: position, click-to-select, drag-to-reposition */
  function deviceShell(d, s) {
    var el = document.createElement("div");
    el.className = "device" + (s.selectedId === d.id ? " selected" : "");
    el.style.top = (d.slot - 1) * U_PX + "px";
    el.style.height = d.u * U_PX - 4 + "px";
    el.dataset.id = d.id;
    el.draggable = true;

    // select on click, NOT mousedown — selecting re-renders, which would yank
    // this element out from under a drag that's just starting
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      State.select(d.id);
    });

    // drag the placed device to a new slot
    el.addEventListener("dragstart", function (e) {
      var rect = el.getBoundingClientRect();
      // which U within the device was grabbed (so it stays under the cursor)
      var grab = Math.floor((e.clientY - rect.top) / zoom / U_PX);
      grab = Math.min(d.u - 1, Math.max(0, grab));
      App.dragMove = { id: d.id, u: d.u, grab: grab };
      App.dragDef = null;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", d.id);
    });
    el.addEventListener("dragend", function () {
      App.dragMove = null;
      el.classList.remove("dragging");
    });
    return el;
  }

  /* ---------- side view ---------- */
  function buildSide(s) {
    var stack = document.createElement("div");
    stack.className = "side-stack";

    // map each physical row to the device occupying it (if any)
    var rowDevice = {};
    s.devices.forEach(function (d) {
      for (var r = d.slot; r < d.slot + d.u; r++) rowDevice[r] = d;
    });

    for (var row = 1; row <= s.rack.size; row++) {
      var d = rowDevice[row];
      var rowEl = document.createElement("div");
      rowEl.className = "side-row" + (d ? "" : " empty");
      if (d && d.id === s.selectedId) rowEl.classList.add("selected");

      var u = document.createElement("div");
      u.className = "side-u";
      u.textContent = State.displayNumber(row);

      var bar = document.createElement("div");
      bar.className = "side-bar";
      if (d) {
        bar.style.background = d.color;
        bar.style.color = textOn(d.color);
        // label only on the device's top row to avoid repetition
        bar.textContent = row === d.slot ? d.name + (d.brand ? " · " + d.brand : "") : "";
        bar.dataset.id = d.id;
        rowEl.addEventListener("mousedown", (function (id) {
          return function () {
            State.select(id);
          };
        })(d.id));
      } else {
        bar.textContent = "empty";
      }

      rowEl.appendChild(u);
      rowEl.appendChild(bar);
      stack.appendChild(rowEl);
    }
    return stack;
  }

  /* ---------- drop target: places library items AND repositions devices ---------- */
  function bindDrop(slots) {
    var lastHighlight = [];

    function clearHighlight() {
      lastHighlight.forEach(function (el) {
        el.classList.remove("drop-ok", "drop-bad");
      });
      lastHighlight = [];
    }

    function rowFromEvent(e) {
      var rect = slots.getBoundingClientRect();
      var y = (e.clientY - rect.top) / zoom;
      var row = Math.floor(y / U_PX) + 1;
      return Math.min(State.get().rack.size, Math.max(1, row));
    }

    // the active drag: a device being moved, or a library item being added
    function payload() {
      if (App.dragMove)
        return {
          move: true,
          u: App.dragMove.u,
          ignoreId: App.dragMove.id,
          grab: App.dragMove.grab,
        };
      if (App.dragDef) return { move: false, u: App.dragDef.u, ignoreId: null, grab: 0 };
      return null;
    }

    // desired top row from the cursor, offset by where the device was grabbed,
    // clamped so the body stays inside the rack
    function desiredTop(e, p) {
      var size = State.get().rack.size;
      var top = rowFromEvent(e) - p.grab;
      return Math.min(Math.max(1, top), Math.max(1, size - p.u + 1));
    }

    slots.addEventListener("dragover", function (e) {
      var p = payload();
      if (!p) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = p.move ? "move" : "copy";
      clearHighlight();
      var top = desiredTop(e, p);
      // highlight where it will actually land (snapped to nearest free)
      var snapped = State.findFreeSlot(p.u, top, p.ignoreId);
      var cells = slots.querySelectorAll(".slot");
      var start = snapped != null ? snapped : top;
      var cls = snapped != null ? "drop-ok" : "drop-bad";
      for (var r = start; r < start + p.u; r++) {
        var cell = cells[r - 1];
        if (cell) {
          cell.classList.add(cls);
          lastHighlight.push(cell);
        }
      }
    });

    slots.addEventListener("dragleave", function (e) {
      if (!slots.contains(e.relatedTarget)) clearHighlight();
    });

    slots.addEventListener("drop", function (e) {
      e.preventDefault();
      clearHighlight();
      var p = payload();
      if (!p) return;
      var top = desiredTop(e, p);
      if (p.move) {
        State.repositionDevice(p.ignoreId, top);
        App.dragMove = null;
      } else {
        State.addDevice(App.dragDef, top); // findFreeSlot falls back if taken
        App.dragDef = null;
      }
    });
  }

  /* ---------- zoom (local UI state) ---------- */
  function bindCanvas() {
    canvas.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var dir = e.deltaY < 0 ? 1 : -1;
        setZoom(zoom + dir * 0.08);
      },
      { passive: false }
    );
    // click empty canvas to deselect
    canvas.addEventListener("mousedown", function (e) {
      if (e.target === canvas || e.target === stage || e.target === mount) {
        State.select(null);
      }
    });
  }
  function setZoom(z) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    applyZoom();
  }
  function resetZoom() {
    setZoom(1);
  }
  function applyZoom() {
    stage.style.transform = "scale(" + zoom + ")";
    if (zoomReadout) zoomReadout.textContent = Math.round(zoom * 100) + "%";
  }

  /* ---------- color util: readable text on a faceplate ---------- */
  function textOn(hex) {
    var c = hex.replace("#", "");
    if (c.length === 3)
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = parseInt(c.slice(0, 2), 16) || 0;
    var g = parseInt(c.slice(2, 4), 16) || 0;
    var b = parseInt(c.slice(4, 6), 16) || 0;
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? "#1d1d1f" : "#f5f5f7";
  }

  return {
    init: init,
    render: render,
    resetZoom: resetZoom,
    setZoom: setZoom,
    textOn: textOn,
  };
})();
