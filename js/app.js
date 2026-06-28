/* app.js — entry point. Wires modules to state and the DOM.
 *
 * Owns no document data of its own (that's State's job). It holds only
 * transient UI bits: the current search text, the in-flight drag payload,
 * and modal/menu chrome. One master render() runs on every state change.
 */
window.App = (function () {
  "use strict";

  // transient UI state (never persisted)
  var searchQuery = "";
  App_dragDef = null; // set on library dragstart, read by rack drop
  App_dragMove = null; // set when dragging a placed device, read by rack drop

  var refs = {};

  function start() {
    cacheRefs();
    Rack.init({
      mount: refs.rackMount,
      stage: refs.stage,
      canvas: refs.canvas,
      zoomReadout: refs.zoomReadout,
    });
    Props.init({ globalEl: refs.rackSettings, deviceEl: refs.deviceProps });

    bindHeader();
    bindMenubar();
    bindLibrary();
    bindGlobalKeys();
    bindFileInput();

    // render on every state change; autosave (debounced) too
    State.subscribe(render);
    State.subscribe(debounce(Persist.save, 250));

    // restore last session, else start fresh
    if (!Persist.load()) {
      State.notify(); // first paint with defaults
    }
  }

  function cacheRefs() {
    refs.canvas = byId("canvas");
    refs.stage = byId("canvas-stage");
    refs.rackMount = byId("rack-mount");
    refs.zoomReadout = byId("zoom-readout");
    refs.libraryList = byId("library-list");
    refs.search = byId("library-search");
    refs.rackSettings = byId("rack-settings");
    refs.deviceProps = byId("device-props");
    refs.projectName = byId("project-name");
    refs.viewControl = byId("view-control");
    refs.themeToggle = byId("theme-toggle");
    refs.menubar = byId("menubar");
    refs.addCustomBtn = byId("add-custom-btn");
    refs.modalHost = byId("modal-host");
    refs.fileInput = byId("file-input");
  }

  /* ---------- master render ---------- */
  function render() {
    var s = State.get();

    // theme on the root element — all colors flip via CSS variables
    document.documentElement.classList.toggle("dark", s.theme === "dark");

    // project name (don't clobber an in-progress edit)
    if (document.activeElement !== refs.projectName) {
      refs.projectName.textContent = s.projectName;
    }

    // view segmented control
    Array.prototype.forEach.call(
      refs.viewControl.querySelectorAll(".seg"),
      function (b) {
        b.classList.toggle("active", b.dataset.view === s.view);
      }
    );

    Library.render(refs.libraryList, searchQuery);
    Rack.render();
    Props.render();
  }

  /* ---------- header ---------- */
  function bindHeader() {
    // editable project name: commit on blur, Enter blurs
    refs.projectName.addEventListener("blur", function () {
      State.setProjectName(refs.projectName.textContent);
    });
    refs.projectName.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        refs.projectName.blur();
      }
    });

    // view control
    refs.viewControl.addEventListener("click", function (e) {
      var btn = e.target.closest(".seg");
      if (btn) State.setView(btn.dataset.view);
    });

    // theme toggle
    refs.themeToggle.addEventListener("click", State.toggleTheme);

    // add custom device
    refs.addCustomBtn.addEventListener("click", openCustomModal);
  }

  /* ---------- menu bar ---------- */
  function bindMenubar() {
    var menus = refs.menubar.querySelectorAll("[data-menu]");

    refs.menubar.addEventListener("click", function (e) {
      var label = e.target.closest(".menu-label");
      if (label) {
        var menu = label.parentElement;
        var wasOpen = menu.classList.contains("open");
        closeMenus();
        if (!wasOpen) menu.classList.add("open");
        return;
      }
      var action = e.target.closest("[data-action]");
      if (action) {
        closeMenus();
        runAction(action.dataset.action);
      }
    });

    // hover to switch menus while one is open
    refs.menubar.addEventListener("mouseover", function (e) {
      if (!refs.menubar.querySelector(".menu.open")) return;
      var label = e.target.closest(".menu-label");
      if (label) {
        closeMenus();
        label.parentElement.classList.add("open");
      }
    });

    document.addEventListener("mousedown", function (e) {
      if (!e.target.closest("[data-menu]")) closeMenus();
    });

    function closeMenus() {
      menus.forEach(function (m) {
        m.classList.remove("open");
      });
    }
    App_closeMenus = closeMenus;
  }

  var actions = {
    "new-project": openNewProjectModal,
    save: function () {
      Persist.save();
      flash("Saved");
    },
    import: function () {
      refs.fileInput.click();
    },
    "export-json": Persist.exportJSON,
    "export-pdf": Exporter.exportPDF,
    "remove-selected": function () {
      var d = State.getSelected();
      if (d) State.removeDevice(d.id);
    },
    deselect: function () {
      State.select(null);
    },
    "clear-rack": openClearRackModal,
    "view-front": function () {
      State.setView("front");
    },
    "view-rear": function () {
      State.setView("rear");
    },
    "view-side": function () {
      State.setView("side");
    },
    "zoom-reset": Rack.resetZoom,
    "toggle-theme": State.toggleTheme,
    "add-u": function () {
      State.addU(1);
    },
    "remove-u": function () {
      State.addU(-1);
    },
    "size-8": function () {
      State.setRackSetting("size", 8);
    },
    "size-12": function () {
      State.setRackSetting("size", 12);
    },
    "size-24": function () {
      State.setRackSetting("size", 24);
    },
    "size-42": function () {
      State.setRackSetting("size", 42);
    },
  };
  function runAction(name) {
    var fn = actions[name];
    if (fn) fn();
  }

  /* ---------- library: search, drag, click-to-add ---------- */
  function bindLibrary() {
    refs.search.addEventListener("input", function () {
      searchQuery = refs.search.value;
      Library.render(refs.libraryList, searchQuery);
    });

    // drag source
    refs.libraryList.addEventListener("dragstart", function (e) {
      var item = e.target.closest(".lib-item");
      if (!item) return;
      App.dragDef = Library.defFromEl(item);
      App.dragMove = null;
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", App.dragDef.name);
    });
    refs.libraryList.addEventListener("dragend", function () {
      App.dragDef = null;
    });

    // click a library row to drop into the first free slot
    refs.libraryList.addEventListener("click", function (e) {
      var item = e.target.closest(".lib-item");
      if (!item) return;
      var id = State.addDevice(Library.defFromEl(item), null);
      if (!id) flash("No room in the rack");
    });
  }

  /* ---------- keyboard ---------- */
  function bindGlobalKeys() {
    document.addEventListener("keydown", function (e) {
      if (isEditing(e.target)) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      if (e.key === "Escape") {
        App_closeMenus && App_closeMenus();
        if (!refs.modalHost.hasAttribute("hidden")) closeModal();
        else State.select(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        var d = State.getSelected();
        if (d) {
          e.preventDefault();
          State.removeDevice(d.id);
        }
      }
    });
  }
  function isEditing(node) {
    if (!node) return false;
    var tag = node.tagName;
    return (
      node.isContentEditable ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    );
  }

  /* ---------- file import ---------- */
  function bindFileInput() {
    refs.fileInput.addEventListener("change", function () {
      var file = refs.fileInput.files && refs.fileInput.files[0];
      Persist.importFile(file).then(function (ok) {
        flash(ok ? "Project loaded" : "Could not read that file");
        refs.fileInput.value = "";
      });
    });
  }

  /* =================== modals =================== */
  function openModal(node) {
    refs.modalHost.innerHTML = "";
    refs.modalHost.appendChild(node);
    refs.modalHost.removeAttribute("hidden");
    // click backdrop to dismiss
    refs.modalHost.onmousedown = function (e) {
      if (e.target === refs.modalHost) closeModal();
    };
  }
  function closeModal() {
    refs.modalHost.setAttribute("hidden", "");
    refs.modalHost.innerHTML = "";
    refs.modalHost.onmousedown = null;
  }

  function modalShell(title, desc) {
    var modal = elx("div", "modal");
    modal.appendChild(elx("h2", null, title));
    if (desc) modal.appendChild(elx("p", null, desc));
    return modal;
  }
  function modalActions(modal, confirmLabel, danger, onConfirm) {
    var row = elx("div", "modal-actions");
    var cancel = elx("button", "btn", "Cancel");
    cancel.addEventListener("click", closeModal);
    var ok = elx("button", "btn " + (danger ? "btn-danger" : "btn-primary"), confirmLabel);
    ok.addEventListener("click", function () {
      if (onConfirm() !== false) closeModal();
    });
    row.appendChild(cancel);
    row.appendChild(ok);
    modal.appendChild(row);
  }

  // new project — guards against wiping current work
  function openNewProjectModal() {
    var modal = modalShell(
      "New project",
      "This replaces the current rack. Unsaved changes will be lost."
    );
    var field = elx("div", "modal-field");
    field.appendChild(elx("label", null, "Project name"));
    var input = document.createElement("input");
    input.type = "text";
    input.value = "Untitled rack";
    field.appendChild(input);
    modal.appendChild(field);
    modalActions(modal, "Create", false, function () {
      State.reset();
      State.setProjectName(input.value);
    });
    openModal(modal);
    setTimeout(function () {
      input.focus();
      input.select();
    }, 0);
  }

  // destructive confirmation — clear the rack
  function openClearRackModal() {
    var modal = modalShell(
      "Clear rack",
      "Remove every device from the rack? This can't be undone."
    );
    modalActions(modal, "Clear rack", true, function () {
      State.clearRack();
    });
    openModal(modal);
  }

  // add custom device — compose a line-art faceplate with a live preview
  function openCustomModal() {
    var modal = modalShell("Add custom device", "Compose its faceplate; it joins your library.");

    var name = labeledInput(modal, "Name", "text", "My device");
    var brand = labeledInput(modal, "Brand / model", "text", "");
    var u = labeledInput(modal, "Size (U)", "number", "1");
    u.min = 1;
    u.max = 12;

    // faceplate style
    var styleField = elx("div", "modal-field");
    styleField.appendChild(elx("label", null, "Faceplate style"));
    var sel = document.createElement("select");
    Faceplates.TEMPLATES.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.label;
      if (t.id === "comp") o.selected = true;
      sel.appendChild(o);
    });
    styleField.appendChild(sel);
    modal.appendChild(styleField);

    // detail
    var detailField = elx("div", "modal-field");
    detailField.appendChild(elx("label", null, "Detail"));
    var rng = document.createElement("input");
    rng.type = "range";
    rng.min = 1;
    rng.max = 10;
    rng.step = 1;
    rng.value = 5;
    rng.style.width = "100%";
    detailField.appendChild(rng);
    modal.appendChild(detailField);

    // color picker (palette swatches)
    var colorField = elx("div", "modal-field");
    colorField.appendChild(elx("label", null, "Faceplate colour"));
    var sw = elx("div", "swatches");
    var chosen = { color: Props.PALETTE[1] };
    Props.PALETTE.forEach(function (c, i) {
      var s = elx("div", "swatch" + (i === 1 ? " active" : ""));
      s.style.background = c;
      s.addEventListener("click", function () {
        chosen.color = c;
        sw.querySelectorAll(".swatch").forEach(function (x) {
          x.classList.remove("active");
        });
        s.classList.add("active");
        updatePreview();
      });
      sw.appendChild(s);
    });
    colorField.appendChild(sw);
    modal.appendChild(colorField);

    // live preview
    var previewField = elx("div", "modal-field");
    previewField.appendChild(elx("label", null, "Preview"));
    var preview = elx("div", "fp-preview");
    previewField.appendChild(preview);
    modal.appendChild(previewField);

    function currentFace() {
      return Faceplates.build(sel.value, parseInt(rng.value, 10));
    }
    function updatePreview() {
      var uu = Math.max(1, Math.min(12, parseInt(u.value, 10) || 1));
      preview.style.height = Math.max(34, Math.min(120, uu * 26)) + "px";
      preview.style.background = chosen.color;
      preview.style.color = Rack.textOn(chosen.color);
      preview.innerHTML = Faceplates.svg({
        name: name.value || "Device",
        u: uu,
        color: chosen.color,
        led: true,
        face: currentFace(),
      });
    }
    [name, u].forEach(function (i) {
      i.addEventListener("input", updatePreview);
    });
    sel.addEventListener("change", updatePreview);
    rng.addEventListener("input", updatePreview);

    modalActions(modal, "Add to library", false, function () {
      var nm = name.value.trim();
      if (!nm) {
        name.focus();
        return false; // keep modal open
      }
      State.addCustomDevice({
        cat: "Custom",
        name: nm,
        brand: brand.value.trim(),
        u: parseInt(u.value, 10) || 1,
        color: chosen.color,
        face: currentFace(),
      });
      flash("Added to library");
    });
    openModal(modal);
    updatePreview();
    setTimeout(function () {
      name.focus();
    }, 0);
  }

  function labeledInput(modal, label, type, value) {
    var field = elx("div", "modal-field");
    field.appendChild(elx("label", null, label));
    var input = document.createElement("input");
    input.type = type;
    input.value = value;
    field.appendChild(input);
    modal.appendChild(field);
    return input;
  }

  /* ---------- transient toast ---------- */
  var toastTimer = null;
  function flash(msg) {
    var t = byId("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.style.cssText =
        "position:fixed;bottom:18px;left:50%;transform:translateX(-50%);" +
        "background:var(--text-primary);color:var(--surface-0);padding:7px 14px;" +
        "border-radius:8px;font-size:12.5px;z-index:300;opacity:0;transition:opacity .15s;" +
        "pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.25);";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.style.opacity = "0";
    }, 1400);
  }

  /* ---------- helpers ---------- */
  function byId(id) {
    return document.getElementById(id);
  }
  function elx(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  return {
    start: start,
    get dragDef() {
      return App_dragDef;
    },
    set dragDef(v) {
      App_dragDef = v;
    },
    get dragMove() {
      return App_dragMove;
    },
    set dragMove(v) {
      App_dragMove = v;
    },
    flash: flash,
  };
})();

// transient globals used across closures (kept off the document state)
var App_dragDef = null;
var App_dragMove = null;
var App_closeMenus = null;

document.addEventListener("DOMContentLoaded", App.start);
