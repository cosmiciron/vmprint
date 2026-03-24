(() => {
  const bootStartedAt = performance.now();
  const AUTO_RENDER_DEBOUNCE_MS = 350;

  function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing required element: #${id}`);
    }
    return element;
  }

  function setStatus(element, state, message) {
    element.dataset.state = state;
    element.textContent = message;
  }

  function setDisabled(elements, disabled) {
    for (const element of elements) {
      element.disabled = disabled;
    }
  }

  function formatDocumentJson(documentJson) {
    return `${JSON.stringify(documentJson, null, 2)}\n`;
  }

  function init() {
    const astInput = requireElement("ast-input");
    const fixtureSelect = requireElement("fixture-select");
    const uploadButton = requireElement("upload-button");
    const copyButton = requireElement("copy-json");
    const uploadInput = requireElement("upload-json");
    const previewScale = requireElement("preview-scale");
    const previewDpi = requireElement("preview-dpi");
    const textRenderMode = requireElement("text-render-mode");
    const previewCanvas = requireElement("preview-canvas");
    const previousPageButton = requireElement("previous-page");
    const nextPageButton = requireElement("next-page");
    const currentPageLabel = requireElement("current-page");
    const status = requireElement("status");
    const pageCount = requireElement("page-count");
    const bootMs = requireElement("boot-ms");
    const layoutMs = requireElement("layout-ms");
    const renderMs = requireElement("render-ms");
    const fixturePickerLabel = requireElement("fixture-picker-label");
    const inlineError = requireElement("inline-error");
    const dispatchCallout = requireElement("dispatch-callout");

    let fixtureRequestId = 0;
    let fontProgressMessage = "";
    let session = null;
    let currentPageIndex = 0;
    let renderInFlight = false;
    let queuedRender = null;
    let autoRenderTimer = null;
    let previewRenderToken = 0;
    let silentRenderActive = false;
    let activeBuiltinFixtureId = null;
    let documentSource = "builtin";

    function setInlineError(message) {
      inlineError.textContent = message ?? "";
      inlineError.hidden = !message;
    }

    function updateDispatchCallout() {
      dispatchCallout.hidden = !(documentSource === "builtin" && activeBuiltinFixtureId === "daily-dispatch");
    }

    function updatePaginationUi() {
      const totalPages = session?.pageCount ?? 0;
      currentPageLabel.textContent =
        totalPages > 0 ? `Page ${currentPageIndex + 1} of ${totalPages}` : "No pages rendered";
      previousPageButton.disabled = !session || currentPageIndex <= 0;
      nextPageButton.disabled = !session || currentPageIndex >= totalPages - 1;
    }

    function clearPreview(resetMetrics = true) {
      session = null;
      currentPageIndex = 0;
      previewRenderToken += 1;

      const context = previewCanvas.getContext("2d");
      if (context) {
        context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      }
      previewCanvas.width = 1;
      previewCanvas.height = 1;
      pageCount.textContent = "";

      if (resetMetrics) {
        layoutMs.textContent = "-";
        renderMs.textContent = "-";
      }

      updatePaginationUi();
    }

    async function paintCurrentPage() {
      const localSession = session;
      if (!localSession) {
        updatePaginationUi();
        return;
      }

      const scale = Number(previewScale.value || "1");
      const dpiValue = previewDpi.value;
      const dpi = dpiValue === "auto" ? undefined : Number(dpiValue);
      const renderToken = ++previewRenderToken;
      const bufferCanvas = document.createElement("canvas");

      await localSession.renderPage(currentPageIndex, bufferCanvas, scale, dpi);

      if (renderToken !== previewRenderToken || localSession !== session) {
        return;
      }

      previewCanvas.width = bufferCanvas.width;
      previewCanvas.height = bufferCanvas.height;

      const context = previewCanvas.getContext("2d");
      if (!context) {
        throw new Error("2D canvas context is unavailable.");
      }

      context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      context.drawImage(bufferCanvas, 0, 0);
      updatePaginationUi();
    }

    function updateBootMetric() {
      bootMs.textContent = `${(performance.now() - bootStartedAt).toFixed(1)} ms`;
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) {
        return "0 B";
      }
      if (bytes < 1024) {
        return `${bytes} B`;
      }
      if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
      }
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function trackFontProgress(detail) {
      if (!detail) {
        fontProgressMessage = "";
        return;
      }

      if (detail.phase === "cache-hit") {
        fontProgressMessage = `Fonts: ${detail.fileName} loaded from cache`;
        return;
      }

      if (detail.phase === "complete") {
        fontProgressMessage = `Fonts: ${detail.fileName} loaded (${formatBytes(detail.loadedBytes)})`;
        return;
      }

      if (detail.phase === "finalizing") {
        fontProgressMessage = `Fonts: ${detail.fileName} downloaded, finalizing...`;
        return;
      }

      if (detail.phase === "caching") {
        fontProgressMessage = `Fonts: ${detail.fileName} saving to cache...`;
        return;
      }

      const percent = Number.isFinite(detail.percent)
        ? `${Number(detail.percent).toFixed(0)}%`
        : `${formatBytes(detail.loadedBytes)} downloaded`;
      const total = Number.isFinite(detail.totalBytes) ? ` / ${formatBytes(Number(detail.totalBytes))}` : "";
      fontProgressMessage = `Fonts: downloading ${detail.fileName} (${percent}${total})`;
    }

    function queueRender(options) {
      queuedRender = {
        silent: Boolean(options?.silent),
        preservePage: options?.preservePage !== false,
        clearPreview: Boolean(options?.clearPreview)
      };
    }

    async function renderDocument(options = {}) {
      const silent = Boolean(options.silent);
      const preservePage = options.preservePage !== false;
      const shouldClearPreview = Boolean(options.clearPreview);

      if (renderInFlight) {
        queueRender({ silent, preservePage, clearPreview: shouldClearPreview });
        return;
      }

      let documentJson;
      try {
        documentJson = VMPrintPipeline.parseDocumentJson(astInput.value);
      } catch (error) {
        if (!silent) {
          setInlineError("JSON syntax error — check the document structure.");
          setStatus(status, "error", "JSON parse error. Fix the syntax and try again.");
        }
        return;
      }

      const nextPageIndex = preservePage ? currentPageIndex : 0;
      setInlineError(null);
      renderInFlight = true;
      queuedRender = null;
      fontProgressMessage = "";
      silentRenderActive = silent;

      if (!silent) {
        setDisabled([uploadButton], true);
        const initialStatus = activeBuiltinFixtureId === "daily-dispatch"
          ? "Rendering sample document… first visit may take longer while fonts download and cache."
          : "Rendering pages to canvas…";
        setStatus(status, "rendering", initialStatus);
      }

      if (shouldClearPreview) {
        clearPreview(false);
      }

      const startedAt = performance.now();

      try {
        const nextSession = await VMPrintPipeline.createCanvasPreviewSession(documentJson, {
          textRenderMode: textRenderMode.value
        });

        session = nextSession;
        currentPageIndex = Math.max(0, Math.min(nextPageIndex, nextSession.pageCount - 1));
        await paintCurrentPage();

        pageCount.textContent = `${nextSession.pageCount} page${nextSession.pageCount === 1 ? "" : "s"}`;
        layoutMs.textContent = `${nextSession.layoutMs.toFixed(1)} ms`;
        renderMs.textContent = `${nextSession.renderMs.toFixed(1)} ms`;

        const suffix = fontProgressMessage ? ` ${fontProgressMessage}.` : "";
        if (!silent || !session) {
          setStatus(status, "success", `Render complete. Single-page canvas preview is ready.${suffix}`);
        }
      } catch (error) {
        const elapsedMs = performance.now() - startedAt;
        renderMs.textContent = `${elapsedMs.toFixed(1)} ms (failed)`;
        const message = String(error);
        setInlineError(`Render error: ${message}`);
        setStatus(status, "error", silent ? `Auto-refresh failed: ${message}` : message);

        if (!silent && shouldClearPreview) {
          clearPreview(false);
        }
      } finally {
        renderInFlight = false;
        silentRenderActive = false;
        if (!silent) {
          setDisabled([uploadButton], false);
        }

        if (queuedRender) {
          const queued = queuedRender;
          queuedRender = null;
          renderDocument(queued).catch((error) => {
            setStatus(status, "error", String(error));
          });
        }
      }
    }

    function ensureCustomOption(label) {
      let customOption = fixtureSelect.querySelector('option[value="custom"]');
      if (!customOption) {
        customOption = document.createElement("option");
        customOption.value = "custom";
        fixtureSelect.insertBefore(customOption, fixtureSelect.firstChild);
      }
      customOption.textContent = label;
      fixtureSelect.value = "custom";
      updateDispatchCallout();
    }

    function removeCustomOption() {
      fixtureSelect.querySelector('option[value="custom"]')?.remove();
    }

    async function loadFixture(fixtureId) {
      const requestId = ++fixtureRequestId;
      documentSource = "builtin";
      activeBuiltinFixtureId = fixtureId;
      updateDispatchCallout();
      fixturePickerLabel.dataset.loading = "true";
      fixtureSelect.disabled = true;
      setDisabled([uploadButton], true);
      setStatus(
        status,
        "rendering",
        fixtureId === "daily-dispatch"
          ? "Loading the sample newspaper… first visit may take a little longer while example fonts download and cache."
          : `Loading “${fixtureId}”…`
      );
      removeCustomOption();

      try {
        const documentJson = await VMPrintPipeline.getBuiltinFixtureDocument(fixtureId);
        if (requestId !== fixtureRequestId) {
          return;
        }

        astInput.value = formatDocumentJson(documentJson);
        setInlineError(null);
        documentSource = "builtin";
        activeBuiltinFixtureId = fixtureId;
        updateDispatchCallout();
      } catch (error) {
        if (requestId !== fixtureRequestId) {
          return;
        }
        setStatus(status, "error", String(error));
        return;
      } finally {
        if (requestId !== fixtureRequestId) {
          return;
        }
        fixturePickerLabel.dataset.loading = "false";
        fixtureSelect.disabled = false;
        setDisabled([uploadButton], false);
      }

      await renderDocument({ silent: false, preservePage: false, clearPreview: true });
    }

    function populateFixtures() {
      const fixtures = VMPrintPipeline.getBuiltinFixturePresets();
      fixtureSelect.innerHTML = "";

      for (const fixture of fixtures) {
        const option = document.createElement("option");
        option.value = fixture.id;
        option.textContent = fixture.label;
        option.title = fixture.description;
        fixtureSelect.appendChild(option);
      }

      if (fixtures.length > 0) {
        fixtureSelect.value = fixtures[0].id;
      }
    }

    fixtureSelect.addEventListener("change", () => {
      const fixtureId = fixtureSelect.value;
      if (!fixtureId || fixtureId === "custom") {
        return;
      }
      loadFixture(fixtureId);
    });

    uploadButton.addEventListener("click", () => uploadInput.click());
    previewScale.addEventListener("change", () => {
      if (!session) {
        return;
      }
      paintCurrentPage().catch((error) => setStatus(status, "error", String(error)));
    });

    previewDpi.addEventListener("change", () => {
      if (!session) {
        return;
      }
      paintCurrentPage().catch((error) => setStatus(status, "error", String(error)));
    });

    textRenderMode.addEventListener("change", () => {
      renderDocument({ silent: false, preservePage: true, clearPreview: false });
    });

    previousPageButton.addEventListener("click", () => {
      if (!session || currentPageIndex <= 0) {
        return;
      }
      currentPageIndex -= 1;
      paintCurrentPage().catch((error) => setStatus(status, "error", String(error)));
    });

    nextPageButton.addEventListener("click", () => {
      if (!session || currentPageIndex >= session.pageCount - 1) {
        return;
      }
      currentPageIndex += 1;
      paintCurrentPage().catch((error) => setStatus(status, "error", String(error)));
    });

    window.addEventListener("vmprint:webfont-progress", (event) => {
      const customEvent = event;
      if (!customEvent.detail) {
        return;
      }

      trackFontProgress(customEvent.detail);
      if (status.dataset.state === "rendering" && !silentRenderActive) {
        const prefix = activeBuiltinFixtureId === "daily-dispatch"
          ? "Loading sample assets… "
          : "Preparing preview… ";
        const fallback = activeBuiltinFixtureId === "daily-dispatch"
          ? "Loading fonts for the sample — first visit may take a moment."
          : "Rendering pages to canvas…";
        setStatus(status, "rendering", `${prefix}${fontProgressMessage || fallback}`);
      }
    });

    uploadInput.addEventListener("change", async (event) => {
      const input = event.target;
      const file = input.files?.[0];
      input.value = "";

      if (!file) {
        return;
      }

      try {
        const fileText = await file.text();
        astInput.value = `${fileText.trim()}\n`;
        setInlineError(null);
        documentSource = "custom";
        activeBuiltinFixtureId = null;
        ensureCustomOption(`↑ ${file.name}`);
        updateDispatchCallout();
        await renderDocument({ silent: false, preservePage: false, clearPreview: true });
      } catch (error) {
        setStatus(status, "error", `Failed to read file: ${String(error)}`);
      }
    });

    astInput.addEventListener("paste", () => {
      setTimeout(() => {
        documentSource = "custom";
        activeBuiltinFixtureId = null;
        ensureCustomOption("↑ Custom (pasted)");
        updateDispatchCallout();
      }, 0);
    });

    astInput.addEventListener("input", () => {
      if (autoRenderTimer !== null) {
        clearTimeout(autoRenderTimer);
      }

      autoRenderTimer = window.setTimeout(() => {
        autoRenderTimer = null;
        renderDocument({ silent: true, preservePage: true, clearPreview: false }).catch((error) => {
          setStatus(status, "error", String(error));
        });
      }, AUTO_RENDER_DEBOUNCE_MS);
    });

    copyButton.addEventListener("click", async () => {
      const originalText = copyButton.textContent ?? "Copy JSON";
      try {
        await navigator.clipboard.writeText(astInput.value);
        copyButton.textContent = "Copied!";
      } catch {
        copyButton.textContent = "Failed";
      }
      setTimeout(() => {
        copyButton.textContent = originalText;
      }, 1800);
    });

    populateFixtures();
    updatePaginationUi();
    updateDispatchCallout();

    if (fixtureSelect.value) {
      loadFixture(fixtureSelect.value);
    } else {
      astInput.value = formatDocumentJson(VMPrintPipeline.SAMPLE_DOCUMENT);
      setStatus(status, "idle", "Sample loaded. Edit the AST JSON above to render.");
    }

    updateBootMetric();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
