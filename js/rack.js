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
  var panX = 0; // canvas pan offset, screen px
  var panY = 0;
  var MIN_ZOOM = 0.4;
  var MAX_ZOOM = 3;

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
    var isTopo = s.view === "topology";
    // the canvas wears a blueprint backdrop only in topology mode
    if (canvas) canvas.classList.toggle("topology", isTopo);

    mount.innerHTML = "";
    var unit = document.createElement("div");
    unit.className = "rack-unit";
    if (isTopo) {
      unit.appendChild(buildTopology(s));
    } else if (s.view === "side") {
      unit.appendChild(buildSide(s));
    } else {
      unit.appendChild(buildRackPlate(s));
    }
    // wheels belong to the physical elevations, not the topology diagram
    if (s.rack.wheels && !isTopo) {
      var isSide = s.view === "side";
      unit.appendChild(buildWheels(isSide, isSide ? sidePlatePx(s) : PLATE_PX));
    }
    mount.appendChild(unit);
    applyTransform();
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

    // four corner rivets — small chassis detail
    ["tl", "tr", "bl", "br"].forEach(function (pos) {
      var rivet = document.createElement("div");
      rivet.className = "rivet rivet-" + pos;
      plate.appendChild(rivet);
    });

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

  /* ---------- front faceplate: framed image or generic placeholder ---------- */
  function buildDeviceFront(d, s) {
    return buildDeviceFace(d, s, "front");
  }

  /* ---------- rear view: framed image or rear-port placeholder ---------- */
  function buildDeviceRear(d, s) {
    return buildDeviceFace(d, s, "rear");
  }

  function buildDeviceFace(d, s, side) {
    var el = deviceShell(d, s);
    el.classList.add("face");
    var simple = !!s.rack.simpleMode;
    if (!simple && Faceplates.hasImage(d, side)) {
      el.classList.add("has-image");
    } else {
      // placeholder reads on the device colour
      el.style.background = d.color;
      el.style.color = textOn(d.color);
    }
    el.appendChild(Faceplates.render(d, side, simple)); // listeners live on el
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

  var PLATE_PX = 560; // keep in sync with .rack-plate width

  /* ---------- side / x-ray view ---------- */
  function clampN(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }
  // depth cavity width: ~0.5 px/mm, clamped so shallow & deep racks both read
  function sideDepthAreaPx(s) {
    return clampN(Math.round(s.rack.depth * 0.5), 150, 620);
  }
  // full side-plate width = cavity + front rail (26) + plate padding (12·2)
  function sidePlatePx(s) {
    return sideDepthAreaPx(s) + 50;
  }

  function buildSide(s) {
    var depthMm = s.rack.depth;
    var areaPx = sideDepthAreaPx(s);
    var pxPerMm = areaPx / depthMm;
    var height = s.rack.size * U_PX;

    var profile = document.createElement("div");
    profile.className = "side-profile";

    // the rack box, same plate language as front/rear but seen edge-on
    var rack = document.createElement("div");
    rack.className = "side-rack";
    rack.style.gridTemplateColumns = "26px " + areaPx + "px";

    // depth ruler printed onto the top frame lip (inside the plate padding,
    // so it adds no height) — "front" over the rail, "rear" over the back wall.
    // This keeps the side view's footprint identical to front/rear: the rack
    // box alone is centred, never the rack + a caption above it.
    var ruler = document.createElement("div");
    ruler.className = "side-ruler";
    ruler.innerHTML =
      "<span>front</span><span class='side-depth-mm'>" +
      depthMm +
      " mm</span><span>rear</span>";
    rack.appendChild(ruler);

    // front mounting rail (reuse the front-view rail: screws + U numbers)
    rack.appendChild(buildRail(s, "right"));

    // interior cavity, viewed through the x-rayed near wall
    var cavity = document.createElement("div");
    cavity.className = "side-cavity";
    cavity.style.height = height + "px";
    // blueprint grid: U rows (horizontal) + 100 mm depth marks (vertical)
    var gridPx = Math.max(12, Math.round(100 * pxPerMm));
    cavity.style.backgroundImage =
      "repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px " +
      U_PX +
      "px)," +
      "repeating-linear-gradient(to right, rgba(127,127,127,0.16) 0 1px, transparent 1px " +
      gridPx +
      "px)";

    // each device as a chassis receding from the front rail into the rack
    s.devices.forEach(function (d) {
      var devDepth = d.depth || 250;
      var wPx = clampN(Math.round(devDepth * pxPerMm), 14, areaPx);
      var box = document.createElement("div");
      box.className = "side-dev" + (d.id === s.selectedId ? " selected" : "");
      if (devDepth > depthMm) box.classList.add("too-deep");
      box.style.top = (d.slot - 1) * U_PX + "px";
      box.style.height = d.u * U_PX - 2 + "px";
      box.style.width = wPx + "px";
      box.style.background = d.color;
      box.style.color = textOn(d.color);
      box.dataset.id = d.id;
      box.title =
        d.name + (d.brand ? " · " + d.brand : "") + " — " + devDepth + " mm deep";

      if (wPx > 58) {
        var lbl = document.createElement("div");
        lbl.className = "side-label";
        lbl.textContent = d.name;
        box.appendChild(lbl);
      }
      if (wPx > 42) {
        var dep = document.createElement("div");
        dep.className = "side-dep";
        dep.textContent = devDepth + " mm";
        box.appendChild(dep);
      }

      box.addEventListener("click", function (e) {
        e.stopPropagation();
        State.select(d.id);
      });
      cavity.appendChild(box);
    });

    // the see-through near wall: a faint glass sheen over the cavity
    var glass = document.createElement("div");
    glass.className = "side-glass";
    cavity.appendChild(glass);

    rack.appendChild(cavity);
    profile.appendChild(rack);
    return profile;
  }

  /* ---------- topology / signal view ----------
     A generic, blueprint-style node per device showing its ports as pins.
     Pins carry data-dev / data-port / data-side so a future cable layer can
     anchor connections to them. No cables are drawn yet. */
  function topoPorts(d) {
    var raw = (d.rearLabel || "")
      .split(",")
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
    if (raw.length) return { list: raw, generic: false };
    return { list: genericPorts(d), generic: true };
  }
  function genericPorts(d) {
    var u = d.u || 1;
    if (u >= 3) return ["In 1", "In 2", "In 3", "Out 1", "Out 2", "Out 3"];
    if (u === 2) return ["In 1", "In 2", "Out 1", "Out 2"];
    return ["In", "Out"];
  }

  function buildTopology(s) {
    var wrap = document.createElement("div");
    wrap.className = "topo";

    if (!s.devices.length) {
      var empty = document.createElement("div");
      empty.className = "topo-empty";
      empty.textContent = "Add devices to map their signal topology.";
      wrap.appendChild(empty);
      return wrap;
    }

    // reading order, top of the rack first
    s.devices
      .slice()
      .sort(function (a, b) { return a.slot - b.slot; })
      .forEach(function (d) {
        wrap.appendChild(buildTopoNode(d, s));
      });
    return wrap;
  }

  function buildTopoNode(d, s) {
    var node = document.createElement("div");
    node.className = "topo-node" + (s.selectedId === d.id ? " selected" : "");
    node.dataset.id = d.id;
    node.addEventListener("click", function (e) {
      e.stopPropagation();
      State.select(d.id);
    });

    var head = document.createElement("div");
    head.className = "topo-head";
    var nm = document.createElement("span");
    nm.className = "topo-name";
    nm.textContent = d.name;
    head.appendChild(nm);
    if (d.brand) {
      var br = document.createElement("span");
      br.className = "topo-brand";
      br.textContent = d.brand;
      head.appendChild(br);
    }
    node.appendChild(head);

    var ports = topoPorts(d);
    var list = document.createElement("div");
    list.className = "topo-ports" + (ports.generic ? " generic" : "");
    ports.list.forEach(function (label, i) {
      var row = document.createElement("div");
      row.className = "topo-port";
      row.appendChild(pin(d.id, i, "l"));
      var lbl = document.createElement("span");
      lbl.className = "topo-port-label";
      lbl.textContent = label;
      row.appendChild(lbl);
      row.appendChild(pin(d.id, i, "r"));
      list.appendChild(row);
    });
    node.appendChild(list);
    return node;
  }

  // a single connection pin; the cable layer (later) will anchor to these
  function pin(devId, portIndex, side) {
    var p = document.createElement("span");
    p.className = "topo-pin topo-pin-" + side;
    p.dataset.dev = devId;
    p.dataset.port = portIndex;
    p.dataset.side = side;
    return p;
  }

  /* ---------- wheels / casters (minimalist) ---------- */
  function buildWheels(isSide, widthPx) {
    var el = document.createElement("div");
    el.className = "rack-wheels" + (isSide ? " side" : "");
    el.style.width = widthPx + "px";
    // 4 casters total, one per corner — any 2D view sees exactly 2 of them
    var n = 2;
    for (var i = 0; i < n; i++) {
      var c = document.createElement("div");
      c.className = "caster";
      var fork = document.createElement("div");
      fork.className = "caster-fork";
      var wheel = document.createElement("div");
      wheel.className = "caster-wheel";
      c.appendChild(fork);
      c.appendChild(wheel);
      el.appendChild(c);
    }
    return el;
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

  /* ---------- zoom + pan (local UI state) ---------- */
  function bindCanvas() {
    // wheel zooms toward the cursor, so zooming in heads where you're pointing
    canvas.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var rect = canvas.getBoundingClientRect();
        var cx = e.clientX - rect.left - rect.width / 2;
        var cy = e.clientY - rect.top - rect.height / 2;
        var old = zoom;
        var next = clampZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        var ratio = next / old;
        // keep the point under the cursor fixed while scaling about centre
        panX += (cx - panX) * (1 - ratio);
        panY += (cy - panY) * (1 - ratio);
        zoom = next;
        applyTransform();
      },
      { passive: false }
    );

    // drag empty canvas / plate to pan; a click without movement deselects
    canvas.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (e.target.closest(".device")) return; // devices handle their own drag
      var startX = e.clientX, startY = e.clientY;
      var baseX = panX, baseY = panY;
      var moved = false;

      function move(ev) {
        var dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
          moved = true;
          canvas.classList.add("panning");
        }
        if (moved) {
          panX = baseX + dx;
          panY = baseY + dy;
          applyTransform();
        }
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        canvas.classList.remove("panning");
        if (!moved) State.select(null); // it was a click on empty space
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  function clampZoom(z) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }
  function setZoom(z) {
    zoom = clampZoom(z);
    applyTransform();
  }
  function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  }
  function applyTransform() {
    stage.style.transform =
      "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")";
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
