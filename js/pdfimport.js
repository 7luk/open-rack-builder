/* pdfimport.js — generate a device faceplate from a PDF the user supplies.
 *
 * Entirely local: the PDF is parsed in the browser (pdf.js), the user navigates
 * to the page, crops the front and/or rear region (locked to the faceplate
 * aspect), optionally vectorises it to clean SVG line art (ImageTracer), and the
 * result is stored on the device in the local project. Nothing is uploaded, and
 * nothing is bundled into the repository — the user is responsible for using
 * material they have the right to use.
 *
 * pdf.js and ImageTracer are vendored static files, loaded on first use so the
 * base app stays light.
 */
window.PdfImport = (function () {
  "use strict";

  var V = "?v=7";
  var loaded = false;

  function ensureLibs() {
    if (loaded) return Promise.resolve();
    return loadScript("vendor/pdf.min.js" + V, function () { return window.pdfjsLib; })
      .then(function () {
        var pdfjs = window.pdfjsLib;
        pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js" + V;
        // Run the parser on the MAIN THREAD (no Web Worker). A normal browser
        // can't construct a Worker from a file:// URL, so a worker would break
        // the tool when index.html is opened locally. Preloading the worker
        // code as a plain script + disabling the worker keeps it working both
        // locally and on GitHub Pages.
        return loadScript("vendor/pdf.worker.min.js" + V, function () { return window.pdfjsWorker; })
          .then(function () {
            if (pdfjs.PDFWorkerUtil) pdfjs.PDFWorkerUtil.isWorkerDisabled = true;
          });
      })
      .then(function () {
        return loadScript("vendor/imagetracer.js" + V, function () { return window.ImageTracer; });
      })
      .then(function () { loaded = true; });
  }
  function loadScript(src, ready) {
    return new Promise(function (resolve, reject) {
      if (ready()) return resolve();
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------- public entry ---------- */
  function open(deviceId) {
    var device = State.byId(deviceId);
    if (!device) return;
    App.flash("Loading PDF tools…");
    ensureLibs()
      .then(function () { build(device); })
      .catch(function (e) {
        console.warn(e);
        App.flash("Couldn't load the PDF tools");
      });
  }

  /* ---------- modal ---------- */
  function build(device) {
    var faceAspect = Faceplates.ASPECT / device.u; // width : height
    var pdfDoc = null;
    var pageCanvas = document.createElement("canvas"); // full-res render of the page
    var disp = { w: 0, h: 0, scale: 1 }; // displayed page size + canvas→display scale
    var crop = { x: 0, y: 0, w: 0, h: 0 };
    var captured = { front: device.image || null, rear: device.imageRear || null };
    var pageNum = 1;
    var curPage = null, curViewport = null; // kept so we can read the text layer

    var modal = el("div", "modal modal-pdf");
    modal.appendChild(el("h2", null, "Faceplate from PDF — " + (device.name || "device")));
    modal.appendChild(
      el("p", null,
        "Load a PDF you have the right to use (a manual or datasheet). Pick the page, " +
        "drag the box over the front or rear, capture each. Capturing the rear also reads " +
        "the port labels from the PDF's text. It all stays on your device.")
    );

    /* --- picker (shown first) --- */
    var pick = el("div", "pdf-pick");
    pick.innerHTML =
      "<strong>Choose or drop a PDF</strong><span>parsed locally — nothing is uploaded</span>";
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/pdf,.pdf";
    fileInput.style.display = "none";
    pick.addEventListener("click", function () { fileInput.click(); });
    pick.addEventListener("dragover", function (e) { e.preventDefault(); pick.classList.add("drop"); });
    pick.addEventListener("dragleave", function () { pick.classList.remove("drop"); });
    pick.addEventListener("drop", function (e) {
      e.preventDefault();
      pick.classList.remove("drop");
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
    });
    modal.appendChild(pick);
    modal.appendChild(fileInput);

    /* --- work area (hidden until a PDF is loaded) --- */
    var work = el("div", "pdf-work");
    work.hidden = true;

    // pager
    var pager = el("div", "pdf-pager");
    var prev = el("button", "btn", "◀");
    var pageField = document.createElement("input");
    pageField.type = "number";
    pageField.min = 1;
    pageField.value = 1;
    pageField.className = "pdf-pagenum";
    var pageTotal = el("span", "pdf-pagetotal", "/ 1");
    var next = el("button", "btn", "▶");
    prev.addEventListener("click", function () { goPage(pageNum - 1); });
    next.addEventListener("click", function () { goPage(pageNum + 1); });
    pageField.addEventListener("change", function () { goPage(parseInt(pageField.value, 10) || 1); });
    pager.appendChild(prev);
    pager.appendChild(pageField);
    pager.appendChild(pageTotal);
    pager.appendChild(next);
    work.appendChild(pager);

    // crop stage
    var stage = el("div", "pdf-stage");
    var pageImg = el("div", "pdf-page"); // hosts the canvas
    pageImg.appendChild(pageCanvas);
    var box = el("div", "pdf-crop");
    var handle = el("div", "pdf-crop-handle");
    box.appendChild(handle);
    stage.appendChild(pageImg);
    stage.appendChild(box);
    work.appendChild(stage);

    // capture row
    var capRow = el("div", "pdf-capture");
    var frontBtn = el("button", "btn", "Capture front");
    var rearBtn = el("button", "btn", "Capture rear");
    frontBtn.addEventListener("click", function () { capture("front"); });
    rearBtn.addEventListener("click", function () { capture("rear"); });
    var traceWrap = el("label", "pdf-trace");
    var trace = document.createElement("input");
    trace.type = "checkbox";
    traceWrap.appendChild(trace);
    traceWrap.appendChild(document.createTextNode(" Trace to line art"));
    capRow.appendChild(frontBtn);
    capRow.appendChild(rearBtn);
    capRow.appendChild(traceWrap);
    work.appendChild(capRow);

    // captured previews
    var previews = el("div", "pdf-previews");
    var frontPrev = el("div", "pdf-prev");
    var rearPrev = el("div", "pdf-prev");
    previews.appendChild(frontPrev);
    previews.appendChild(rearPrev);
    work.appendChild(previews);

    // ports read from the PDF's text layer (drive the topology + rear view)
    var portsField = el("div", "pdf-portsfield");
    portsField.appendChild(el("label", "pdf-ports-label", "Ports (read from the PDF text)"));
    var portsRow = el("div", "pdf-ports-row");
    var portsInput = document.createElement("input");
    portsInput.type = "text";
    portsInput.className = "pdf-ports-input";
    portsInput.placeholder = "comma-separated — e.g. Main L, Main R, AES50";
    portsInput.value = device.rearLabel || "";
    var detectBtn = el("button", "btn", "Detect from crop");
    detectBtn.addEventListener("click", function () { detectPorts(); });
    portsRow.appendChild(portsInput);
    portsRow.appendChild(detectBtn);
    portsField.appendChild(portsRow);
    work.appendChild(portsField);

    modal.appendChild(work);

    /* --- actions --- */
    var actions = el("div", "modal-actions");
    var cancel = el("button", "btn", "Cancel");
    var save = el("button", "btn btn-primary", "Save faceplate");
    save.disabled = true;
    cancel.addEventListener("click", function () { cleanup(); App.closeModal(); });
    save.addEventListener("click", function () {
      State.updateDevice(device.id, {
        image: captured.front,
        imageRear: captured.rear,
        rearLabel: portsInput.value.trim(),
      });
      App.flash("Faceplate saved");
      cleanup();
      App.closeModal();
    });
    actions.appendChild(cancel);
    actions.appendChild(save);
    modal.appendChild(actions);

    refreshPreviews();
    App.openModal(modal);

    /* ---------- behaviour ---------- */
    function cleanup() {
      try { if (pdfDoc) pdfDoc.destroy(); } catch (e) {}
    }

    function loadFile(file) {
      if (file.type && file.type.indexOf("pdf") < 0 && !/\.pdf$/i.test(file.name || "")) {
        App.flash("That isn't a PDF");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var data = new Uint8Array(reader.result);
        window.pdfjsLib.getDocument({ data: data }).promise.then(function (doc) {
          pdfDoc = doc;
          pageTotal.textContent = "/ " + doc.numPages;
          pageField.max = doc.numPages;
          pick.hidden = true;
          work.hidden = false;
          goPage(1);
        }).catch(function (e) {
          console.warn(e);
          App.flash("Couldn't read that PDF");
        });
      };
      reader.readAsArrayBuffer(file);
    }

    function goPage(n) {
      if (!pdfDoc) return;
      n = Math.max(1, Math.min(pdfDoc.numPages, n || 1));
      pageNum = n;
      pageField.value = n;
      pdfDoc.getPage(n).then(function (page) {
        var v1 = page.getViewport({ scale: 1 });
        var renderScale = Math.min(2400, 1400) / v1.width; // crisp render
        var vp = page.getViewport({ scale: renderScale });
        curPage = page;
        curViewport = vp;
        pageCanvas.width = Math.round(vp.width);
        pageCanvas.height = Math.round(vp.height);
        var ctx = pageCanvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
          layoutStage();
        });
      });
    }

    // fit the rendered page into the stage and reset the crop box
    function layoutStage() {
      var maxW = 440, maxH = 460;
      disp.scale = Math.min(maxW / pageCanvas.width, maxH / pageCanvas.height);
      disp.w = Math.round(pageCanvas.width * disp.scale);
      disp.h = Math.round(pageCanvas.height * disp.scale);
      pageImg.style.width = disp.w + "px";
      pageImg.style.height = disp.h + "px";
      pageCanvas.style.width = disp.w + "px";
      pageCanvas.style.height = disp.h + "px";
      stage.style.width = disp.w + "px";
      stage.style.height = disp.h + "px";
      // default crop: centred, ~60% wide, aspect-locked
      var w = Math.min(disp.w * 0.6, disp.h * faceAspect);
      var h = w / faceAspect;
      crop.w = w;
      crop.h = h;
      crop.x = (disp.w - w) / 2;
      crop.y = (disp.h - h) / 2;
      applyCrop();
    }

    function applyCrop() {
      box.style.left = crop.x + "px";
      box.style.top = crop.y + "px";
      box.style.width = crop.w + "px";
      box.style.height = crop.h + "px";
    }

    // drag to move
    box.addEventListener("pointerdown", function (e) {
      if (e.target === handle) return;
      e.preventDefault();
      var start = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
      box.setPointerCapture(e.pointerId);
      box.onpointermove = function (ev) {
        crop.x = clamp(start.cx + (ev.clientX - start.x), 0, disp.w - crop.w);
        crop.y = clamp(start.cy + (ev.clientY - start.y), 0, disp.h - crop.h);
        applyCrop();
      };
      box.onpointerup = function () { box.onpointermove = null; box.onpointerup = null; };
    });
    // resize from the corner, aspect-locked
    handle.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var start = { x: e.clientX, cw: crop.w };
      handle.setPointerCapture(e.pointerId);
      handle.onpointermove = function (ev) {
        var w = clamp(start.cw + (ev.clientX - start.x), 30, disp.w - crop.x);
        var h = w / faceAspect;
        if (crop.y + h > disp.h) { h = disp.h - crop.y; w = h * faceAspect; }
        crop.w = w;
        crop.h = h;
        applyCrop();
      };
      handle.onpointerup = function () { handle.onpointermove = null; handle.onpointerup = null; };
    });

    function capture(side) {
      if (!pdfDoc) return;
      var s = disp.scale;
      var sx = crop.x / s, sy = crop.y / s, sw = crop.w / s, sh = crop.h / s;
      var outW = Math.min(1000, Math.round(sw));
      var outH = Math.max(24, Math.round(outW / faceAspect));
      var oc = document.createElement("canvas");
      oc.width = outW;
      oc.height = outH;
      var ctx = oc.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, outW, outH);
      captured[side] = trace.checked ? traceCanvas(oc) : oc.toDataURL("image/jpeg", 0.92);
      refreshPreviews();
      App.flash("Captured " + side);
      if (side === "rear") detectPorts(); // ports usually live on the back
    }

    // pull port labels from the PDF's text layer within the current crop box
    function detectPorts() {
      if (!curPage || !curViewport) return;
      curPage.getTextContent().then(function (tc) {
        var s = disp.scale;
        var rx = crop.x / s, ry = crop.y / s, rw = crop.w / s, rh = crop.h / s;
        var hits = [];
        tc.items.forEach(function (it) {
          var str = (it.str || "").trim();
          if (!str) return;
          var p = window.pdfjsLib.Util.applyTransform(
            [it.transform[4], it.transform[5]],
            curViewport.transform
          );
          // small vertical slack so baselines just outside still count
          if (p[0] >= rx && p[0] <= rx + rw && p[1] >= ry - 8 && p[1] <= ry + rh + 8) {
            hits.push({ x: p[0], y: p[1], s: str });
          }
        });
        // reading order: top → bottom, then left → right
        hits.sort(function (a, b) { return Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x; });
        var seen = {}, ports = [];
        hits.forEach(function (h) {
          var t = h.s.replace(/\s+/g, " ").trim();
          if (!t || t.length > 18) return;              // long string → caption, not a label
          if (/^[.,;:_+\-–—•|]+$/.test(t)) return;       // punctuation only
          var key = t.toLowerCase();
          if (seen[key]) return;
          seen[key] = 1;
          ports.push(t);
        });
        if (ports.length) {
          portsInput.value = ports.slice(0, 48).join(", ");
          App.flash("Found " + ports.length + " port label" + (ports.length === 1 ? "" : "s"));
        } else {
          App.flash("No readable text in that area");
        }
      }).catch(function () { App.flash("Couldn't read the PDF text"); });
    }

    function refreshPreviews() {
      fillPrev(frontPrev, "Front", captured.front);
      fillPrev(rearPrev, "Rear", captured.rear);
      save.disabled = !(captured.front || captured.rear);
    }
    function fillPrev(node, label, src) {
      node.innerHTML = "";
      var cap = el("span", "pdf-prev-label", label);
      node.appendChild(cap);
      if (src) {
        var img = document.createElement("img");
        img.src = src;
        node.appendChild(img);
        node.classList.add("set");
      } else {
        node.appendChild(el("span", "pdf-prev-empty", "—"));
        node.classList.remove("set");
      }
    }
  }

  // vectorise a canvas to a compact SVG data URL (line-art look).
  // The source is downscaled first — tracing a full-res photo produces a huge,
  // slow SVG that overflows local storage; a smaller bitmap traces fast and clean.
  function traceCanvas(canvas) {
    var maxW = 380;
    var scale = Math.min(1, maxW / canvas.width);
    var w = Math.max(1, Math.round(canvas.width * scale));
    var h = Math.max(1, Math.round(canvas.height * scale));
    var small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    var sctx = small.getContext("2d");
    sctx.drawImage(canvas, 0, 0, w, h);
    var data = sctx.getImageData(0, 0, w, h);
    var opts = {
      numberofcolors: 8,
      colorquantcycles: 3,
      pathomit: 8,
      ltres: 1,
      qtres: 1,
      blurradius: 0,
      strokewidth: 1,
      scale: canvas.width / w, // keep the SVG at the original display size
    };
    var svg;
    try {
      svg = window.ImageTracer.imagedataToSVG(data, opts);
    } catch (e) {
      App.flash("Couldn't trace that image");
      return canvas.toDataURL("image/jpeg", 0.9); // fall back to raster
    }
    return "data:image/svg+xml;base64," + b64(svg);
  }
  function b64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  /* ---------- tiny dom + math ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  return { open: open };
})();
