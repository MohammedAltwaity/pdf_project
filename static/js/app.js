/**
 * PDF Platform - Frontend
 * Scalable for multiple tools; currently implements Sign PDF (draw or upload image).
 */

(function () {
  "use strict";

  const uploadZone = document.getElementById("upload-zone");
  const pdfInput = document.getElementById("pdf-input");
  const afterUpload = document.getElementById("after-upload");
  const fileInfo = document.getElementById("file-info");
  const pageNumberInput = document.getElementById("page-number");
  const pageOfSpan = document.getElementById("page-of");
  const signatureCanvas = document.getElementById("signature-canvas");
  const clearSignatureBtn = document.getElementById("clear-signature");
  const tabBtns = document.querySelectorAll(".tab-btn");
  const panelDraw = document.getElementById("panel-draw");
  const panelUpload = document.getElementById("panel-upload");
  const uploadSignatureZone = document.getElementById("upload-signature-zone");
  const signatureImageInput = document.getElementById("signature-image-input");
  const signatureImagePreview = document.getElementById("signature-image-preview");
  const sigWidth = document.getElementById("sig-width");
  const sigHeight = document.getElementById("sig-height");
  const applySignatureBtn = document.getElementById("apply-signature");
  const workspacePlaceholder = document.getElementById("workspace-placeholder");
  const pdfPreview = document.getElementById("pdf-preview");
  const pdfPreviewWrap = document.getElementById("pdf-preview-wrap");
  const pdfCanvas = document.getElementById("pdf-canvas");
  const placementMarker = document.getElementById("placement-marker");
  const placementHint = document.getElementById("placement-hint");
  const dragSignatureWrap = document.getElementById("drag-signature-wrap");
  const draggableSignature = document.getElementById("draggable-signature");
  const draggableSignatureImg = document.getElementById("draggable-signature-img");
  const navBtns = document.querySelectorAll(".nav-btn");
  const panels = document.querySelectorAll(".tool-panel");
  const landing = document.getElementById("landing");
  const toolView = document.getElementById("tool-view");
  const headerHome = document.getElementById("header-home");
  const navHome = document.getElementById("nav-home");
  const toolCards = document.querySelectorAll(".tool-card[data-tool]");

  const pdfPageBar = document.getElementById("pdf-page-bar");
  const pdfPageInfo = document.getElementById("pdf-page-info");
  const pdfPrevBtn = document.getElementById("pdf-prev");
  const pdfNextBtn = document.getElementById("pdf-next");

  const mergeUploadZone = document.getElementById("merge-upload-zone");
  const mergePdfInput = document.getElementById("merge-pdf-input");
  const mergeFileList = document.getElementById("merge-file-list");
  const mergeDownloadBtn = document.getElementById("merge-download-btn");
  const mergePreview = document.getElementById("merge-preview");
  const mergePreviewThumbnails = document.getElementById("merge-preview-thumbnails");
  const mergeResultPreview = document.getElementById("merge-result-preview");
  const mergeResultCanvas = document.getElementById("merge-result-canvas");
  const mergeResultPrev = document.getElementById("merge-result-prev");
  const mergeResultNext = document.getElementById("merge-result-next");
  const mergeResultPageInfo = document.getElementById("merge-result-page-info");
  const mergeResultDownload = document.getElementById("merge-result-download");

  let state = {
    fileId: null,
    numPages: 0,
    pageSizes: [],
    signatureMode: "draw",
    signatureImageData: null,
    trimmedSignature: null,
    placement: null,
    pdfDoc: null,
    pdfScale: 1,
    displayScale: 1,
    currentPageIndex: 0,
    mergeFiles: [],
    mergedPdfUrl: null,
    mergedPdfBlob: null,
    mergedPdfDoc: null,
    mergedPdfNumPages: 0,
    mergedPdfPageIndex: 0,
  };

  function getContentBbox(imageData, w, h) {
    var data = imageData.data;
    var left = w, top = h, right = 0, bottom = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        var visible = (a > 40 && (r < 248 || g < 248 || b < 248));
        if (visible) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (left > right || top > bottom) return null;
    return { left: left, top: top, right: right + 1, bottom: bottom + 1 };
  }

  /** Make white/near-white pixels transparent so image matches drawn signature (no white block). */
  function makeWhitesTransparent(ctx, width, height) {
    var imageData = ctx.getImageData(0, 0, width, height);
    var data = imageData.data;
    var threshold = 250;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold)
        data[i + 3] = 0;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function trimSignatureFromCanvas() {
    var ctx2 = signatureCanvas.getContext("2d");
    var imageData = ctx2.getImageData(0, 0, signatureCanvas.width, signatureCanvas.height);
    var bbox = getContentBbox(imageData, signatureCanvas.width, signatureCanvas.height);
    if (!bbox) return null;
    var cw = bbox.right - bbox.left;
    var ch = bbox.bottom - bbox.top;
    var trimCanvas = document.createElement("canvas");
    trimCanvas.width = cw;
    trimCanvas.height = ch;
    var tctx = trimCanvas.getContext("2d");
    tctx.drawImage(signatureCanvas, bbox.left, bbox.top, cw, ch, 0, 0, cw, ch);
    return { dataUrl: trimCanvas.toDataURL("image/png"), width: cw, height: ch };
  }

  function trimSignatureFromImage(dataUrl, done) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      var cx = c.getContext("2d");
      cx.drawImage(img, 0, 0);
      var imageData = cx.getImageData(0, 0, w, h);
      var bbox = getContentBbox(imageData, w, h);
      if (!bbox) { done(null); return; }
      var cw = bbox.right - bbox.left;
      var ch = bbox.bottom - bbox.top;
      var trimCanvas = document.createElement("canvas");
      trimCanvas.width = cw;
      trimCanvas.height = ch;
      var tctx = trimCanvas.getContext("2d");
      tctx.drawImage(img, bbox.left, bbox.top, cw, ch, 0, 0, cw, ch);
      makeWhitesTransparent(tctx, cw, ch);
      done({ dataUrl: trimCanvas.toDataURL("image/png"), width: cw, height: ch });
    };
    img.onerror = function () { done(null); };
    img.src = dataUrl;
  }

  function applyTrimmedSignature(trimmed) {
    if (!trimmed) return;
    state.trimmedSignature = trimmed;
    sigWidth.value = Math.round(trimmed.width);
    sigHeight.value = Math.round(trimmed.height);
    updateDraggableSignature();
    updatePlacementHint();
    if (state.placement) updateMarkerPosition();
  }

  // Parse JSON only when response is OK and content is JSON
  function parseJsonResponse(r) {
    return r.text().then((text) => {
      if (!r.ok) {
        try {
          const data = JSON.parse(text);
          throw new Error(data.error || "Request failed");
        } catch (e) {
          if (e instanceof SyntaxError) throw new Error(text || "Request failed");
          throw e;
        }
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error("Invalid server response");
      }
    });
  }

  // ----- PDF.js: render PDF page on canvas (no browser toolbar) -----
  function initPdfJs() {
    if (typeof pdfjsLib === "undefined") return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function renderPdfPage(pageIndex) {
    if (!state.fileId || typeof pdfjsLib === "undefined") return;
    const idx = parseInt(pageIndex, 10);
    state.currentPageIndex = idx;
    const url = "/uploads/" + state.fileId + ".pdf";
    (state.pdfDoc ? Promise.resolve(state.pdfDoc) : pdfjsLib.getDocument(url).promise.then(function (pdf) {
      state.pdfDoc = pdf;
      return pdf;
    })).then(function (pdf) {
      return pdf.getPage(idx + 1);
    }).then(function (page) {
      const wrap = pdfPreviewWrap;
      const wrapW = wrap.clientWidth;
      const wrapH = wrap.clientHeight;
      const baseScale = Math.min(wrapW / page.getViewport({ scale: 1 }).width, wrapH / page.getViewport({ scale: 1 }).height);
      const pixelRatio = Math.max(1.5, window.devicePixelRatio || 1);
      const renderScale = baseScale * pixelRatio;
      const viewport = page.getViewport({ scale: renderScale });
      state.displayScale = baseScale;
      state.pdfScale = renderScale;
      const canvas = pdfCanvas;
      const ctx = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = (viewport.width / pixelRatio) + "px";
      canvas.style.height = (viewport.height / pixelRatio) + "px";
      page.render({ canvasContext: ctx, viewport: viewport });
      if (pdfPageInfo) pdfPageInfo.textContent = "Page " + (idx + 1) + " of " + state.numPages;
      if (pdfPrevBtn) pdfPrevBtn.disabled = idx <= 0;
      if (pdfNextBtn) pdfNextBtn.disabled = idx >= state.numPages - 1;
      updateMarkerPosition();
    }).catch(function (err) {
      console.error("PDF render failed", err);
    });
  }

  // ----- PDF upload -----
  function handlePdfSelect(file) {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    const fd = new FormData();
    fd.append("pdf", file);
    fetch("/api/upload-pdf", { method: "POST", body: fd })
      .then(parseJsonResponse)
      .then((data) => {
        if (data.error) {
          alert(data.error);
          return;
        }
        state.fileId = data.file_id;
        state.numPages = data.num_pages;
        state.pageSizes = data.page_sizes || [];
        state.placement = null;
        fileInfo.textContent = `${file.name} (${data.num_pages} page${data.num_pages !== 1 ? "s" : ""})`;
        if (pageNumberInput) {
          pageNumberInput.min = 1;
          pageNumberInput.max = data.num_pages;
          pageNumberInput.value = 1;
        }
        if (pageOfSpan) pageOfSpan.textContent = "of " + data.num_pages + " pages";
        afterUpload.classList.remove("hidden");
        workspacePlaceholder.classList.add("hidden");
        pdfPreview.classList.remove("hidden");
        initPdfJs();
        renderPdfPage(0);
        updatePlacementHint();
        updateDraggableSignature();
      })
      .catch((err) => {
        console.error(err);
        alert(err.message || "Upload failed");
      });
  }

  function getPageIndex() {
    var n = parseInt(pageNumberInput ? pageNumberInput.value : "1", 10);
    if (isNaN(n) || n < 1) n = 1;
    var max = state.numPages || 1;
    if (n > max) n = max;
    return n - 1;
  }

  function getPageSize() {
    var i = getPageIndex();
    if (!state.pageSizes || !state.pageSizes[i]) return null;
    return state.pageSizes[i];
  }

  function updatePlacementHint() {
    if (!state.fileId) return;
    const hasSig = getSignatureData();
    if (!hasSig) {
      placementHint.textContent = "Create or upload a signature, then drag it onto the PDF.";
      return;
    }
    if (state.placement) {
      placementHint.textContent = "Signature placed. Drag the box to move, drag the corner to resize, or click Apply.";
    } else {
      placementHint.textContent = "Drag the signature below onto the PDF to place it.";
    }
  }

  const placementMarkerImg = document.getElementById("placement-marker-img");
  const placementResizeHandle = document.getElementById("placement-resize-handle");

  function updateMarkerPosition() {
    if (!state.placement || !placementMarker || !pdfCanvas) return;
    const page = getPageSize();
    if (!page) return;
    const sigData = getSignatureData();
    const canvasRect = pdfCanvas.getBoundingClientRect();
    const wrapRect = pdfPreviewWrap.getBoundingClientRect();
    var displayScale = state.displayScale || (canvasRect.width / page.width);
    var w, h;
    if (state.trimmedSignature) {
      w = state.trimmedSignature.width;
      h = state.trimmedSignature.height;
    } else {
      w = parseFloat(sigWidth.value) || 200;
      h = parseFloat(sigHeight.value) || 80;
    }
    placementMarker.style.left = (canvasRect.left - wrapRect.left + state.placement.x * displayScale) + "px";
    placementMarker.style.top = (canvasRect.top - wrapRect.top + state.placement.y * displayScale) + "px";
    placementMarker.style.width = (w * displayScale) + "px";
    placementMarker.style.height = (h * displayScale) + "px";
    if (placementMarkerImg && sigData) {
      placementMarkerImg.src = sigData;
      placementMarkerImg.style.display = "block";
    } else if (placementMarkerImg) {
      placementMarkerImg.style.display = "none";
    }
    placementMarker.classList.remove("hidden");
  }

  // ----- Drag signature onto PDF -----
  function updateDraggableSignature() {
    var data = getSignatureData();
    if (!data) {
      dragSignatureWrap.classList.add("hidden");
      return;
    }
    draggableSignatureImg.src = data;
    draggableSignatureImg.style.display = "";
    if (state.trimmedSignature) {
      var tw = state.trimmedSignature.width;
      var th = state.trimmedSignature.height;
      var maxSide = 200;
      if (tw > maxSide || th > maxSide) {
        var s = maxSide / Math.max(tw, th);
        tw = Math.round(tw * s);
        th = Math.round(th * s);
      }
      draggableSignature.style.width = tw + "px";
      draggableSignature.style.height = th + "px";
    } else {
      draggableSignature.style.width = "";
      draggableSignature.style.height = "";
    }
    dragSignatureWrap.classList.remove("hidden");
  }

  draggableSignature.addEventListener("dragstart", function (e) {
    e.dataTransfer.setData("text/plain", "signature");
    e.dataTransfer.effectAllowed = "move";
  });

  function handleSignatureDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!getSignatureData() || !state.fileId) return;
    var page = getPageSize();
    if (!page) return;
    var canvasRect = pdfCanvas.getBoundingClientRect();
    var dropX = e.clientX - canvasRect.left;
    var dropY = e.clientY - canvasRect.top;
    if (dropX < 0 || dropY < 0 || dropX > canvasRect.width || dropY > canvasRect.height) return;
    var displayScale = state.displayScale || (canvasRect.width / page.width);
    function placeWithTrim(trimmed) {
      if (trimmed) applyTrimmedSignature(trimmed);
      var w = state.trimmedSignature ? state.trimmedSignature.width : (parseFloat(sigWidth.value) || 200);
      var h = state.trimmedSignature ? state.trimmedSignature.height : (parseFloat(sigHeight.value) || 80);
      var pdfX = dropX / displayScale;
      var pdfY = dropY / displayScale;
      pdfX = Math.max(0, Math.min(page.width - w, pdfX));
      pdfY = Math.max(0, Math.min(page.height - h, pdfY));
      state.placement = { x: pdfX, y: pdfY };
      updateMarkerPosition();
      updatePlacementHint();
    }
    if (state.signatureMode === "draw") {
      placeWithTrim(trimSignatureFromCanvas());
    } else {
      trimSignatureFromImage(getSignatureData(), placeWithTrim);
    }
  }

  function allowDrop(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  pdfPreviewWrap.addEventListener("dragover", allowDrop);
  pdfPreviewWrap.addEventListener("drop", handleSignatureDrop);
  pdfCanvas.addEventListener("dragover", allowDrop);
  pdfCanvas.addEventListener("drop", handleSignatureDrop);
  placementMarker.addEventListener("dragover", allowDrop);
  placementMarker.addEventListener("drop", handleSignatureDrop);

  // ----- Move and resize placed signature -----
  function getDisplayScale() {
    var page = getPageSize();
    if (!page || !pdfCanvas) return 1;
    var canvasRect = pdfCanvas.getBoundingClientRect();
    return state.displayScale || (canvasRect.width / page.width);
  }

  function clampPlacementToPage(pdfX, pdfY, w, h) {
    var page = getPageSize();
    if (!page) return { x: pdfX, y: pdfY };
    return {
      x: Math.max(0, Math.min(page.width - w, pdfX)),
      y: Math.max(0, Math.min(page.height - h, pdfY)),
    };
  }

  placementMarker.addEventListener("mousedown", function (e) {
    if (!state.placement || !getSignatureData()) return;
    if (placementResizeHandle && e.target === placementResizeHandle) {
      e.preventDefault();
      e.stopPropagation();
      var startX = e.clientX;
      var startY = e.clientY;
      var startW = parseFloat(sigWidth.value) || 200;
      var startH = parseFloat(sigHeight.value) || 80;
      var displayScale = getDisplayScale();
      var page = getPageSize();
      function onResizeMove(ev) {
        ev.preventDefault();
        var dw = (ev.clientX - startX) / displayScale;
        var dh = (ev.clientY - startY) / displayScale;
        var newW = Math.max(50, Math.min(500, startW + dw));
        var newH = Math.max(30, Math.min(200, startH + dh));
        sigWidth.value = Math.round(newW);
        sigHeight.value = Math.round(newH);
        if (state.trimmedSignature) {
          state.trimmedSignature.width = newW;
          state.trimmedSignature.height = newH;
        }
        updateMarkerPosition();
      }
      function onResizeUp() {
        document.removeEventListener("mousemove", onResizeMove);
        document.removeEventListener("mouseup", onResizeUp);
      }
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeUp);
      return;
    }
    e.preventDefault();
    var wrapRect = pdfPreviewWrap.getBoundingClientRect();
    var canvasRect = pdfCanvas.getBoundingClientRect();
    var displayScale = getDisplayScale();
    var startClientX = e.clientX;
    var startClientY = e.clientY;
    var startPdfX = state.placement.x;
    var startPdfY = state.placement.y;
    var w = parseFloat(sigWidth.value) || 200;
    var h = parseFloat(sigHeight.value) || 80;
    function onMove(ev) {
      ev.preventDefault();
      var deltaPxX = ev.clientX - startClientX;
      var deltaPxY = ev.clientY - startClientY;
      var deltaPdfX = deltaPxX / displayScale;
      var deltaPdfY = deltaPxY / displayScale;
      var next = clampPlacementToPage(startPdfX + deltaPdfX, startPdfY + deltaPdfY, w, h);
      state.placement = next;
      updateMarkerPosition();
    }
    function onMoveUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onMoveUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onMoveUp);
  });

  if (pdfPrevBtn) pdfPrevBtn.addEventListener("click", function () {
    var i = Math.max(0, state.currentPageIndex - 1);
    if (pageNumberInput) pageNumberInput.value = i + 1;
    state.placement = null;
    placementMarker.classList.add("hidden");
    renderPdfPage(i);
    updatePlacementHint();
  });
  if (pdfNextBtn) pdfNextBtn.addEventListener("click", function () {
    var i = Math.min(state.numPages - 1, state.currentPageIndex + 1);
    if (pageNumberInput) pageNumberInput.value = i + 1;
    state.placement = null;
    placementMarker.classList.add("hidden");
    renderPdfPage(i);
    updatePlacementHint();
  });

  if (pageNumberInput) pageNumberInput.addEventListener("change", function () {
    var n = parseInt(pageNumberInput.value, 10);
    var max = state.numPages || 1;
    if (isNaN(n) || n < 1) { pageNumberInput.value = 1; n = 1; }
    else if (n > max) { pageNumberInput.value = max; n = max; }
    state.placement = null;
    placementMarker.classList.add("hidden");
    if (state.fileId) renderPdfPage(n - 1);
    updatePlacementHint();
  });
  sigWidth.addEventListener("input", updateMarkerPosition);
  sigHeight.addEventListener("input", updateMarkerPosition);

  uploadZone.addEventListener("click", () => pdfInput.click());
  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("dragover");
  });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    handlePdfSelect(file);
  });
  pdfInput.addEventListener("change", () => {
    const file = pdfInput.files[0];
    handlePdfSelect(file);
  });

  // ----- Landing ↔ Tool view (hash-based navigation so back button works) -----
  function showLanding() {
    if (landing) landing.classList.remove("hidden");
    if (toolView) toolView.classList.add("hidden");
    if (navHome) navHome.classList.add("hidden");
  }

  function showToolView(tool) {
    if (landing) landing.classList.add("hidden");
    if (toolView) toolView.classList.remove("hidden");
    if (navHome) navHome.classList.remove("hidden");
    panels.forEach((p) => p.classList.add("hidden"));
    const panel = document.getElementById("panel-" + tool);
    if (panel) panel.classList.remove("hidden");
    if (workspacePlaceholder) workspacePlaceholder.classList.add("hidden");
    if (pdfPreview) pdfPreview.classList.add("hidden");
    if (mergePreview) mergePreview.classList.add("hidden");
    if (tool === "merge") {
      if (state.mergedPdfDoc && mergeResultPreview) {
        mergeResultPreview.classList.remove("hidden");
        if (mergePreview) mergePreview.classList.add("hidden");
        renderMergedPdfPage(state.mergedPdfPageIndex);
      } else {
        if (mergeResultPreview) mergeResultPreview.classList.add("hidden");
        if (mergePreview) mergePreview.classList.remove("hidden");
        updateMergePreview();
      }
    } else if (tool === "sign") {
      if (state.fileId) {
        if (pdfPreview) pdfPreview.classList.remove("hidden");
      } else {
        if (workspacePlaceholder) workspacePlaceholder.classList.remove("hidden");
      }
    } else {
      if (workspacePlaceholder) workspacePlaceholder.classList.remove("hidden");
    }
  }

  function applyViewFromHash() {
    var hash = (window.location.hash || "#").replace(/^#/, "") || "home";
    if (hash === "home" || !hash) {
      showLanding();
    } else {
      showToolView(hash);
    }
  }

  function navigateToHome() {
    showLanding();
    if (window.history && window.history.pushState) {
      window.history.pushState({ view: "home" }, "", "#");
    }
  }

  function navigateToTool(tool) {
    showToolView(tool);
    if (window.history && window.history.pushState) {
      window.history.pushState({ view: tool }, "", "#" + tool);
    }
  }

  // Initial view from current URL; ensure home has a history entry so back from a tool stays in-app
  (function initNav() {
    var hash = (window.location.hash || "").replace(/^#/, "");
    applyViewFromHash();
    if (!hash && window.history && window.history.replaceState) {
      window.history.replaceState({ view: "home" }, "", window.location.pathname + window.location.search + "#");
    }
  })();

  // Browser back/forward
  window.addEventListener("popstate", function () {
    applyViewFromHash();
  });

  if (headerHome) {
    headerHome.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateToHome();
    });
  }
  if (navHome) {
    navHome.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateToHome();
    });
  }
  toolCards.forEach((card) => {
    card.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      var tool = card.dataset.tool;
      if (tool) navigateToTool(tool);
    });
  });
  document.querySelectorAll(".footer-link[data-tool]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      var tool = link.dataset.tool;
      if (tool) navigateToTool(tool);
    });
  });

  // ----- Merge PDF -----
  function clearMergedResult() {
    if (state.mergedPdfUrl) {
      URL.revokeObjectURL(state.mergedPdfUrl);
      state.mergedPdfUrl = null;
    }
    state.mergedPdfBlob = null;
    state.mergedPdfDoc = null;
    state.mergedPdfNumPages = 0;
    state.mergedPdfPageIndex = 0;
    if (mergeResultPreview) mergeResultPreview.classList.add("hidden");
    if (mergePreview) mergePreview.classList.remove("hidden");
  }

  function renderMergedPdfPage(idx) {
    if (!state.mergedPdfDoc || !mergeResultCanvas || typeof pdfjsLib === "undefined") return;
    state.mergedPdfPageIndex = idx;
    if (mergeResultPageInfo) mergeResultPageInfo.textContent = "Page " + (idx + 1) + " of " + state.mergedPdfNumPages;
    if (mergeResultPrev) mergeResultPrev.disabled = idx <= 0;
    if (mergeResultNext) mergeResultNext.disabled = idx >= state.mergedPdfNumPages - 1;
    state.mergedPdfDoc.getPage(idx + 1).then(function (page) {
      var wrap = mergeResultCanvas.parentElement;
      var wrapW = wrap ? wrap.clientWidth : 600;
      var wrapH = wrap ? wrap.clientHeight : 500;
      var baseScale = Math.min(wrapW / page.getViewport({ scale: 1 }).width, wrapH / page.getViewport({ scale: 1 }).height);
      var pixelRatio = Math.max(1.5, window.devicePixelRatio || 1);
      var renderScale = baseScale * pixelRatio;
      var viewport = page.getViewport({ scale: renderScale });
      mergeResultCanvas.width = viewport.width;
      mergeResultCanvas.height = viewport.height;
      var ctx = mergeResultCanvas.getContext("2d");
      return page.render({ canvasContext: ctx, viewport: viewport }).promise;
    }).catch(function (err) { console.error("Merge preview render failed", err); });
  }

  function showMergedResult(blob) {
    if (state.mergedPdfUrl) URL.revokeObjectURL(state.mergedPdfUrl);
    state.mergedPdfBlob = blob;
    state.mergedPdfUrl = URL.createObjectURL(blob);
    state.mergedPdfDoc = null;
    state.mergedPdfNumPages = 0;
    state.mergedPdfPageIndex = 0;
    if (mergePreview) mergePreview.classList.add("hidden");
    if (mergeResultPreview) mergeResultPreview.classList.remove("hidden");
    if (typeof pdfjsLib === "undefined") return;
    pdfjsLib.getDocument(state.mergedPdfUrl).promise.then(function (pdf) {
      state.mergedPdfDoc = pdf;
      state.mergedPdfNumPages = pdf.numPages;
      renderMergedPdfPage(0);
    }).catch(function (err) {
      console.error("Failed to load merged PDF for preview", err);
      if (mergeResultPageInfo) mergeResultPageInfo.textContent = "Preview unavailable";
    });
  }

  function addMergeFiles(files) {
    if (!files || !files.length) return;
    clearMergedResult();
    for (var i = 0; i < files.length; i++) {
      if (files[i].type === "application/pdf") state.mergeFiles.push(files[i]);
    }
    renderMergeList();
    updateMergeButton();
    updateMergePreview();
  }

  function removeMergeFile(index) {
    state.mergeFiles.splice(index, 1);
    renderMergeList();
    updateMergeButton();
    updateMergePreview();
    clearMergedResult();
  }

  function renderMergeList() {
    if (!mergeFileList) return;
    mergeFileList.innerHTML = "";
    state.mergeFiles.forEach(function (file, index) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = file.name || "PDF " + (index + 1);
      name.title = file.name || "";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "merge-file-remove";
      btn.textContent = "Remove";
      btn.setAttribute("data-merge-index", String(index));
      li.appendChild(name);
      li.appendChild(btn);
      mergeFileList.appendChild(li);
    });
  }

  function updateMergeButton() {
    if (mergeDownloadBtn) mergeDownloadBtn.disabled = state.mergeFiles.length < 2;
  }

  function updateMergePreview() {
    if (!mergePreviewThumbnails || typeof pdfjsLib === "undefined") return;
    mergePreviewThumbnails.innerHTML = "";
    state.mergeFiles.forEach(function (file, index) {
      var wrap = document.createElement("div");
      wrap.className = "merge-preview-thumb";
      var canvas = document.createElement("canvas");
      var label = document.createElement("span");
      label.textContent = (index + 1) + ". " + (file.name || "PDF");
      wrap.appendChild(canvas);
      wrap.appendChild(label);
      mergePreviewThumbnails.appendChild(wrap);
      file.arrayBuffer().then(function (ab) {
        return pdfjsLib.getDocument(ab).promise;
      }).then(function (pdf) {
        return pdf.getPage(1);
      }).then(function (page) {
        var scale = Math.min(200 / page.getViewport({ scale: 1 }).width, 260 / page.getViewport({ scale: 1 }).height, 1.5);
        var viewport = page.getViewport({ scale: scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var ctx = canvas.getContext("2d");
        return page.render({ canvasContext: ctx, viewport: viewport }).promise;
      }).catch(function () {
        label.textContent = (index + 1) + ". " + (file.name || "PDF") + " (preview failed)";
      });
    });
  }

  if (mergeUploadZone) {
    mergeUploadZone.addEventListener("click", function () {
      if (mergePdfInput) mergePdfInput.click();
    });
    mergeUploadZone.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.stopPropagation();
      mergeUploadZone.classList.add("dragover");
    });
    mergeUploadZone.addEventListener("dragleave", function () {
      mergeUploadZone.classList.remove("dragover");
    });
    mergeUploadZone.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      mergeUploadZone.classList.remove("dragover");
      addMergeFiles(e.dataTransfer.files);
    });
  }
  if (mergePdfInput) {
    mergePdfInput.addEventListener("change", function () {
      addMergeFiles(mergePdfInput.files);
      mergePdfInput.value = "";
    });
  }
  if (mergeFileList) {
    mergeFileList.addEventListener("click", function (e) {
      var btn = e.target.closest(".merge-file-remove");
      if (btn) {
        var index = parseInt(btn.getAttribute("data-merge-index"), 10);
        if (!isNaN(index)) removeMergeFile(index);
      }
    });
  }
  if (mergeDownloadBtn) {
    mergeDownloadBtn.addEventListener("click", function () {
      if (state.mergeFiles.length < 2) return;
      mergeDownloadBtn.disabled = true;
      mergeDownloadBtn.textContent = "Merging…";
      var fd = new FormData();
      state.mergeFiles.forEach(function (file) {
        fd.append("pdfs", file);
      });
      fetch("/api/merge-pdf", { method: "POST", body: fd })
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (text) {
              var msg = "Merge failed";
              try {
                var data = JSON.parse(text);
                if (data && data.error) msg = data.error;
              } catch (e) { if (text) msg = text.slice(0, 200); }
              throw new Error(msg);
            });
          }
          return r.blob();
        })
        .then(function (blob) {
          showMergedResult(blob);
        })
        .catch(function (err) {
          alert(err.message || "Failed to merge PDFs");
        })
        .finally(function () {
          mergeDownloadBtn.disabled = state.mergeFiles.length < 2;
          mergeDownloadBtn.textContent = "Merge & download";
        });
    });
  }
  if (mergeResultPrev) {
    mergeResultPrev.addEventListener("click", function () {
      if (state.mergedPdfPageIndex > 0) renderMergedPdfPage(state.mergedPdfPageIndex - 1);
    });
  }
  if (mergeResultNext) {
    mergeResultNext.addEventListener("click", function () {
      if (state.mergedPdfPageIndex < state.mergedPdfNumPages - 1) renderMergedPdfPage(state.mergedPdfPageIndex + 1);
    });
  }
  if (mergeResultDownload) {
    mergeResultDownload.addEventListener("click", function () {
      if (!state.mergedPdfBlob) return;
      var a = document.createElement("a");
      a.href = URL.createObjectURL(state.mergedPdfBlob);
      a.download = "merged.pdf";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }, 100);
    });
  }

  // ----- Navigation (sidebar tool panels, when using nav buttons) -----
  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      if (btn.disabled) return;
      navBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      panels.forEach((p) => p.classList.add("hidden"));
      const panel = document.getElementById("panel-" + tool);
      if (panel) panel.classList.remove("hidden");
    });
  });

  // ----- Signature tabs -----
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      state.signatureMode = mode;
      state.trimmedSignature = null;
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      panelDraw.classList.toggle("hidden", mode !== "draw");
      panelUpload.classList.toggle("hidden", mode !== "upload");
      updateDraggableSignature();
      if (state.placement) updateMarkerPosition();
    });
  });

  // ----- Draw signature (canvas) -----
  const ctx = signatureCanvas.getContext("2d");
  let drawing = false;

  function getCoord(e) {
    const rect = signatureCanvas.getBoundingClientRect();
    const scaleX = signatureCanvas.width / rect.width;
    const scaleY = signatureCanvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    const { x, y } = getCoord(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function moveDraw(e) {
    e.preventDefault();
    if (!drawing) return;
    const { x, y } = getCoord(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endDraw(e) {
    e.preventDefault();
    drawing = false;
    var trimmed = trimSignatureFromCanvas();
    if (trimmed) applyTrimmedSignature(trimmed);
    else { updatePlacementHint(); updateDraggableSignature(); }
  }

  signatureCanvas.addEventListener("mousedown", startDraw);
  signatureCanvas.addEventListener("mousemove", moveDraw);
  signatureCanvas.addEventListener("mouseup", endDraw);
  signatureCanvas.addEventListener("mouseleave", endDraw);
  signatureCanvas.addEventListener("touchstart", startDraw, { passive: false });
  signatureCanvas.addEventListener("touchmove", moveDraw, { passive: false });
  signatureCanvas.addEventListener("touchend", endDraw, { passive: false });

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  clearSignatureBtn.addEventListener("click", () => {
    ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    state.trimmedSignature = null;
    updatePlacementHint();
    updateDraggableSignature();
  });

  // ----- Upload signature image -----
  uploadSignatureZone.addEventListener("click", () => signatureImageInput.click());
  uploadSignatureZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadSignatureZone.classList.add("dragover");
  });
  uploadSignatureZone.addEventListener("dragleave", () => uploadSignatureZone.classList.remove("dragover"));
  uploadSignatureZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadSignatureZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleSignatureImage(file);
  });
  signatureImageInput.addEventListener("change", () => {
    const file = signatureImageInput.files[0];
    if (file) handleSignatureImage(file);
  });

  function handleSignatureImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      state.signatureImageData = e.target.result;
      signatureImagePreview.classList.remove("hidden");
      signatureImagePreview.innerHTML = "<img src=\"" + e.target.result + "\" alt=\"Signature preview\">";
      trimSignatureFromImage(e.target.result, function (trimmed) {
        if (trimmed) applyTrimmedSignature(trimmed);
        else { updatePlacementHint(); updateDraggableSignature(); }
      });
    };
    reader.readAsDataURL(file);
  }

  // ----- Apply signature -----
  function getSignatureData() {
    if (state.trimmedSignature && state.trimmedSignature.dataUrl) return state.trimmedSignature.dataUrl;
    if (state.signatureMode === "draw") {
      const ctx2 = signatureCanvas.getContext("2d");
      const imageData = ctx2.getImageData(0, 0, signatureCanvas.width, signatureCanvas.height);
      const hasPixels = imageData.data.some((_, i) => i % 4 === 3 && imageData.data[i] > 0);
      if (!hasPixels) return null;
      return signatureCanvas.toDataURL("image/png");
    }
    return state.signatureImageData;
  }

  applySignatureBtn.addEventListener("click", () => {
    if (!state.fileId) {
      alert("Upload a PDF first");
      return;
    }
    const sigData = getSignatureData();
    if (!sigData) {
      alert("Draw a signature or upload an image");
      return;
    }

    const fd = new FormData();
    fd.append("file_id", state.fileId);
    fd.append("page", String(getPageIndex()));
    fd.append("x", state.placement ? String(Math.round(state.placement.x)) : "100");
    fd.append("y", state.placement ? String(Math.round(state.placement.y)) : "100");
    fd.append("width", sigWidth.value);
    fd.append("height", sigHeight.value);
    fd.append("signature_data", sigData);

    applySignatureBtn.disabled = true;
    applySignatureBtn.textContent = "Applying…";

    fetch("/api/sign-pdf", { method: "POST", body: fd })
      .then((r) => {
        if (!r.ok) {
          return r.text().then((text) => {
            try {
              const d = JSON.parse(text);
              throw new Error(d.error || "Request failed");
            } catch (e) {
              if (e instanceof SyntaxError) throw new Error(text || "Request failed");
              throw e;
            }
          });
        }
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "signed.pdf";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => {
        alert(err.message || "Failed to sign PDF");
      })
      .finally(() => {
        applySignatureBtn.disabled = false;
        applySignatureBtn.textContent = "Apply signature & download";
      });
  });
})();
