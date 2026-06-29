/* props.js — right sidebar. Reads from state, writes back to state.
 *
 * Upper zone  (#rack-settings): global rack settings, always visible.
 * Lower zone  (#device-props):  selected device editor, or an empty state.
 *
 * Text inputs commit on `change`/blur (not on every keystroke) so a
 * re-render triggered by the commit never yanks focus mid-typing.
 */
window.Props = (function () {
  "use strict";

  var globalEl, deviceEl;

  // faceplate palette — same dark-leaning family as the library
  var PALETTE = [
    "#1a1a1d", "#23262b", "#2b2b2e", "#1c1f24", "#1e2a33",
    "#26201c", "#202024", "#2d2d30", "#0a3a5f", "#1f4d2e",
    "#5c1f1f", "#3a2b14",
  ];

  function init(refs) {
    globalEl = refs.globalEl;
    deviceEl = refs.deviceEl;
  }

  function render() {
    renderGlobal();
    renderDevice();
  }

  /* ---------- global rack settings ---------- */
  function renderGlobal() {
    var r = State.get().rack;
    globalEl.innerHTML = "";

    var title = el("div", "props-title", "Rack settings");
    globalEl.appendChild(title);

    // size + start unit on one row
    var row = el("div", "field-row");

    row.appendChild(
      numberField("Size (U)", r.size, 1, 60, function (v) {
        State.setRackSetting("size", v);
      })
    );
    row.appendChild(
      numberField("Start U#", r.startUnit, 0, 9999, function (v) {
        State.setRackSetting("startUnit", v);
      })
    );
    globalEl.appendChild(row);

    // numbering direction
    var dirField = el("div", "field");
    dirField.appendChild(el("label", null, "Numbering"));
    var seg = el("div", "seg-mini");
    seg.appendChild(
      segBtn("Top → bottom", r.direction === "top-down", function () {
        State.setRackSetting("direction", "top-down");
      })
    );
    seg.appendChild(
      segBtn("Bottom → top", r.direction === "bottom-up", function () {
        State.setRackSetting("direction", "bottom-up");
      })
    );
    dirField.appendChild(seg);
    globalEl.appendChild(dirField);

    // depth (mm) — shown in the side view
    globalEl.appendChild(
      numberField("Depth (mm)", r.depth, 200, 1500, function (v) {
        State.setRackSetting("depth", v);
      })
    );

    // wheels / casters toggle
    var wheelField = el("div", "field");
    var wheelRow = el("div", "toggle-row");
    wheelRow.appendChild(el("label", null, "Wheels (casters)"));
    var wheelToggle = el("div", "toggle" + (r.wheels ? " on" : ""));
    wheelToggle.addEventListener("click", function () {
      State.setRackSetting("wheels", !r.wheels);
    });
    wheelRow.appendChild(wheelToggle);
    wheelField.appendChild(wheelRow);
    globalEl.appendChild(wheelField);
  }

  /* ---------- selected device properties ---------- */
  function renderDevice() {
    deviceEl.innerHTML = "";
    var d = State.getSelected();

    if (!d) {
      var empty = el("div", "props-empty");
      empty.innerHTML =
        '<span class="glyph">▤</span>Select a device to edit its properties, or drag one in from the library.';
      deviceEl.appendChild(empty);
      return;
    }

    deviceEl.appendChild(el("div", "props-title", "Device"));

    // label (name)
    deviceEl.appendChild(
      textField("Label", d.name, function (v) {
        State.updateDevice(d.id, { name: v || "Device" });
      })
    );
    // brand / model
    deviceEl.appendChild(
      textField("Brand / model", d.brand, function (v) {
        State.updateDevice(d.id, { brand: v });
      })
    );

    // chassis depth (mm) — drives the side / x-ray view
    deviceEl.appendChild(
      numberField("Depth (mm)", d.depth, 20, 2000, function (v) {
        var n = Math.round(Number(v));
        if (!isFinite(n)) return;
        State.updateDevice(d.id, { depth: Math.max(20, Math.min(2000, n)) });
      })
    );

    // faceplate color swatches
    var colorField = el("div", "field");
    colorField.appendChild(el("label", null, "Faceplate"));
    var sw = el("div", "swatches");
    PALETTE.forEach(function (c) {
      var s = el("div", "swatch" + (sameColor(c, d.color) ? " active" : ""));
      s.style.background = c;
      s.title = c;
      s.addEventListener("click", function () {
        State.updateDevice(d.id, { color: c });
      });
      sw.appendChild(s);
    });
    colorField.appendChild(sw);
    deviceEl.appendChild(colorField);

    // faceplate image — frame a real illustration (stored locally)
    var imgField = el("div", "field");
    imgField.appendChild(el("label", null, "Faceplate image"));
    var imgRow = el("div", "nudge");
    imgRow.appendChild(faceBtn("Front…", d.id, "front", !!d.image));
    imgRow.appendChild(faceBtn("Rear…", d.id, "rear", !!d.imageRear));
    imgField.appendChild(imgRow);
    if (d.image || d.imageRear) {
      var clrRow = el("div", "nudge");
      clrRow.style.marginTop = "6px";
      if (d.image) clrRow.appendChild(clearBtn("Remove front", d.id, "image"));
      if (d.imageRear) clrRow.appendChild(clearBtn("Remove rear", d.id, "imageRear"));
      imgField.appendChild(clrRow);
    }
    deviceEl.appendChild(imgField);

    // status LED toggle
    var ledField = el("div", "field");
    var ledRow = el("div", "toggle-row");
    ledRow.appendChild(el("label", null, "Status LED"));
    var toggle = el("div", "toggle" + (d.led ? " on" : ""));
    toggle.addEventListener("click", function () {
      State.updateDevice(d.id, { led: !d.led });
    });
    ledRow.appendChild(toggle);
    ledField.appendChild(ledRow);
    deviceEl.appendChild(ledField);

    // rear labels (shown in rear view)
    deviceEl.appendChild(
      textareaField(
        "Rear ports / patch (comma-separated)",
        d.rearLabel,
        function (v) {
          State.updateDevice(d.id, { rearLabel: v });
        }
      )
    );

    // slot info + nudge
    deviceEl.appendChild(slotInfo(d));

    // share: export this device, or submit it to the community library
    var share = el("div", "nudge");
    share.style.marginBottom = "8px";
    var exportBtn = el("button", "btn", "Export");
    exportBtn.title = "Download this device as a .json file";
    exportBtn.addEventListener("click", function () {
      Persist.exportDevice(d);
    });
    var submitBtn = el("button", "btn", "Submit to library");
    submitBtn.title = "Open a GitHub submission with this device";
    submitBtn.addEventListener("click", function () {
      App.contributeDevice(d);
    });
    share.appendChild(exportBtn);
    share.appendChild(submitBtn);
    deviceEl.appendChild(share);

    // remove
    var remove = el("button", "btn btn-danger btn-block", "Remove device");
    remove.addEventListener("click", function () {
      State.removeDevice(d.id);
    });
    deviceEl.appendChild(remove);
  }

  function slotInfo(d) {
    var field = el("div", "field");
    var topRow = d.slot;
    var bottomRow = d.slot + d.u - 1;
    // display numbers for the device's top & bottom physical rows
    var nTop = State.displayNumber(topRow);
    var nBottom = State.displayNumber(bottomRow);
    var lo = Math.min(nTop, nBottom);
    var hi = Math.max(nTop, nBottom);

    var info = el("div", "slot-info");
    info.innerHTML =
      "Occupies <b>" +
      d.u +
      "U</b> · U <b>" +
      (lo === hi ? lo : lo + "–" + hi) +
      "</b>";
    field.appendChild(info);

    var nudge = el("div", "nudge");
    nudge.style.marginTop = "8px";
    var up = el("button", "btn", "▲ Up");
    up.addEventListener("click", function () {
      State.nudge(d.id, -1);
    });
    var down = el("button", "btn", "▼ Down");
    down.addEventListener("click", function () {
      State.nudge(d.id, 1);
    });
    nudge.appendChild(up);
    nudge.appendChild(down);
    field.appendChild(nudge);
    return field;
  }

  /* ---------- field builders ---------- */
  function textField(label, value, onCommit) {
    var f = el("div", "field");
    f.appendChild(el("label", null, label));
    var input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.addEventListener("change", function () {
      onCommit(input.value);
    });
    f.appendChild(input);
    return f;
  }

  function numberField(label, value, min, max, onCommit) {
    var f = el("div", "field");
    f.appendChild(el("label", null, label));
    var input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.addEventListener("change", function () {
      onCommit(input.value);
    });
    f.appendChild(input);
    return f;
  }

  function textareaField(label, value, onCommit) {
    var f = el("div", "field");
    f.appendChild(el("label", null, label));
    var ta = document.createElement("textarea");
    ta.value = value || "";
    ta.placeholder = "e.g. Main L, Main R, Aux 1";
    ta.addEventListener("change", function () {
      onCommit(ta.value);
    });
    f.appendChild(ta);
    return f;
  }

  function segBtn(label, active, onClick) {
    var b = el("button", active ? "active" : null, label);
    b.addEventListener("click", onClick);
    return b;
  }

  // opens the import & frame modal for a device side; a check marks a set image
  function faceBtn(label, id, side, has) {
    var b = el("button", "btn", (has ? "✓ " : "") + label);
    b.title = (has ? "Re-frame the " : "Frame the ") + side + " illustration";
    b.addEventListener("click", function () {
      App.openFrameModal(id, side);
    });
    return b;
  }
  function clearBtn(label, id, key) {
    var b = el("button", "btn", label);
    b.addEventListener("click", function () {
      var patch = {};
      patch[key] = null;
      State.updateDevice(id, patch);
    });
    return b;
  }

  /* ---------- tiny dom helper ---------- */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function sameColor(a, b) {
    return (a || "").toLowerCase() === (b || "").toLowerCase();
  }

  return { init: init, render: render, PALETTE: PALETTE };
})();
