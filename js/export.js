/* export.js — multi-page PDF export via a print window.
 *
 * Opens a new window with clean, self-contained HTML (no shared styles, so it
 * prints identically anywhere) and triggers the browser's print dialog, where
 * the user can "Save as PDF".
 *
 *   Page 1 — components table (spreadsheet-style grid)
 *   Page 2 — front and rear renders of the rack, side by side
 *   Page 3 — signal topology, blueprint style
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
      pageTopology(s) +
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
      cablesTable(s) +
      "<footer>Open Rack Builder — page 1 of 3 · components &amp; cables</footer>" +
      "</section>"
    );
  }

  /* cables summary table with estimated lengths (page 1) */
  function cablesTable(s) {
    if (!s.cables || !s.cables.length) return "";
    var rows = s.cables
      .map(function (c, i) {
        var da = State.byId(c.a.dev),
          db = State.byId(c.b.dev);
        if (!da || !db) return "";
        var pa = da.ports[c.a.port],
          pb = db.ports[c.b.port];
        var std = State.cableStandardM(State.cableLengthMm(c));
        return (
          "<tr><td class='c'>" + (i + 1) + "</td>" +
          "<td><span class='swatch' style='background:" + esc(window.Ports.color(c.type)) + "'></span> " +
          esc(window.Ports.label(c.type)) + "</td>" +
          "<td>" + esc(da.name) + " · " + esc(pa ? pa.label : "?") + "</td>" +
          "<td>" + esc(db.name) + " · " + esc(pb ? pb.label : "?") + "</td>" +
          "<td class='c'>" + std + " m</td></tr>"
        );
      })
      .join("");
    var total = s.cables.reduce(function (sum, c) {
      return sum + State.cableStandardM(State.cableLengthMm(c));
    }, 0);
    return (
      "<h2 class='subhead'>Cables</h2>" +
      "<table class='grid'><thead><tr>" +
      "<th class='c'>#</th><th>Type</th><th>From</th><th>To</th><th class='c'>Length</th>" +
      "</tr></thead><tbody>" + rows + "</tbody><tfoot><tr>" +
      "<td colspan='5'>" + s.cables.length + " cable" + (s.cables.length === 1 ? "" : "s") +
      " · ≈" + (Math.round(total * 10) / 10) + " m total (standard lengths)</td>" +
      "</tr></tfoot></table>"
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
          faceHTML(d, side, true) +
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

  /* a device faceplate for the PDF: its framed image, or a labelled blank */
  function faceHTML(d, side, simple) {
    var src = simple ? null : (side === "rear" ? d.imageRear : d.image);
    if (src) return "<img class='pdf-fp' src='" + esc(src) + "' alt=''/>";
    if (side === "rear") {
      var ports = (d.rearLabel || "")
        .split(",")
        .map(function (x) { return x.trim(); })
        .filter(Boolean);
      if (ports.length) {
        return (
          "<div class='pdf-blank pdf-rear'>" +
          ports.map(function (p) { return "<span class='pdf-port'>" + esc(p) + "</span>"; }).join("") +
          "</div>"
        );
      }
    }
    return (
      "<div class='pdf-blank'><span class='pdf-bname'>" +
      esc(d.name) +
      "</span>" +
      (d.brand ? "<span class='pdf-bbrand'>" + esc(d.brand) + "</span>" : "") +
      "</div>"
    );
  }

  /* ---------- Page 3: signal topology (blueprint) ----------
     Laid out exactly as arranged in the app (custom node positions + cables),
     computed analytically since there's no live DOM to measure. */
  var T_NODE_W = 188,
    T_HEAD_H = 38,
    T_ROW_H = 22,
    T_PAD = 6;

  function pageTopology(s) {
    var n = s.cables ? s.cables.length : 0;
    return (
      "<section class='page page-break blueprint'>" +
      "<header><h1>" + esc(s.projectName) + "</h1>" +
      "<div class='meta'>Signal topology · " + n + " cable" + (n === 1 ? "" : "s") + "</div></header>" +
      topoCanvas(s) +
      "<footer>Open Rack Builder — page 3 of 3 · topology</footer>" +
      "</section>"
    );
  }

  function topoNodeHeight(nPorts) {
    return T_HEAD_H + T_PAD * 2 + nPorts * T_ROW_H;
  }

  function topoCanvas(s) {
    if (!s.devices.length) return "<div class='bp-empty'>No devices placed.</div>";

    // 1) lay out nodes: custom topoX/topoY, else a default stacked column
    var nodes = [],
      defX = 48,
      cursorY = 48,
      maxX = 0,
      maxY = 0;
    s.devices
      .slice()
      .sort(function (a, b) { return a.slot - b.slot; })
      .forEach(function (d) {
        var ports = pdfPorts(d);
        var h = topoNodeHeight(ports.list.length);
        var placed = typeof d.topoX === "number" && typeof d.topoY === "number";
        var x = placed ? d.topoX : defX;
        var y = placed ? d.topoY : cursorY;
        if (!placed) cursorY += h + 26;
        nodes.push({ d: d, ports: ports, x: x, y: y });
        maxX = Math.max(maxX, x + T_NODE_W);
        maxY = Math.max(maxY, y + h);
      });

    // 2) pin coordinates per device/port (left + right)
    var pin = {};
    nodes.forEach(function (n) {
      n.ports.list.forEach(function (p, i) {
        var cy = n.y + T_HEAD_H + T_PAD + i * T_ROW_H + T_ROW_H / 2;
        pin[n.d.id + "|" + i] = { l: { x: n.x, y: cy }, r: { x: n.x + T_NODE_W, y: cy } };
      });
    });

    // 3) cables: pick the closest pin pair, draw a bezier coloured by type
    var paths = (s.cables || [])
      .map(function (c) {
        var A = pin[c.a.dev + "|" + c.a.port],
          B = pin[c.b.dev + "|" + c.b.port];
        if (!A || !B) return "";
        var best = null,
          bd = Infinity;
        ["l", "r"].forEach(function (sa) {
          ["l", "r"].forEach(function (sb) {
            var dd = (B[sb].x - A[sa].x) * (B[sb].x - A[sa].x) + (B[sb].y - A[sa].y) * (B[sb].y - A[sa].y);
            if (dd < bd) {
              bd = dd;
              best = { ax: A[sa].x, ay: A[sa].y, bx: B[sb].x, by: B[sb].y };
            }
          });
        });
        var dx = Math.max(30, Math.abs(best.bx - best.ax) * 0.5);
        var d =
          "M" + best.ax + "," + best.ay + " C" + (best.ax + dx) + "," + best.ay +
          " " + (best.bx - dx) + "," + best.by + " " + best.bx + "," + best.by;
        return "<path d='" + d + "' fill='none' stroke='" + esc(window.Ports.color(c.type)) + "' stroke-width='2.5' stroke-linecap='round'/>";
      })
      .join("");
    var w = maxX + 48,
      h = maxY + 48;
    var svg = "<svg class='bp-cables' width='" + w + "' height='" + h + "'>" + paths + "</svg>";

    // 4) nodes
    var nodesHtml = nodes
      .map(function (n) {
        var rows = n.ports.list
          .map(function (p) {
            var col = esc(window.Ports.color(p.type));
            var lab = (p.dir === "in" ? "◂ " : "") + p.label + (p.dir === "out" ? " ▸" : "");
            var dot = "<span class='bp-pin' style='background:" + col + ";border-color:" + col + "'></span>";
            return "<div class='bp-port'>" + dot + "<span class='bp-plabel'>" + esc(lab) + "</span>" + dot + "</div>";
          })
          .join("");
        return (
          "<div class='bp-node' style='left:" + n.x + "px;top:" + n.y + "px;width:" + T_NODE_W + "px'>" +
          "<div class='bp-node-head'>" + esc(n.d.name) +
          (n.d.brand ? "<span class='bp-node-brand'>" + esc(n.d.brand) + "</span>" : "") +
          "</div><div class='bp-ports" + (n.ports.generic ? " generic" : "") + "'>" + rows + "</div></div>"
        );
      })
      .join("");

    return "<div class='topo-canvas' style='width:" + w + "px;height:" + h + "px'>" + svg + nodesHtml + "</div>";
  }

  // structured ports for the PDF (mirrors the in-app topology logic)
  function pdfPorts(d) {
    if (d.ports && d.ports.length) {
      return {
        list: d.ports.map(function (p) { return { type: p.type, dir: p.dir || "io", label: p.label }; }),
        generic: false,
      };
    }
    var raw = (d.rearLabel || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    if (raw.length) {
      return { list: raw.map(function (l) { return { type: "other", dir: "io", label: l }; }), generic: false };
    }
    var u = d.u || 1;
    var gen =
      u >= 3 ? ["In 1", "In 2", "In 3", "Out 1", "Out 2", "Out 3"]
      : u === 2 ? ["In 1", "In 2", "Out 1", "Out 2"]
      : ["In", "Out"];
    return {
      list: gen.map(function (l) {
        return { type: "other", dir: /out/i.test(l) ? "out" : /in/i.test(l) ? "in" : "io", label: l };
      }),
      generic: true,
    };
  }

  /* ---------- styles ---------- */
  function css() {
    return [
      "*{box-sizing:border-box}",
      "body{font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#1d1d1f;margin:0;}",
      ".page{padding:40px;min-height:100vh;position:relative;}",
      "header{margin-bottom:20px;}",
      "h1{font-size:20px;font-weight:600;margin:0 0 4px;}",
      "h2.subhead{font-size:13px;font-weight:600;margin:22px 0 0;}",
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
      ".pdf-fp{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}",
      ".pdf-blank{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:0 8px;text-align:center;overflow:hidden;}",
      ".pdf-blank.pdf-rear{flex-direction:row;flex-wrap:wrap;align-content:center;gap:3px;}",
      ".pdf-bname{font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}",
      ".pdf-bbrand{font-size:8px;opacity:.72;}",
      ".pdf-port{font-size:7px;line-height:1.5;border:1px solid currentColor;border-radius:2px;padding:0 3px;opacity:.85;white-space:nowrap;}",
      ".casters{display:flex;justify-content:space-between;padding:2px 14px 0;margin-top:2px;}",
      ".caster{width:22px;height:22px;border-radius:50%;border:1.5px solid #1d1d1f;background:#f6f6f8;}",
      // blueprint topology page — monochrome graph paper (print-friendly)
      ".blueprint{background-color:#fff;color:#1d1d1f;-webkit-print-color-adjust:exact;print-color-adjust:exact;" +
        "background-image:" +
        "linear-gradient(#ececef 1px,transparent 1px)," +
        "linear-gradient(90deg,#ececef 1px,transparent 1px)," +
        "linear-gradient(#d8d8de 1px,transparent 1px)," +
        "linear-gradient(90deg,#d8d8de 1px,transparent 1px);" +
        "background-size:26px 26px,26px 26px,130px 130px,130px 130px;}",
      ".blueprint h1{color:#1d1d1f;}",
      ".blueprint .meta{color:#86868b;}",
      ".blueprint footer{color:#aeaeb2;}",
      // absolute-positioned canvas matching the app's topology layout
      ".topo-canvas{position:relative;margin-top:16px;}",
      ".bp-cables{position:absolute;top:0;left:0;overflow:visible;}",
      ".bp-node{position:absolute;background:#fff;border:1px solid #c8c8d0;border-radius:9px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);}",
      // fixed heads/rows so the analytic pin coordinates line up with the cables
      ".bp-node-head{height:38px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:1px;padding:0 12px;border-bottom:1px solid #e3e3e8;font-weight:600;font-size:12px;}",
      ".bp-node-brand{font-size:9.5px;color:#86868b;font-weight:400;}",
      ".bp-ports{padding:6px 0;}",
      ".bp-port{height:22px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px;}",
      ".bp-plabel{flex:1 1 auto;text-align:center;font-size:10px;color:#3a3a3e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".bp-ports.generic .bp-plabel{color:#9a9aa0;font-style:italic;}",
      ".bp-pin{flex:0 0 auto;width:8px;height:8px;border-radius:50%;border:1.5px solid #8a8a90;background:#fff;}",
      ".bp-empty{color:#86868b;padding:30px 0;}",
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
