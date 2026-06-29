/* export.js — multi-page PDF export via a print window.
 *
 * Opens a new window with clean, self-contained HTML (no shared styles, so it
 * prints identically anywhere) and triggers the browser's print dialog, where
 * the user can "Save as PDF".
 *
 *   Page 1 — components table (spreadsheet-style grid)
 *   Page 2 — front and rear renders of the rack, side by side
 *   Page 3 — reserved for future content
 */
window.Exporter = (function () {
  "use strict";

  // faceplate aspect: 19" wide × 1.75" per U  →  width / height-per-U
  var U_ASPECT = 19 / 1.75;

  function exportPDF() {
    var s = State.get();
    var win = window.open("", "_blank", "width=860,height=900");
    if (!win) {
      alert("Please allow pop-ups to export a PDF.");
      return;
    }
    win.document.open();
    win.document.write(buildHTML(s));
    win.document.close();
    // let layout settle, then print
    win.focus();
    win.onload = function () {
      win.print();
    };
  }

  function buildHTML(s) {
    return (
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>" +
      esc(s.projectName) +
      "</title><style>" +
      css() +
      "</style></head><body>" +
      pageTable(s) +
      pageRenders(s) +
      pageFuture(s) +
      "</body></html>"
    );
  }

  /* ---------- Page 1: components table ---------- */
  function pageTable(s) {
    var usedU = s.devices.reduce(function (sum, d) {
      return sum + d.u;
    }, 0);
    var freeU = Math.max(0, s.rack.size - usedU);

    return (
      "<section class='page'>" +
      "<header><h1>" +
      esc(s.projectName) +
      "</h1><div class='meta'>" +
      s.rack.size +
      "U rack · numbering " +
      (s.rack.direction === "top-down" ? "top → bottom" : "bottom → top") +
      " · start U" +
      s.rack.startUnit +
      " · " +
      s.rack.depth +
      " mm deep" +
      (s.rack.wheels ? " · on wheels" : "") +
      "</div></header>" +
      "<table class='grid'><thead><tr>" +
      "<th class='c'>#</th><th class='c'>U range</th><th class='c'>Size</th>" +
      "<th>Device</th><th>Brand / model</th><th class='c'>Faceplate</th>" +
      "</tr></thead><tbody>" +
      deviceRows(s) +
      "</tbody><tfoot><tr>" +
      "<td colspan='6'>" +
      s.devices.length +
      " device" +
      (s.devices.length === 1 ? "" : "s") +
      " · " +
      usedU +
      "U used · " +
      freeU +
      "U free of " +
      s.rack.size +
      "U</td></tr></tfoot></table>" +
      "<footer>Open Rack Builder — page 1 of 3 · components</footer>" +
      "</section>"
    );
  }

  function deviceRows(s) {
    if (!s.devices.length) {
      return "<tr><td colspan='6' class='empty'>No devices placed.</td></tr>";
    }
    // sort by on-screen reading order (top row first)
    var sorted = s.devices.slice().sort(function (a, b) {
      return a.slot - b.slot;
    });
    return sorted
      .map(function (d, i) {
        var top = State.displayNumber(d.slot);
        var bottom = State.displayNumber(d.slot + d.u - 1);
        var lo = Math.min(top, bottom);
        var hi = Math.max(top, bottom);
        var range = lo === hi ? "U" + lo : "U" + lo + "–" + hi;
        return (
          "<tr><td class='c'>" +
          (i + 1) +
          "</td><td class='c'>" +
          range +
          "</td><td class='c'>" +
          d.u +
          "U</td><td>" +
          esc(d.name) +
          "</td><td>" +
          esc(d.brand || "—") +
          "</td><td class='c'><span class='swatch' style='background:" +
          esc(d.color) +
          "'></span></td></tr>"
        );
      })
      .join("");
  }

  /* ---------- Page 2: front + rear renders ---------- */
  function pageRenders(s) {
    // shrink the per-U row so even tall racks fit on one page
    var rowH = Math.max(10, Math.min(30, Math.floor(560 / s.rack.size)));
    return (
      "<section class='page page-break'>" +
      "<header><h1>" +
      esc(s.projectName) +
      "</h1><div class='meta'>Front &amp; rear elevation · " +
      s.rack.size +
      "U</div></header>" +
      "<div class='renders'>" +
      rackColumn(s, "front", rowH) +
      rackColumn(s, "rear", rowH) +
      "</div>" +
      "<footer>Open Rack Builder — page 2 of 3 · elevations</footer>" +
      "</section>"
    );
  }

  /* one labelled rack elevation (front or rear) */
  function rackColumn(s, side, rowH) {
    var faceW = Math.round(rowH * U_ASPECT);
    var gutter = 20;
    var plateW = faceW + gutter;
    var stackH = s.rack.size * rowH;

    // U number labels for every physical row
    var rails = "";
    for (var row = 1; row <= s.rack.size; row++) {
      rails +=
        "<div class='unum' style='top:" +
        (row - 1) * rowH +
        "px;height:" +
        rowH +
        "px'>" +
        State.displayNumber(row) +
        "</div>";
    }

    // devices, positioned by their top physical row
    var devs = s.devices
      .map(function (d) {
        var color = d.color || "#2a2a2e";
        return (
          "<div class='dev' style='top:" +
          (d.slot - 1) * rowH +
          "px;left:" +
          gutter +
          "px;width:" +
          faceW +
          "px;height:" +
          d.u * rowH +
          "px;background:" +
          esc(color) +
          ";color:" +
          textOn(color) +
          "'>" +
          Faceplates.svg(d, side) +
          "</div>"
        );
      })
      .join("");

    var wheels = s.rack.wheels
      ? "<div class='casters' style='width:" +
        plateW +
        "px'><span class='caster'></span><span class='caster'></span></div>"
      : "";

    return (
      "<div class='render-col'>" +
      "<div class='render-cap'>" +
      (side === "front" ? "Front" : "Rear") +
      "</div>" +
      "<div class='plate' style='width:" +
      plateW +
      "px;height:" +
      stackH +
      "px'>" +
      rails +
      devs +
      "</div>" +
      wheels +
      "</div>"
    );
  }

  /* ---------- Page 3: reserved ---------- */
  function pageFuture(s) {
    return (
      "<section class='page page-break'>" +
      "<header><h1>" +
      esc(s.projectName) +
      "</h1><div class='meta'>Notes</div></header>" +
      "<div class='reserved'>Reserved for future content</div>" +
      "<footer>Open Rack Builder — page 3 of 3</footer>" +
      "</section>"
    );
  }

  /* ---------- styles ---------- */
  function css() {
    return [
      "*{box-sizing:border-box}",
      "body{font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#1d1d1f;margin:0;}",
      ".page{padding:40px;min-height:100vh;position:relative;}",
      "header{margin-bottom:20px;}",
      "h1{font-size:20px;font-weight:600;margin:0 0 4px;}",
      ".meta{color:#86868b;font-size:12px;}",
      // table (spreadsheet grid)
      "table.grid{width:100%;border-collapse:collapse;margin-top:8px;border:1px solid #c8c8d0;}",
      "table.grid th,table.grid td{text-align:left;padding:7px 10px;border:1px solid #d8d8df;font-size:12.5px;}",
      "table.grid th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b6b70;font-weight:600;background:#f1f1f4;border-color:#c8c8d0;}",
      "table.grid tbody tr:nth-child(even){background:#fafafb;}",
      ".c{text-align:center;}",
      "td.c{font-variant-numeric:tabular-nums;}",
      "tfoot td{font-weight:600;background:#f1f1f4;}",
      ".empty{color:#86868b;text-align:center;padding:24px;}",
      ".swatch{display:inline-block;width:26px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.25);vertical-align:middle;}",
      // renders
      ".renders{display:flex;gap:48px;justify-content:center;align-items:flex-start;margin-top:10px;}",
      ".render-col{display:flex;flex-direction:column;align-items:center;}",
      ".render-cap{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b6b70;font-weight:600;margin-bottom:8px;}",
      ".plate{position:relative;background:#f6f6f8;border:1px solid #1d1d1f;border-radius:8px;overflow:hidden;}",
      ".unum{position:absolute;left:0;width:20px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#aeaeb2;font-variant-numeric:tabular-nums;border-right:1px solid #e3e3e8;}",
      ".dev{position:absolute;border:1px solid rgba(0,0,0,.4);border-radius:3px;overflow:hidden;}",
      ".dev .fp{position:absolute;inset:0;width:100%;height:100%;display:block;}",
      ".dev svg *{vector-effect:non-scaling-stroke;}",
      ".casters{display:flex;justify-content:space-between;padding:2px 14px 0;margin-top:2px;}",
      ".caster{width:22px;height:22px;border-radius:50%;border:1.5px solid #1d1d1f;background:#f6f6f8;}",
      // reserved page
      ".reserved{display:flex;align-items:center;justify-content:center;height:60vh;color:#c0c0c6;font-size:14px;letter-spacing:.04em;border:1.5px dashed #dcdce2;border-radius:12px;margin-top:10px;}",
      // footer
      "footer{position:absolute;left:40px;bottom:24px;color:#aeaeb2;font-size:11px;}",
      // pagination
      ".page-break{break-before:page;page-break-before:always;}",
      "@page{margin:0;}",
      "@media print{.page{min-height:auto;}}",
    ].join("");
  }

  /* readable stroke colour on a faceplate background */
  function textOn(hex) {
    var c = String(hex || "").replace("#", "");
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = parseInt(c.slice(0, 2), 16) || 0;
    var g = parseInt(c.slice(2, 4), 16) || 0;
    var b = parseInt(c.slice(4, 6), 16) || 0;
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? "#1d1d1f" : "#f5f5f7";
  }

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  return { exportPDF: exportPDF };
})();
