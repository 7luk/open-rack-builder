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
  // each view keeps its own pan/zoom so moving the topology doesn't move the
  // 2D elevations (and vice-versa). zoom/panX/panY above hold the CURRENT view.
  var viewports = {};
  var lastView = null;
  var suppressTopoClick = false; // set right after a topo node drag
  var SVGNS = "http://www.w3.org/2000/svg";
  var topoCablesSvg = null; // the cable overlay for the current topology render
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

    // per-view viewport: stash the outgoing view's pan/zoom, load the incoming
    if (s.view !== lastView) {
      if (lastView !== null) {
        viewports[lastView] = { zoom: zoom, panX: panX, panY: panY };
      }
      var vp = viewports[s.view] || { zoom: 1, panX: 0, panY: 0 };
      zoom = vp.zoom;
      panX = vp.panX;
      panY = vp.panY;
      lastView = s.view;
    }

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
    applyTransform(); // set the transform first so cable measurements are correct
    if (isTopo) drawTopoCables(mount.querySelector(".topo"));
    else if (s.view === "rear") drawRackCables(mount.querySelector(".rack-plate"));
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
    // advanced = the device's framed image, shown when Simple mode is off;
    // otherwise the generic placeholder plate, which reads on the device colour
    var advanced = !s.rack.simpleMode && Faceplates.hasImage(d, side);
    el.classList.toggle("advanced", advanced);
    if (!advanced) {
      el.style.background = d.color;
      el.style.color = textOn(d.color);
    }
    el.appendChild(Faceplates.render(d, side, s.rack.simpleMode)); // listeners live on el
    if (advanced) {
      // hovering an image faceplate blurs it and reveals the device name on top
      var ov = document.createElement("div");
      ov.className = "device-hover-name";
      ov.textContent = d.name || "Device";
      el.appendChild(ov);
    }
    return el;
  }

  /* shared overlay shell: position, click-to-select, drag-to-reposition */
  function deviceShell(d, s) {
    var el = document.createElement("div");
    el.className = "device" + (s.selectedId === d.id ? " selected" : "");
    el.style.top = (d.slot - 1) * U_PX + "px";
    el.style.height = d.u * U_PX - 1 + "px"; // near-full U: faceplates nearly touch, like real gear
    el.dataset.id = d.id;

    // pointer drag repositions the device; a tap (no movement) selects it.
    // Uses Pointer Events so it works with mouse, touch and pen alike (the
    // HTML5 drag-and-drop API has no touch support).
    el.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      var rect = el.getBoundingClientRect();
      // which U within the device was grabbed (so it stays under the pointer)
      var grab = Math.min(
        d.u - 1,
        Math.max(0, Math.floor((e.clientY - rect.top) / zoom / U_PX))
      );
      beginPlaceDrag("move", { id: d.id, u: d.u, grab: grab }, e, el);
    });
    return el;
  }

  var PLATE_PX = 502; // keep in sync with .rack-plate width

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
    // structured ports (from the device wizard) are the source of truth
    if (d.ports && d.ports.length) {
      return {
        list: d.ports.map(function (p) {
          return { label: p.label, type: p.type, dir: p.dir || "io" };
        }),
        generic: false,
      };
    }
    // legacy fall-backs: comma-separated rearLabel, else generic in/out
    var raw = (d.rearLabel || "")
      .split(",")
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
    if (raw.length) {
      return {
        list: raw.map(function (l) { return { label: l, type: "other", dir: "io" }; }),
        generic: false,
      };
    }
    return {
      list: genericPorts(d).map(function (l) {
        return { label: l, type: "other", dir: /out/i.test(l) ? "out" : /in/i.test(l) ? "in" : "io" };
      }),
      generic: true,
    };
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

    // Default layout: a stacked column in reading order (rack-top first),
    // used until a node is dragged. Dragged nodes carry explicit topoX/topoY
    // and stay where the user put them. Positions are absolute so paths are
    // easy to read once spread out.
    var defX = 48,
      cursorY = 48,
      maxX = 0,
      maxY = 0;

    s.devices
      .slice()
      .sort(function (a, b) { return a.slot - b.slot; })
      .forEach(function (d) {
        var placed = typeof d.topoX === "number" && typeof d.topoY === "number";
        var pos = placed ? { x: d.topoX, y: d.topoY } : { x: defX, y: cursorY };
        if (!placed) cursorY += estNodeHeight(d) + 26;

        wrap.appendChild(buildTopoNode(d, s, pos));
        maxX = Math.max(maxX, pos.x + 210);
        maxY = Math.max(maxY, pos.y + estNodeHeight(d));
      });

    // size the canvas so the stage can centre / pan around the nodes
    wrap.style.width = maxX + 48 + "px";
    wrap.style.height = maxY + 48 + "px";
    return wrap;
  }

  // approximate node height (head + port rows) for the default stack layout
  function estNodeHeight(d) {
    return 40 + topoPorts(d).list.length * 22 + 14;
  }

  function buildTopoNode(d, s, pos) {
    var node = document.createElement("div");
    node.className = "topo-node" + (s.selectedId === d.id ? " selected" : "");
    node.dataset.id = d.id;
    node.style.left = pos.x + "px";
    node.style.top = pos.y + "px";
    node.addEventListener("click", function (e) {
      e.stopPropagation();
      if (suppressTopoClick) {
        suppressTopoClick = false;
        return;
      }
      State.select(d.id);
    });

    var head = document.createElement("div");
    head.className = "topo-head";
    // drag the head to move the node around the canvas (mouse / touch / pen)
    head.addEventListener("pointerdown", function (e) {
      startTopoDrag(e, d, node, pos);
    });
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
    ports.list.forEach(function (p, i) {
      var row = document.createElement("div");
      row.className = "topo-port";
      row.appendChild(pin(d.id, i, "l", p.type, p.dir));
      var lbl = document.createElement("span");
      lbl.className = "topo-port-label";
      // direction cue: ◂ for inputs, ▸ for outputs
      lbl.textContent = (p.dir === "in" ? "◂ " : "") + p.label + (p.dir === "out" ? " ▸" : "");
      row.appendChild(lbl);
      row.appendChild(pin(d.id, i, "r", p.type, p.dir));
      list.appendChild(row);
    });
    node.appendChild(list);
    return node;
  }

  // drag a topology node by its head; deltas are divided by the zoom scale so
  // the node tracks the cursor. Commits to state on release (which persists
  // and re-renders). A tiny move threshold keeps a plain click = select.
  function startTopoDrag(e, d, node, origPos) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // no preventDefault here: let the trailing click fall through to select on
    // a tap. stopPropagation keeps the canvas from starting a pan underneath.
    e.stopPropagation();
    var sx = e.clientX,
      sy = e.clientY,
      pid = e.pointerId,
      moved = false;

    function mm(ev) {
      if (ev.pointerId !== pid) return;
      var dx = (ev.clientX - sx) / zoom;
      var dy = (ev.clientY - sy) / zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
        moved = true;
        node.classList.add("dragging");
      }
      if (moved) {
        node.style.left = origPos.x + dx + "px";
        node.style.top = origPos.y + dy + "px";
      }
    }
    function mu(ev) {
      if (ev.pointerId !== pid) return;
      document.removeEventListener("pointermove", mm);
      document.removeEventListener("pointerup", mu);
      document.removeEventListener("pointercancel", mu);
      if (!moved) return;
      node.classList.remove("dragging");
      var dx = (ev.clientX - sx) / zoom;
      var dy = (ev.clientY - sy) / zoom;
      suppressTopoClick = true; // don't let the trailing click change selection
      setTimeout(function () { suppressTopoClick = false; }, 0);
      State.setTopoPos(d.id, origPos.x + dx, origPos.y + dy);
    }
    document.addEventListener("pointermove", mm);
    document.addEventListener("pointerup", mu);
    document.addEventListener("pointercancel", mu);
  }

  // a single connection pin; the cable layer (later) will anchor to these.
  // colour-coded by port type so the routing endpoints read at a glance.
  function pin(devId, portIndex, side, type, dir) {
    var p = document.createElement("span");
    p.className = "topo-pin topo-pin-" + side + (dir ? " dir-" + dir : "");
    p.dataset.dev = devId;
    p.dataset.port = portIndex;
    p.dataset.side = side;
    p.dataset.dir = dir || "io";
    if (type) {
      p.dataset.type = type;
      p.style.background = window.Ports.color(type);
      p.style.borderColor = window.Ports.color(type);
    }
    // drag from a pin to another compatible pin to lay a cable
    p.addEventListener("pointerdown", function (e) {
      startCableDrag(e, devId, portIndex, type || "other", dir || "io", p);
    });
    return p;
  }

  /* ---------- cables (topology routing) ---------- */
  // build the SVG overlay of all cables for the current topology layout
  function drawTopoCables(wrap) {
    topoCablesSvg = null;
    if (!wrap) return;
    var w = wrap.offsetWidth,
      h = wrap.offsetHeight;
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "topo-cables");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);

    var topoRect = wrap.getBoundingClientRect();
    var pins = {};
    Array.prototype.forEach.call(wrap.querySelectorAll(".topo-pin"), function (p) {
      pins[p.dataset.dev + "|" + p.dataset.port + "|" + p.dataset.side] = p;
    });
    function center(el) {
      var r = el.getBoundingClientRect();
      return {
        x: (r.left + r.width / 2 - topoRect.left) / zoom,
        y: (r.top + r.height / 2 - topoRect.top) / zoom,
      };
    }

    State.get().cables.forEach(function (c) {
      var pair = bestPins(pins, c, center);
      if (!pair) return;
      var path = document.createElementNS(SVGNS, "path");
      path.setAttribute("class", "topo-cable");
      path.setAttribute("d", cablePath(pair.a.x, pair.a.y, pair.b.x, pair.b.y));
      path.style.stroke = window.Ports.color(c.type);
      path.addEventListener("click", function (e) {
        e.stopPropagation();
        State.removeCable(c.id);
        App.flash("Cable removed");
      });
      svg.appendChild(path);
      svg.appendChild(cableLabelEl((pair.a.x + pair.b.x) / 2, (pair.a.y + pair.b.y) / 2 - 6, cableLenText(c)));
    });

    wrap.insertBefore(svg, wrap.firstChild); // behind the nodes
    topoCablesSvg = svg;
  }

  // draw cables over the rear elevation, anchored to the rendered connectors
  // (or the device box, when its real image hides individual ports). Cables
  // sag a little, like patch leads draped across the back of a rack.
  function drawRackCables(plate) {
    if (!plate) return;
    var plateRect = plate.getBoundingClientRect();
    function center(el) {
      var r = el.getBoundingClientRect();
      return {
        x: (r.left + r.width / 2 - plateRect.left) / zoom,
        y: (r.top + r.height / 2 - plateRect.top) / zoom,
      };
    }
    function anchor(ref) {
      var g = plate.querySelector(
        '.port-glyph[data-dev="' + ref.dev + '"][data-port="' + ref.port + '"]'
      );
      if (g) return center(g);
      var dev = plate.querySelector('.device[data-id="' + ref.dev + '"]');
      return dev ? center(dev) : null;
    }
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "topo-cables over"); // .over → above the devices
    svg.setAttribute("width", plate.offsetWidth);
    svg.setAttribute("height", plate.offsetHeight);
    State.get().cables.forEach(function (c) {
      var a = anchor(c.a),
        b = anchor(c.b);
      if (!a || !b) return;
      var sag = Math.min(90, Math.max(12, Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)) * 0.18));
      var path = document.createElementNS(SVGNS, "path");
      path.setAttribute("class", "topo-cable");
      path.setAttribute("d", cableSagPath(a.x, a.y, b.x, b.y));
      path.style.stroke = window.Ports.color(c.type);
      path.addEventListener("click", function (e) {
        e.stopPropagation();
        State.removeCable(c.id);
        App.flash("Cable removed");
      });
      svg.appendChild(path);
      svg.appendChild(cableLabelEl((a.x + b.x) / 2, (a.y + b.y) / 2 + sag * 0.6, cableLenText(c)));
    });
    plate.appendChild(svg); // drape the cables on top of the device plates
  }

  // an SVG length label drawn at a cable's midpoint (live; updates on re-render)
  function cableLabelEl(x, y, text) {
    var t = document.createElementNS(SVGNS, "text");
    t.setAttribute("class", "cable-label");
    t.setAttribute("x", x);
    t.setAttribute("y", y);
    t.setAttribute("text-anchor", "middle");
    t.textContent = text;
    return t;
  }
  function cableLenText(c) {
    return State.cableStandardM(State.cableLengthMm(c)) + " m";
  }

  // a gently sagging curve (catenary-ish) between two points
  function cableSagPath(ax, ay, bx, by) {
    var dist = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    var sag = Math.min(90, Math.max(12, dist * 0.18));
    var mx = (ax + bx) / 2,
      my = (ay + by) / 2 + sag;
    return "M" + ax + "," + ay + " Q" + mx + "," + my + " " + bx + "," + by;
  }

  // pick the closest pin pair (each port has a left + right pin) for a cable
  function bestPins(pins, c, center) {
    var aC = ["l", "r"]
      .map(function (s) { return pins[c.a.dev + "|" + c.a.port + "|" + s]; })
      .filter(Boolean);
    var bC = ["l", "r"]
      .map(function (s) { return pins[c.b.dev + "|" + c.b.port + "|" + s]; })
      .filter(Boolean);
    if (!aC.length || !bC.length) return null;
    var best = null,
      bestD = Infinity;
    aC.forEach(function (ae) {
      var ac = center(ae);
      bC.forEach(function (be) {
        var bc = center(be);
        var d = (bc.x - ac.x) * (bc.x - ac.x) + (bc.y - ac.y) * (bc.y - ac.y);
        if (d < bestD) {
          bestD = d;
          best = { a: ac, b: bc };
        }
      });
    });
    return best;
  }

  // a smooth horizontal-ish bezier between two points
  function cablePath(ax, ay, bx, by) {
    var dx = Math.max(30, Math.abs(bx - ax) * 0.5);
    return "M" + ax + "," + ay + " C" + (ax + dx) + "," + ay + " " + (bx - dx) + "," + by + " " + bx + "," + by;
  }

  // drag from a pin: rubber-band a temp cable, drop on a compatible pin to connect
  function startCableDrag(e, dev, port, type, dir, pinEl) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // not a node drag / pan
    var wrap = mount.querySelector(".topo");
    if (!wrap || !topoCablesSvg) return;
    var topoRect = wrap.getBoundingClientRect();
    function local(clientX, clientY) {
      return { x: (clientX - topoRect.left) / zoom, y: (clientY - topoRect.top) / zoom };
    }
    var r = pinEl.getBoundingClientRect();
    var start = local(r.left + r.width / 2, r.top + r.height / 2);

    var temp = document.createElementNS(SVGNS, "path");
    temp.setAttribute("class", "topo-cable temp");
    temp.style.stroke = window.Ports.color(type);
    topoCablesSvg.appendChild(temp);
    highlightCompatible(wrap, type, dir, dev, port, true);

    var pid = e.pointerId;
    function mm(ev) {
      if (ev.pointerId !== pid) return;
      var p = local(ev.clientX, ev.clientY);
      temp.setAttribute("d", cablePath(start.x, start.y, p.x, p.y));
    }
    function up(ev) {
      if (ev.pointerId !== pid) return;
      document.removeEventListener("pointermove", mm);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      // hit-test the drop BEFORE clearing the highlight — clearing it shrinks
      // the enlarged compatible pins back down and the point would miss them.
      var t = document.elementFromPoint(ev.clientX, ev.clientY);
      var tp = t ? t.closest(".topo-pin") : null;
      // pins are small; if we just missed, snap to the nearest compatible one
      if (!tp) tp = nearestPin(ev.clientX, ev.clientY, wrap, type, dir, dev, port);
      highlightCompatible(wrap, type, dir, dev, port, false);
      if (temp.parentNode) temp.parentNode.removeChild(temp);
      suppressTopoClick = true; // swallow the trailing click on the node
      setTimeout(function () { suppressTopoClick = false; }, 0);
      if (tp) {
        var reason = State.addCable(
          { dev: dev, port: port },
          { dev: tp.dataset.dev, port: parseInt(tp.dataset.port, 10) }
        );
        flashCable(reason);
      }
    }
    document.addEventListener("pointermove", mm);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }

  // nearest compatible, unconnected pin within a forgiving radius of (x,y)
  function nearestPin(x, y, wrap, type, dir, dev, port) {
    var best = null,
      bd = 26 * 26; // ~26px tolerance
    Array.prototype.forEach.call(wrap.querySelectorAll(".topo-pin"), function (p) {
      if (!window.Ports.compatible(type, dir, p.dataset.type, p.dataset.dir)) return;
      if (p.dataset.dev === dev && parseInt(p.dataset.port, 10) === port) return;
      if (State.portConnected({ dev: p.dataset.dev, port: parseInt(p.dataset.port, 10) })) return;
      var r = p.getBoundingClientRect();
      var dx = r.left + r.width / 2 - x,
        dy = r.top + r.height / 2 - y;
      var dd = dx * dx + dy * dy;
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    });
    return best;
  }

  // glow the pins a new cable could legally land on: matching type, compatible
  // direction, not itself, and not already connected
  function highlightCompatible(wrap, type, dir, dev, port, on) {
    Array.prototype.forEach.call(wrap.querySelectorAll(".topo-pin"), function (p) {
      var ok =
        on &&
        window.Ports.compatible(type, dir, p.dataset.type, p.dataset.dir) &&
        !(p.dataset.dev === dev && parseInt(p.dataset.port, 10) === port) &&
        !State.portConnected({ dev: p.dataset.dev, port: parseInt(p.dataset.port, 10) });
      p.classList.toggle("compatible", ok);
    });
  }

  function flashCable(reason) {
    if (reason == null) App.flash("Cable connected");
    else if (reason === "type") App.flash("Can't connect different connector types");
    else if (reason === "dir") App.flash("Connect an output to an input");
    else if (reason === "busy") App.flash("That port is already connected");
    else if (reason === "dup") App.flash("Those ports are already connected");
    // "same" / "invalid" → silent (just a stray release)
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

  /* ---------- unified pointer drag: place a library item OR move a device ----------
     Replaces HTML5 drag-and-drop (which has no touch support). `kind` is "add"
     (dragged from the library) or "move" (a placed device). The rack's live
     .slots / .slot cells are the drop grid, located via elementFromPoint so
     the same code works whichever plate is on screen. */
  function beginPlaceDrag(kind, data, e, srcEl) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    var sx = e.clientX,
      sy = e.clientY,
      pid = e.pointerId;
    var moved = false,
      ghost = null,
      removeHint = null, // "release to remove" chip when dragging a device out
      hl = [];

    function clearHL() {
      hl.forEach(function (c) {
        c.classList.remove("drop-ok", "drop-bad");
      });
      hl = [];
    }
    function slotsAt(x, y) {
      var t = document.elementFromPoint(x, y);
      return t ? t.closest(".slots") : null;
    }
    function topFrom(slots, y) {
      var rect = slots.getBoundingClientRect();
      var size = State.get().rack.size;
      var row = Math.min(size, Math.max(1, Math.floor((y - rect.top) / zoom / U_PX) + 1));
      var top = row - (data.grab || 0);
      return Math.min(Math.max(1, top), Math.max(1, size - data.u + 1));
    }
    function highlight(slots, y) {
      clearHL();
      var top = topFrom(slots, y);
      var snapped = State.findFreeSlot(data.u, top, kind === "move" ? data.id : null);
      var cells = slots.querySelectorAll(".slot");
      var start = snapped != null ? snapped : top;
      var cls = snapped != null ? "drop-ok" : "drop-bad";
      for (var r = start; r < start + data.u; r++) {
        var c = cells[r - 1];
        if (c) {
          c.classList.add(cls);
          hl.push(c);
        }
      }
    }
    function mm(ev) {
      if (ev.pointerId !== pid) return;
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) {
        moved = true;
        if (kind === "move" && srcEl) srcEl.classList.add("dragging");
        else if (kind === "add") ghost = makeGhost(data.label, ev.clientX, ev.clientY);
      }
      if (!moved) return;
      if (ghost) {
        ghost.style.left = ev.clientX + "px";
        ghost.style.top = ev.clientY + "px";
      }
      var slots = slotsAt(ev.clientX, ev.clientY);
      if (slots) {
        setRemoving(false);
        if (kind === "move") highlight(slots, ev.clientY);
      } else {
        clearHL();
        // dragging a placed device off the rack arms its removal
        if (kind === "move") setRemoving(true, ev.clientX, ev.clientY);
      }
    }
    // toggle the "release to remove" affordance: dim the device + a red chip
    function setRemoving(on, x, y) {
      if (kind !== "move") return;
      if (on) {
        if (srcEl) srcEl.classList.add("removing");
        if (!removeHint) removeHint = makeRemoveHint(x, y);
        else {
          removeHint.style.left = x + "px";
          removeHint.style.top = y + "px";
        }
      } else {
        if (srcEl) srcEl.classList.remove("removing");
        if (removeHint) {
          removeHint.remove();
          removeHint = null;
        }
      }
    }
    function done(ev) {
      if (ev.pointerId !== pid) return;
      document.removeEventListener("pointermove", mm);
      document.removeEventListener("pointerup", done);
      document.removeEventListener("pointercancel", done);
      if (ghost) ghost.remove();
      if (removeHint) removeHint.remove();
      var slots = slotsAt(ev.clientX, ev.clientY);
      if (moved && slots) {
        var top = topFrom(slots, ev.clientY);
        if (kind === "move") State.repositionDevice(data.id, top);
        else if (!State.addDevice(data.def, top)) App.flash("No room in the rack");
      } else if (!moved) {
        // a tap: select the device, or drop a library item in the first free slot
        if (kind === "move") State.select(data.id);
        else if (!State.addDevice(data.def, null)) App.flash("No room in the rack");
      } else if (kind === "move") {
        // dragged a device off the rack → remove it
        var dev = State.byId(data.id);
        State.removeDevice(data.id);
        App.flash("Removed " + (dev ? dev.name : "device"));
      }
      clearHL();
    }
    document.addEventListener("pointermove", mm);
    document.addEventListener("pointerup", done);
    document.addEventListener("pointercancel", done);
  }

  function makeGhost(label, x, y) {
    var g = document.createElement("div");
    g.className = "drag-ghost floating";
    g.textContent = label || "device";
    g.style.left = x + "px";
    g.style.top = y + "px";
    document.body.appendChild(g);
    return g;
  }
  function makeRemoveHint(x, y) {
    var g = document.createElement("div");
    g.className = "drag-ghost floating remove";
    g.textContent = "✕ Release to remove";
    g.style.left = x + "px";
    g.style.top = y + "px";
    document.body.appendChild(g);
    return g;
  }

  /* ---------- zoom + pan (local UI state) — mouse, touch and pen ---------- */
  function bindCanvas() {
    // mouse wheel zooms toward the cursor
    canvas.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var rect = canvas.getBoundingClientRect();
        zoomAt(
          zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1),
          e.clientX - rect.left - rect.width / 2,
          e.clientY - rect.top - rect.height / 2
        );
      },
      { passive: false }
    );

    // one pointer drags to pan; two pointers pinch to zoom. A tap on empty
    // canvas (no movement) deselects.
    var pointers = {};
    var pan = null; // { baseX, baseY, startX, startY, moved }
    var pinch = null; // { dist, zoom, cx, cy }

    function n() {
      return Object.keys(pointers).length;
    }
    function pts() {
      return Object.keys(pointers).map(function (k) {
        return pointers[k];
      });
    }
    function makePinch() {
      var p = pts();
      var rect = canvas.getBoundingClientRect();
      return {
        dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
        zoom: zoom,
        cx: (p[0].x + p[1].x) / 2 - rect.left - rect.width / 2,
        cy: (p[0].y + p[1].y) / 2 - rect.top - rect.height / 2,
      };
    }

    canvas.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".device, .topo-node")) return; // own drag handlers
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (n() === 1) {
        pan = { baseX: panX, baseY: panY, startX: e.clientX, startY: e.clientY, moved: false };
        pinch = null;
      } else if (n() === 2) {
        pan = null;
        pinch = makePinch();
      }
    });

    document.addEventListener("pointermove", function (e) {
      if (!(e.pointerId in pointers)) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch && n() >= 2) {
        var p = pts();
        var dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
        zoomAt(pinch.zoom * (dist / pinch.dist), pinch.cx, pinch.cy);
      } else if (pan) {
        var dx = e.clientX - pan.startX,
          dy = e.clientY - pan.startY;
        if (!pan.moved && Math.abs(dx) + Math.abs(dy) > 3) {
          pan.moved = true;
          canvas.classList.add("panning");
        }
        if (pan.moved) {
          panX = pan.baseX + dx;
          panY = pan.baseY + dy;
          applyTransform();
        }
      }
    });

    function end(e) {
      if (!(e.pointerId in pointers)) return;
      var wasTap = pan && !pan.moved && n() === 1;
      delete pointers[e.pointerId];
      if (n() < 2) pinch = null;
      if (n() === 1) {
        // a finger lifted after a pinch → keep panning with the remaining one
        var k = Object.keys(pointers)[0];
        pan = { baseX: panX, baseY: panY, startX: pointers[k].x, startY: pointers[k].y, moved: true };
      } else if (n() === 0) {
        if (wasTap) State.select(null);
        pan = null;
        canvas.classList.remove("panning");
      }
    }
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  // zoom to `rawZoom`, keeping the point (cx,cy) (canvas-centre-relative) fixed
  function zoomAt(rawZoom, cx, cy) {
    var old = zoom;
    var next = clampZoom(rawZoom);
    if (next === old) return;
    var ratio = next / old;
    panX += (cx - panX) * (1 - ratio);
    panY += (cy - panY) * (1 - ratio);
    zoom = next;
    applyTransform();
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
    // make the blueprint grid pan + scale with the workplate so the checkers
    // travel with the content instead of the content sliding over a fixed grid
    if (canvas) {
      var g1 = 26 * zoom + "px",
        g2 = 130 * zoom + "px";
      var px = "calc(50% + " + panX + "px)",
        py = "calc(50% + " + panY + "px)";
      var pos = px + " " + py;
      canvas.style.backgroundSize =
        g1 + " " + g1 + ", " + g1 + " " + g1 + ", " + g2 + " " + g2 + ", " + g2 + " " + g2;
      canvas.style.backgroundPosition = pos + ", " + pos + ", " + pos + ", " + pos;
    }
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
    beginPlaceDrag: beginPlaceDrag,
  };
})();
