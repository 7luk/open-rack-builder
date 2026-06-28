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

  /* ---------- file download helper ---------- */
  function download(text, filename) {
    var blob = new Blob([text], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function safe(name) {
    return (name || "rack").replace(/[^\w.-]+/g, "_");
  }

  /* ---------- file export / import (full state dump) ---------- */
  function exportJSON() {
    download(JSON.stringify(State.get(), null, 2), safe(State.get().projectName) + ".json");
  }

  /* ---------- single device, as a portable, shareable object ---------- */
  /* The faceplate is resolved to a concrete spec so the device is fully
     self-contained — it carries its own line art, no code dependency. */
  function deviceJSON(device) {
    return {
      cat: device.cat || "Community",
      name: device.name || "Device",
      brand: device.brand || "",
      u: device.u || 1,
      color: device.color || "#2a2a2e",
      face: { spec: Faceplates.resolveSpec(device) },
    };
  }
  function exportDevice(device) {
    var d = deviceJSON(device);
    download(JSON.stringify(d, null, 2), safe((d.brand ? d.brand + "-" : "") + d.name) + ".device.json");
  }
  /* read a device file and add it to the user's custom library */
  function importDeviceFile(file) {
    return new Promise(function (resolve) {
      if (!file) return resolve(false);
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var d = JSON.parse(reader.result);
          State.addCustomDevice({
            cat: d.cat || "Custom",
            name: d.name,
            brand: d.brand,
            u: d.u,
            color: d.color,
            face: d.face,
          });
          resolve(true);
        } catch (e) {
          resolve(false);
        }
      };
      reader.onerror = function () {
        resolve(false);
      };
      reader.readAsText(file);
    });
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
    deviceJSON: deviceJSON,
    exportDevice: exportDevice,
    importDeviceFile: importDeviceFile,
  };
})();
