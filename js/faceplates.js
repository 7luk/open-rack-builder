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
    var wrap = document.createElement("div");
    wrap.className = "fp-blank-label";
    var name = document.createElement("div");
    name.className = "fp-blank-name";
    name.textContent = device.name || "Device";
    wrap.appendChild(name);
    if (device.brand) {
      var brand = document.createElement("div");
      brand.className = "fp-blank-brand";
      brand.textContent = device.brand;
      wrap.appendChild(brand);
    }
    return wrap;
  }

  function rearContent(device) {
    var wrap = document.createElement("div");
    wrap.className = "fp-blank-label";

    var ports = portList(device);
    if (ports.length) {
      // colour-coded connector chips, dispersed evenly and centred by the
      // flex layout (.fp-ports). These are the same virtual ports used by the
      // topology view and, later, cable routing.
      var row = document.createElement("div");
      row.className = "fp-ports";
      ports.forEach(function (p) {
        row.appendChild(window.Ports.glyph(p.type, p.dir));
      });
      wrap.appendChild(row);
    } else {
      var name = document.createElement("div");
      name.className = "fp-blank-name";
      name.textContent = device.name || "Device";
      wrap.appendChild(name);
      var hint = document.createElement("div");
      hint.className = "fp-blank-brand";
      hint.textContent = "rear";
      wrap.appendChild(hint);
    }
    return wrap;
  }

  // a device's ports: the structured list if present, else the legacy
  // comma-separated rearLabel parsed as generic "other" ports.
  function portList(device) {
    if (device && device.ports && device.ports.length) return device.ports;
    return (device && device.rearLabel ? device.rearLabel : "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (l) { return { type: "other", dir: "io", label: l }; });
  }

  function screwLayer() {
    var layer = document.createElement("div");
    layer.className = "fp-screws";
    for (var i = 0; i < 4; i++) layer.appendChild(document.createElement("span"));
    return layer;
  }

  return { render: render, hasImage: hasImage, ASPECT: ASPECT };
})();
