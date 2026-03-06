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
  const pageSelect = document.getElementById("page-select");
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

  const pdfPageBar = document.getElementById("pdf-page-bar");
  const pdfPageInfo = document.getElementById("pdf-page-info");
  const pdfPrevBtn = document.getElementById("pdf-prev");
  const pdfNextBtn = document.getElementById("pdf-next");

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
        pageSelect.innerHTML = "";
        for (let i = 0; i < data.num_pages; i++) {
          const opt = document.createElement("option");
          opt.value = i;
          opt.textContent = `Page ${i + 1}`;
          pageSelect.appendChild(opt);
        }
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

  function getPageSize() {
    const i = parseInt(pageSelect.value, 10);
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
    pageSelect.value = i;
    state.placement = null;
    placementMarker.classList.add("hidden");
    renderPdfPage(i);
    updatePlacementHint();
  });
  if (pdfNextBtn) pdfNextBtn.addEventListener("click", function () {
    var i = Math.min(state.numPages - 1, state.currentPageIndex + 1);
    pageSelect.value = i;
    state.placement = null;
    placementMarker.classList.add("hidden");
    renderPdfPage(i);
    updatePlacementHint();
  });

  pageSelect.addEventListener("change", function () {
    state.placement = null;
    placementMarker.classList.add("hidden");
    if (state.fileId) renderPdfPage(pageSelect.value);
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

  // ----- Navigation (scalable for more tools) -----
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
    fd.append("page", pageSelect.value);
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
