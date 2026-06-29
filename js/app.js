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
    populateMenuKeys(); // append shortcut hints to menu items
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

    // community: live Supabase registry if configured, else static fallback
    Community.init();
    if (!Community.enabled()) loadCommunity();
  }

  // fetch the community device registry and merge it into the library.
  // Fails silently over file:// (no server) — built-ins still work.
  function loadCommunity() {
    if (!window.fetch) return;
    fetch("community-devices.json", { cache: "no-cache" })
      .then(function (r) {
        return r.ok ? r.json() : [];
      })
      .then(function (arr) {
        if (Array.isArray(arr) && arr.length) {
          Library.setCommunity(arr);
          Library.render(refs.libraryList, searchQuery);
        }
      })
      .catch(function () {});
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
    refs.deviceInput = byId("device-input");
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

  // re-render just the library list (used when community devices arrive async)
  function refreshLibrary() {
    Library.render(refs.libraryList, searchQuery);
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
    "import-device": function () {
      refs.deviceInput.click();
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
    "view-topology": function () {
      State.setView("topology");
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
    shortcuts: openShortcutsModal,
    "community-auth": function () {
      Community.toggleAuth();
    },
    "community-publish": function () {
      var d = State.getSelected();
      if (!d) {
        flash("Select a device to publish");
        return;
      }
      Community.publish(d);
    },
    "community-refresh": function () {
      Community.refresh();
      flash("Refreshing community library");
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

  /* ---------- keyboard shortcuts ---------- */
  // primary modifier: ⌘ on macOS, Ctrl elsewhere
  var IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");

  // single source of truth: chord → menu action. `mod` = ⌘/Ctrl.
  // `displayOnly` entries appear in menus + the cheat sheet but are dispatched
  // by the dedicated key logic below (so plain Delete / +/- keep working).
  var SHORTCUTS = [
    // File
    { action: "new-project",   mod: true,              key: "n",         label: "New project" },
    { action: "save",          mod: true,              key: "s",         label: "Save" },
    { action: "import",        mod: true,              key: "o",         label: "Open file" },
    { action: "export-json",   mod: true, shift: true, key: "s",         label: "Save a copy (.json)" },
    { action: "import-device", mod: true, shift: true, key: "i",         label: "Import device file" },
    // Edit
    { action: "remove-selected", displayOnly: true,    key: "Backspace", label: "Remove selected device" },
    { action: "deselect",        displayOnly: true,    key: "Escape",    label: "Deselect" },
    { action: "clear-rack",    mod: true, shift: true, key: "Backspace", label: "Clear rack" },
    // View
    { action: "view-front",    key: "1", label: "Front view" },
    { action: "view-rear",     key: "2", label: "Rear view" },
    { action: "view-side",     key: "3", label: "Side view" },
    { action: "view-topology", key: "4", label: "Topology view" },
    { action: "zoom-reset",    key: "0", label: "Reset zoom" },
    { action: "toggle-theme",  key: "t", label: "Toggle light / dark" },
    // Rack
    { action: "add-u",    displayOnly: true, key: "+", label: "Add 1U" },
    { action: "remove-u", displayOnly: true, key: "-", label: "Remove 1U" },
    // Export
    { action: "export-pdf", mod: true, key: "p", label: "Print / PDF" },
    // Help
    { action: "shortcuts", displayOnly: true, key: "?", label: "Keyboard shortcuts" },
  ];

  // global keys not tied to a menu action (shown in the cheat sheet's "More")
  var EXTRA_SHORTCUTS = [
    { keys: "/", label: "Focus device search" },
    { keys: IS_MAC ? "↑ ↓" : "Up / Down", label: "Move selected device up / down" },
    { keys: "?", label: "Show this shortcut list" },
  ];

  function shortcutFor(action) {
    for (var i = 0; i < SHORTCUTS.length; i++) {
      if (SHORTCUTS[i].action === action) return SHORTCUTS[i];
    }
    return null;
  }
  function keyGlyph(k) {
    if (k === "Backspace") return "⌫";
    if (k === "Escape") return "esc";
    if (k === "ArrowUp") return "↑";
    if (k === "ArrowDown") return "↓";
    return k.length === 1 ? k.toUpperCase() : k;
  }
  function chordText(sc) {
    var parts = [];
    if (sc.mod) parts.push(IS_MAC ? "⌘" : "Ctrl");
    if (sc.shift) parts.push(IS_MAC ? "⇧" : "Shift");
    parts.push(keyGlyph(sc.key));
    return parts.join(IS_MAC ? "" : "+");
  }
  function chordMatches(e, sc) {
    if (sc.displayOnly) return false;
    if (!!sc.mod !== (e.metaKey || e.ctrlKey)) return false;
    if (!!sc.shift !== e.shiftKey) return false;
    return e.key.toLowerCase() === sc.key.toLowerCase();
  }

  // append the chord hint to each menu item that has one
  function populateMenuKeys() {
    var btns = refs.menubar.querySelectorAll("button[data-action]");
    Array.prototype.forEach.call(btns, function (b) {
      var sc = shortcutFor(b.dataset.action);
      if (!sc) return;
      var span = document.createElement("span");
      span.className = "menu-key";
      span.textContent = chordText(sc);
      b.appendChild(span);
    });
  }

  function bindGlobalKeys() {
    document.addEventListener("keydown", function (e) {
      if (isEditing(e.target)) {
        if (e.key === "Escape") e.target.blur();
        return;
      }

      // while a modal is open, only Escape (to dismiss it) is live
      if (!refs.modalHost.hasAttribute("hidden")) {
        if (e.key === "Escape") closeModal();
        return;
      }

      // 1) menu-action chords (⌘S, 1/2/3, T, …)
      for (var i = 0; i < SHORTCUTS.length; i++) {
        if (chordMatches(e, SHORTCUTS[i])) {
          e.preventDefault();
          App_closeMenus && App_closeMenus();
          runAction(SHORTCUTS[i].action);
          return;
        }
      }

      // 2) keys with custom handling
      var mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        App_closeMenus && App_closeMenus();
        if (!refs.modalHost.hasAttribute("hidden")) closeModal();
        else State.select(null);
      } else if (e.key === "?") {
        e.preventDefault();
        openShortcutsModal();
      } else if (e.key === "/" && !mod) {
        e.preventDefault();
        refs.search.focus();
        refs.search.select();
      } else if (!mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        State.addU(1);
      } else if (!mod && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        State.addU(-1);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        var d = State.getSelected();
        if (d) {
          e.preventDefault();
          State.removeDevice(d.id);
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        var sel = State.getSelected();
        if (sel) {
          e.preventDefault();
          State.nudge(sel.id, e.key === "ArrowUp" ? -1 : 1);
        }
      }
    });
  }

  // cheat sheet listing every shortcut, grouped by menu
  function openShortcutsModal() {
    if (refs.modalHost && !refs.modalHost.hasAttribute("hidden")) return;
    var modal = modalShell("Keyboard shortcuts", null);
    modal.classList.add("modal-shortcuts");

    var groups = [
      { title: "File", actions: ["new-project", "save", "import", "export-json", "import-device"] },
      { title: "Edit", actions: ["remove-selected", "deselect", "clear-rack"] },
      { title: "View", actions: ["view-front", "view-rear", "view-side", "view-topology", "zoom-reset", "toggle-theme"] },
      { title: "Rack", actions: ["add-u", "remove-u"] },
      { title: "Export", actions: ["export-pdf"] },
    ];
    groups.forEach(function (g) {
      modal.appendChild(elx("div", "sc-group", g.title));
      g.actions.forEach(function (a) {
        var sc = shortcutFor(a);
        if (sc) modal.appendChild(scRow(sc.label, chordText(sc)));
      });
    });
    modal.appendChild(elx("div", "sc-group", "More"));
    EXTRA_SHORTCUTS.forEach(function (x) {
      modal.appendChild(scRow(x.label, x.keys));
    });

    var row = elx("div", "modal-actions");
    var ok = elx("button", "btn btn-primary", "Done");
    ok.addEventListener("click", closeModal);
    row.appendChild(ok);
    modal.appendChild(row);
    openModal(modal);
  }
  function scRow(label, keys) {
    var r = elx("div", "sc-row");
    r.appendChild(elx("span", "sc-label", label));
    var kb = elx("kbd", "sc-keys", keys);
    r.appendChild(kb);
    return r;
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
    refs.deviceInput.addEventListener("change", function () {
      var file = refs.deviceInput.files && refs.deviceInput.files[0];
      Persist.importDeviceFile(file).then(function (ok) {
        flash(ok ? "Device added to your library" : "Could not read that device file");
        refs.deviceInput.value = "";
      });
    });
  }

  /* open a prefilled GitHub issue to submit a device to the shared registry.
     Images are deliberately excluded — only metadata is shared publicly, so a
     user's locally-framed illustrations never end up in the public repo. */
  function contributeDevice(device) {
    // live backend on? publish straight to the shared library (prompts a
    // Google sign-in if needed). Otherwise fall back to the GitHub flow.
    if (Community.enabled()) {
      Community.publish(device);
      return;
    }
    var data = Persist.deviceJSON(device, false);
    var json = JSON.stringify(data, null, 2);
    var title = "Device: " + (data.brand ? data.brand + " " : "") + data.name;
    var body =
      "A device for the community library. A maintainer adds this object to " +
      "`community-devices.json`.\n\n```json\n" + json + "\n```\n";
    var url =
      "https://github.com/7luk/open-rack-builder/issues/new?labels=device-submission" +
      "&title=" + encodeURIComponent(title) +
      "&body=" + encodeURIComponent(body);
    window.open(url, "_blank");
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

  // add custom device — metadata + colour; frame its illustration after placing
  function openCustomModal() {
    var modal = modalShell(
      "Add custom device",
      "Adds it to your library. Place it, then frame its real illustration from the properties panel."
    );

    var name = labeledInput(modal, "Name", "text", "My device");
    var brand = labeledInput(modal, "Brand / model", "text", "");
    var u = labeledInput(modal, "Size (U)", "number", "1");
    u.min = 1;
    u.max = 12;
    var depth = labeledInput(modal, "Depth (mm)", "number", "250");
    depth.min = 20;
    depth.max = 2000;

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

    // live preview of the placeholder panel
    var previewField = elx("div", "modal-field");
    previewField.appendChild(elx("label", null, "Preview"));
    var preview = elx("div", "fp-preview");
    previewField.appendChild(preview);
    modal.appendChild(previewField);

    function updatePreview() {
      var uu = Math.max(1, Math.min(12, parseInt(u.value, 10) || 1));
      preview.style.height = Math.max(34, Math.min(120, uu * 26)) + "px";
      preview.style.background = chosen.color;
      preview.style.color = Rack.textOn(chosen.color);
      preview.innerHTML = "";
      preview.appendChild(
        Faceplates.render(
          { name: name.value || "Device", brand: brand.value, u: uu, color: chosen.color },
          "front"
        )
      );
    }
    [name, brand, u].forEach(function (i) {
      i.addEventListener("input", updatePreview);
    });

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
        depth: parseInt(depth.value, 10) || 250,
        color: chosen.color,
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
    contributeDevice: contributeDevice,
    flash: flash,
    refreshLibrary: refreshLibrary,
  };
})();

// transient globals used across closures (kept off the document state)
var App_dragDef = null;
var App_dragMove = null;
var App_closeMenus = null;

document.addEventListener("DOMContentLoaded", App.start);
