/* persist.js — storage behind a clean save() / load() interface.
 *
 * Everything that touches a backend lives here. Today the backend is
 * localStorage (single key) plus file-based JSON import/export. Swapping
 * to IndexedDB or a server is a one-file change: keep save()/load()'s
 * signature and rewrite the bodies.
 */
window.Persist = (function () {
  "use strict";

  var KEY = "open-rack-builder:v1";

  /* ---------- the swappable backend ---------- */
  function save() {
    try {
      localStorage.setItem(KEY, serialize());
      return true;
    } catch (e) {
      console.warn("save failed", e);
      return false;
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return false;
      State.replace(JSON.parse(raw));
      return true;
    } catch (e) {
      console.warn("load failed", e);
      return false;
    }
  }

  function hasSaved() {
    try {
      return !!localStorage.getItem(KEY);
    } catch (e) {
      return false;
    }
  }

  /* ---------- serialization ---------- */
  function serialize() {
    return JSON.stringify(State.get());
  }

  /* ---------- file export / import (full state dump) ---------- */
  function exportJSON() {
    var name = (State.get().projectName || "rack").replace(/[^\w.-]+/g, "_");
    var blob = new Blob([JSON.stringify(State.get(), null, 2)], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* reads a File, replaces document, returns a Promise<boolean> */
  function importFile(file) {
    return new Promise(function (resolve) {
      if (!file) return resolve(false);
      var reader = new FileReader();
      reader.onload = function () {
        try {
          State.replace(JSON.parse(reader.result));
          resolve(true);
        } catch (e) {
          console.warn("import failed", e);
          resolve(false);
        }
      };
      reader.onerror = function () {
        resolve(false);
      };
      reader.readAsText(file);
    });
  }

  return {
    save: save,
    load: load,
    hasSaved: hasSaved,
    exportJSON: exportJSON,
    importFile: importFile,
  };
})();
