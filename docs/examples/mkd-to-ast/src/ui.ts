function init(): void {
    const tStart = performance.now();

    function $<T extends HTMLElement>(id: string): T {
        const el = document.getElementById(id) as T | null;
        if (!el) throw new Error(`Missing element: #${id}`);
        return el;
    }

    const mdInput    = $<HTMLTextAreaElement>('md-input');
    const jsonOutput = $<HTMLTextAreaElement>('json-output');
    const themeSelect = $<HTMLSelectElement>('theme-select');
    const transmutBtn = $<HTMLButtonElement>('transmute-btn');
    const copyBtn    = $<HTMLButtonElement>('copy-btn');
    const dlBtn      = $<HTMLAnchorElement>('download-link');
    const status     = $<HTMLParagraphElement>('status');
    const elemCount  = $<HTMLSpanElement>('elem-count');
    const renderMs   = $<HTMLSpanElement>('render-ms');
    const bootMs     = $<HTMLSpanElement>('boot-ms');

    // Populate theme selector
    for (const name of MkdToAstPipeline.THEME_NAMES) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        themeSelect.appendChild(opt);
    }

    // Load sample
    mdInput.value = MkdToAstPipeline.SAMPLE_MARKDOWN;

    // Boot timing
    bootMs.textContent = `${(performance.now() - tStart).toFixed(1)} ms`;

    // State
    let lastBlob: string | null = null;

    function setStatus(state: 'idle' | 'running' | 'ok' | 'error', msg: string): void {
        status.dataset.state = state;
        status.textContent = msg;
    }

    function clearDownload(): void {
        if (lastBlob) { URL.revokeObjectURL(lastBlob); lastBlob = null; }
        dlBtn.removeAttribute('href');
        dlBtn.setAttribute('aria-disabled', 'true');
    }

    function run(): void {
        clearDownload();
        setStatus('running', 'Transmuting…');
        transmutBtn.disabled = true;

        requestAnimationFrame(() => {
            try {
                const { json, elementCount, ms } = MkdToAstPipeline.runTransmute(
                    mdInput.value,
                    themeSelect.value
                );
                jsonOutput.value = json + '\n';
                elemCount.textContent = String(elementCount);
                renderMs.textContent = `${ms.toFixed(1)} ms`;
                setStatus('ok', '');

                const blob = new Blob([json], { type: 'application/json' });
                lastBlob = URL.createObjectURL(blob);
                dlBtn.href = lastBlob;
                dlBtn.setAttribute('aria-disabled', 'false');
                dlBtn.download = 'document.json';
            } catch (err) {
                setStatus('error', String(err));
            } finally {
                transmutBtn.disabled = false;
            }
        });
    }

    // Initial run
    run();

    // Listeners
    transmutBtn.addEventListener('click', run);
    themeSelect.addEventListener('change', run);

    copyBtn.addEventListener('click', async () => {
        const text = jsonOutput.value.trim();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            const orig = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        } catch {
            jsonOutput.select();
        }
    });
}

document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
