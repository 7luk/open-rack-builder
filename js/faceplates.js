/* faceplates.js — device faceplate appearance.
 *
 * A device's look is a user-supplied image (front and/or rear), framed to the
 * faceplate aspect and stored locally in the project document. These images
 * are the user's own assets — they are never bundled into the public repo.
 *
 * When a device has no image, a clean generic placeholder is drawn so it stays
 * legible: a labelled blank panel (front) or its rear-port list (rear).
 *
 * Public API:
 *   Faceplates.render(device, side)   -> HTMLElement   (image or placeholder)
 *   Faceplates.hasImage(device, side) -> boolean
 *   Faceplates.ASPECT                 -> 19 / 1.75      (width : height per U)
 */
window.Faceplates = (function () {
  "use strict";

  var ASPECT = 19 / 1.75; // a 1U faceplate is 19" wide × 1.75" tall

  function imageFor(device, side) {
    if (!device) return null;
    var src = side === "rear" ? device.imageRear : device.image;
    return typeof src === "string" && src ? src : null;
  }
  function hasImage(device, side) {
    return !!imageFor(device, side);
  }

  /* the faceplate content that fills a .device box.
     `simple` forces the generic placeholder even when an image exists. */
  function render(device, side, simple) {
    var src = simple ? null : imageFor(device, side);
    return src ? imageEl(src) : placeholder(device, side);
  }

  function imageEl(src) {
    var img = document.createElement("img");
    img.className = "fp-img";
    img.src = src;
    img.alt = "";
    img.draggable = false;
    return img;
  }

  /* generic blank panel shown until the user frames an illustration */
  function placeholder(device, side) {
    var box = document.createElement("div");
    box.className = "fp-blank" + (side === "rear" ? " fp-blank-rear" : "");
    box.appendChild(screwLayer());
    box.appendChild(side === "rear" ? rearContent(device) : frontContent(device));
    return box;
  }

  function frontContent(device) {
    var wrap = ce("div", "fp-blank-label");
    wrap.appendChild(ce("div", "fp-blank-name", device.name || "Device"));
    if (device.brand) wrap.appendChild(ce("div", "fp-blank-brand", device.brand));
    var row = portsRow(device, "front"); // front-mounted connectors, if any
    if (row) wrap.appendChild(row);
    return wrap;
  }

  function rearContent(device) {
    var wrap = ce("div", "fp-blank-label");
    var row = portsRow(device, "rear");
    if (row) {
      wrap.appendChild(row);
      return wrap;
    }
    // no rear ports → fall back to a labelled blank
    wrap.appendChild(ce("div", "fp-blank-name", device.name || "Device"));
    wrap.appendChild(ce("div", "fp-blank-brand", "rear"));
    return wrap;
  }

  // a row of drawn connectors for one side (front/rear), each with its label.
  // Each glyph is tagged with its device + ORIGINAL port index so the 2D cable
  // layer can anchor to it. Returns null when the side has no ports.
  function portsRow(device, side) {
    var list = portList(device).filter(function (p) {
      return (p.side || "rear") === side;
    });
    if (!list.length) return null;
    var row = ce("div", "fp-ports");
    list.forEach(function (p) {
      var item = ce("div", "fp-port-item");
      var g = window.Ports.glyph(p.type, p.dir);
      if (device && device.id) {
        g.dataset.dev = device.id;
        g.dataset.port = p.idx;
      }
      item.appendChild(g);
      if (p.label) item.appendChild(ce("div", "fp-port-label", p.label));
      row.appendChild(item);
    });
    return row;
  }

  // structured ports (carrying their original index) or the legacy rearLabel
  function portList(device) {
    if (device && device.ports && device.ports.length) {
      return device.ports.map(function (p, i) {
        return { type: p.type, dir: p.dir, side: p.side || "rear", label: p.label, idx: i };
      });
    }
    return (device && device.rearLabel ? device.rearLabel : "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (l, i) { return { type: "other", dir: "io", side: "rear", label: l, idx: i }; });
  }

  function ce(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function screwLayer() {
    var layer = document.createElement("div");
    layer.className = "fp-screws";
    for (var i = 0; i < 4; i++) layer.appendChild(document.createElement("span"));
    return layer;
  }

  return { render: render, hasImage: hasImage, ASPECT: ASPECT };
})();
