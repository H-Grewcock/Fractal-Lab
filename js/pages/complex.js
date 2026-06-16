// js/pages/complex.js:
import { View2D } from "../shared/view2D.js";
import { exportCanvasPNG } from "../shared/exportMedia.js";
import { renderMandelbrot } from "../complex/mandelbrotRenderer.js";
import { renderJulia } from "../complex/juliaRenderer.js";
import { createMandelJuliaConnection } from "../complex/mandelJuliaConnectionController.js";
import { DimensionLab } from "../shared/dimension/index.js";
import { typesetMath } from "../shared/mathjax.js";

// Throws error if missing element
const byId = (id) => {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Missing element #${id}`);
    }
    
    return el;
};

// Functions which read integers and decnimal numbers from input with fallback of invalid
const intVal = (el, fallback) => {
    const v = parseInt(el.value, 10);
    return Number.isFinite(v) ? v : fallback;
};
const numVal = (el, fallback) => {
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
};

// Formatting c value for display
function formatC(c) {
    const a = c.re ?? 0;
    const b = c.im ?? 0;
    const sign = b >= 0 ? "+" : "-";

    return `c = ${a.toFixed(5)} ${sign} ${Math.abs(b).toFixed(5)}i`;
}

// Converts mouse position (browser coordinates) -> mathematical world coordinates
function clientToWorld(view2d, clientX, clientY) {
    const canvas = view2d.canvas;
    const rect = canvas.getBoundingClientRect();
    // CSS-pixel mouse coordinates -> canvas pixel coordinates
    const cx = (clientX - rect.left) * (canvas.width / rect.width);
    const cy = (clientY - rect.top) * (canvas.height / rect.height);

    return view2d.canvasPxToWorld(cx, cy);
}

// Function shwos one tab pane and hides the others
// tabKey: "mandelbrot", "julia", "connection"
function showOnlyPane(tabKey) {
    // Updates tab button active state
    document.querySelectorAll(".tab").forEach((b) => {
        const on = b.dataset.tab === tabKey;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
    });

    // Updates visible tab content
    document.querySelectorAll(".tabpane").forEach((p) => {
        p.classList.toggle("is-active", p.dataset.pane === tabKey);
    });

    // Ensures Julia parameter controls only shown on Julia tab
    const juliaControls = document.getElementById("juliaControls");
    if (juliaControls) {
        juliaControls.style.display = tabKey === "julia" ? "block" : "none";
    }
}

// Double-click zoom to View2D canvas
function installDoubleClickZoom(view2d, drawAfter, factor = 1.6) {
    view2d.canvas.addEventListener("dblclick", (e) => {
        e.preventDefault();

        // Converts clicked point to world coordinates
        const w = clientToWorld(view2d, e.clientX, e.clientY);
        // Shift reverses zoom direction, i.e. shift + double click zooms out
        const f = e.shiftKey ? 1 / factor : factor;
        // Double click zooms in
        view2d.zoomAtWorldPoint(w.x, w.y, f, { trigger: false });

        // Redraws after zooming if draw callback given
        if (typeof drawAfter === "function") {
            drawAfter();
        }
    });
}

// Waits until next animation frame using requestAnimationFrame()
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

function makeTimeoutDebounce(fn, ms = 120) {
    let t = null;
    return () => {
        if (t) {
            clearTimeout(t)
        }

        // Debounces function using setTimeout()
        // allows software to wait until events stop, i.e. wheel scrolling before we redraw
        t = setTimeout(() => {
            t = null;
            fn();
        }, ms);
    };
}

// Dictates redraw behaviour after interactions
function installRenderOnInteraction({ canvas, isActiveTab, draw, consumeChanged }) {
    const redrawIfChanged = () => {
        if (!isActiveTab()) return;
        if (typeof consumeChanged === "function" && !consumeChanged()) return;
        draw();
    };

    const wheelDone = makeTimeoutDebounce(() => {
        redrawIfChanged();
    }, 140);

    // Redraws after stopping wheel zoom
    canvas.addEventListener("wheel", () => {
        wheelDone();
    }, { passive: true });

    // Redraws after mouse up, i.e. stopping drag-to-pan
    window.addEventListener("mouseup", () => {
        redrawIfChanged();
    });
}

// REturns canvas for currently active tab
function getActiveCanvas({ activeTab, mandelCanvas, juliaCanvas, mandelConnCanvas, juliaConnCanvas }) {
    if (activeTab === "mandelbrot") return mandelCanvas;
    if (activeTab === "julia") return juliaCanvas;
    if (activeTab === "connection") return mandelConnCanvas;

    return mandelCanvas;
}

// Picks canvas based on dimension string
// used for dimension tools
function pickCanvasByTarget({ target, activeTab, mandelCanvas, juliaCanvas, mandelConnCanvas, juliaConnCanvas }) {
    if (target === "active") {
        return getActiveCanvas({
            activeTab, 
            mandelCanvas, 
            juliaCanvas, 
            mandelConnCanvas, 
            juliaConnCanvas
        });
    }

    if (target === "mandelbrot") return mandelCanvas;
    if (target === "julia") return juliaCanvas;
    if (target === "connectionLeft") return mandelConnCanvas;
    if (target === "connectionRight") return juliaConnCanvas;

    return mandelCanvas;
}

// Function used for dimension estimation; determined fractal family, canvas and view
function pickTargetInfo({
    target,
    activeTab,
    mandelCanvas,
    juliaCanvas,
    mandelConnCanvas,
    juliaConnCanvas,
    mandelView,
    juliaView,
    mandelConnView,
    juliaConnView,
}) {
    const resolved = target === "active" ? activeTab : target;
    // If Julia tab or RHS connection canvas
    if (resolved === "julia" || resolved === "connectionRight") {
        return {
            family: "julia",
            canvas: resolved === "julia" ? juliaCanvas : juliaConnCanvas,
            view: resolved === "julia" ? juliaView : juliaConnView,
        };
    }
    // Assume Mandelbrot
    return {
        family: "mandelbrot",
        canvas: resolved === "connectionLeft" ? mandelConnCanvas : mandelCanvas,
        view: resolved === "connectionLeft" ? mandelConnView : mandelView,
    };
}

function setDimReadout({ valueEl, metaEl }, result, { label = "" } = {}) {
    if (!result || !Number.isFinite(result.dimension)) {
        valueEl.textContent = "-";
        metaEl.textContent = "Could not estimate (try increasing samples / changing max box).";
        return;
    }

    const d = result.dimension;
    const r2 = result.fit?.r2;

    valueEl.textContent = `${d.toFixed(4)}`;

    const r2txt = Number.isFinite(r2)
        ? `, \\(R^2 = ${r2.toFixed(3)}\\)`
        : "";
    // Updates dimension result display
    metaEl.textContent = `${label}${label ? " | " : ""}${result.estimator}${r2txt}`;
    typesetMath(metaEl);
}

function makeTimeoutDebouncer(fn, ms = 220) {
    let t = null;

    return () => {
        if (t) clearTimeout(t);

        t = setTimeout(() => {
            t = null;
            fn();
        }, ms);
    };
}

// Escape time calculation: Mandelbrot set
function escapeMandelbrot(cx, cy, maxIter) {
    // z0 = 0
    let x = 0, y = 0, iter = 0;

    while (x * x + y * y <= 4 && iter < maxIter) {
        // Iterates through z |-> z**2 + c, where c = cx + i cy
        const xt = x * x - y * y + cx;

        y = 2 * x * y + cy;
        x = xt;

        iter++;
    }
    return iter;
}

// Escape time calculation: Julia set
function escapeJulia(zx0, zy0, cre, cim, maxIter) {
    // z0 = zx0 + i zy0
    let x = zx0, y = zy0, iter = 0;

    while (x * x + y * y <= 4 && iter < maxIter) {
        // Iterates through z |-> z**2 + c
        const xt = x * x - y * y + cre;

        y = 2 * x * y + cim;
        x = xt;

        iter++;
    }

    return iter;
}

// Builds escape data for either Mandelbrot or Julia set
function makeEscapeData({ family, view, size, maxIter, c }) {
    const mask = new Uint8Array(size * size);
    const iterations = new Uint16Array(size * size);

    const xMin = view.view.xMin, xMax = view.view.xMax;
    const yMin = view.view.yMin, yMax = view.view.yMax;

    // Goes through each point
    for (let y = 0; y < size; y++) {
        const cy = yMax - (y / (size - 1)) * (yMax - yMin);
        for (let x = 0; x < size; x++) {
            // Converts pixel row to mathematical x-coordinate
            const cx = xMin + (x / (size - 1)) * (xMax - xMin);

            const iter = family === "julia"
                ? escapeJulia(cx, cy, c.re, c.im, maxIter)
                : escapeMandelbrot(cx, cy, maxIter);
            
            const idx = y * size + x;
            iterations[idx] = iter;

            // Interior means orbit did not escape by maxIter
            mask[idx] = iter >= maxIter ? 1 : 0;
        }
    }

    // Returns:
    // - interior mask: 1 if point did not escape within maxIter
    // - iterations: escape time for each point
    return { interior: mask, iterations };
}

// Builds boundary mask from binary interior mask
// Pixel is a boundary if one of its direct neighbours has a different inside/outside value
function boundaryFromBinaryMask(mask, w, h) {
    const out = new Uint8Array(w * h);

    // Skips outermost border: prevents checking outside array
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const v = mask[i];
            
            if (
                v !== mask[i - 1] ||
                v !== mask[i + 1] ||
                v !== mask[i - w] ||
                v !== mask[i + w]
            ) out[i] = 1;
        }
    }
    return out;
}

// Important function added:
// Mandelbrot boundary calculation is tricky and delicate, so creates a more generous Mandelbrot
// frontier mask, which includes:
// - Direct inside/outside boundary pixels
// - Exterior pixels with high escape time (near the boundary)
// We are over-estimating the Mandelbrot set
function mandelbrotFrontierMask(interior, iterations, w, h, maxIter) {
    const out = boundaryFromBinaryMask(interior, w, h);

    // Points with a long escape time close to the boundary
    const highDwell = Math.max(8, Math.floor(maxIter * 0.58));

    for (let i = 0; i < iterations.length; i++) {
        if (!interior[i] && iterations[i] >= highDwell) {
            out[i] = 1;
        }
    }

    return out;
}

// Function downsamples canvases to smaller temporary canvas
// Used for image-based dimension estimates
function downsampleToCanvas(srcCanvas, size) {
    const s = Math.max(32, size | 0);
    const off = document.createElement("canvas");
    off.width = s;
    off.height = s;

    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.imageSmoothingEnabled = false;

    octx.clearRect(0, 0, s, s);
    octx.drawImage(srcCanvas, 0, 0, s, s);

    return { off, octx, size: s };
}

// Function calculates Euclidean distance between two RGB colours
function rgbDist(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];

    return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Builds boundary mask from image colour changes
function makeBoundaryMaskFromImageData(img, w, h, { threshold = 28 } = {}) {
    const mask = new Uint8Array(w * h);
    const d = img.data;

    const getRGB = (i) => [d[i], d[i + 1], d[i + 2]];

    // Detects edges by comparing each pixel to right and lower neighbour
    // Loops through each pixel
    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const idx = y * w + x;

            const i0 = 4 * idx;
            const iR = 4 * (idx + 1);
            const iD = 4 * (idx + w);

            const p = getRGB(i0);
            const pr = getRGB(iR);
            const pd = getRGB(iD);

            // If RGB difference large enough, pixel is part of a boundary
            const e = (rgbDist(p, pr) > threshold) || (rgbDist(p, pd) > threshold);
            mask[idx] = e ? 1 : 0;
        }
    }

    return mask;
}

// Builds interior mask from image data; assumes interior points are black-ish
function makeInteriorMaskFromImageData(img, w, h, { blackThresh = 18 } = {}) {
    const mask = new Uint8Array(w * h);
    const d = img.data;

    for (let i = 0, px = 0; i < d.length; i += 4, px++) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;   // perceived brightness
        mask[px] = lum < blackThresh ? 1 : 0;
    }
    
    return mask;
}

// === STATES === //

let activeTab = "mandelbrot";       // Starts up with Mandelbrot canvas
let drawGrid = false;
// Cancel tokens used for async renders
let mandelCancel = { cancelled: false };
let juliaCancel = { cancelled: false };
let connCancel = { cancelled: false };

function resetCancel(old) {
    if (old) {
        // Cancels old render and returns new one
        old.cancelled = true;
    }

    return { cancelled: false };
}

async function main() {
    const iterEl = byId("complexIter");
    const qualityEl = byId("complexQuality");

    // Julia parameter controls
    const cReadout = byId("cReadout");
    const cRealEl = byId("cReal");
    const cImagEl = byId("cImag");

    const drawBtn = byId("drawBtn");
    const resetBtn = byId("resetBtn");
    const exportBtn = byId("exportBtn");
    const toggleGridBtn = byId("toggleGridBtn");

    const mandelCanvas = byId("mandelCanvas");
    const juliaCanvas = byId("juliaCanvas");
    const mandelConnCanvas = byId("mandelConnCanvas");
    const juliaConnCanvas = byId("juliaConnCanvas");

    // Dimension controls
    const dimTargetEl = byId("dimTarget");
    const dimModeEl = byId("dimMode");
    const dimDownsampleEl = byId("dimDownsample");
    const dimMinBoxEl = byId("dimMinBox");
    const dimMaxBoxEl = byId("dimMaxBox");
    const dimSamplesEl = byId("dimSamples");
    const dimAutoEl = byId("dimAutoAfterDraw");
    const dimRunBtn = byId("dimRunBtn");
    const dimValueEl = byId("dimValue");
    const dimMetaEl = byId("dimMeta");

    // Current c value
    let c = { re: numVal(cRealEl, -0.8), im: numVal(cImagEl, 0.156) };
    cReadout.textContent = formatC(c);

    const changedViews = new Set();
    const markViewChanged = (key) => changedViews.add(key);
    const consumeViewChanged = (key) => {
        const changed = changedViews.has(key);
        changedViews.delete(key);
        return changed;
    };
    
    // Function updates Julia parameter
    function setC(newC, options = {}) {
        const { syncInputs = true } = options;  // syncInputs controls whether input boxes should be updated
        c = {
            re: Number.isFinite(newC.re) ? newC.re : 0,
            im: Number.isFinite(newC.im) ? newC.im : 0,
        };

        if (syncInputs) {
            cRealEl.value = String(c.re);
            cImagEl.value = String(c.im);
        }

        cReadout.textContent = formatC(c);  // UI readout
    }

    // Mandelbrot-only tab:
    async function drawMandelbrotTab() {
        mandelCancel = resetCancel(mandelCancel);
        mandelView.resizeToDisplay({ trigger: false });

        await renderMandelbrot({
            ctx: mandelCanvas.getContext("2d", { willReadFrequently: true }),
            canvas: mandelCanvas,
            view: mandelView.view,
            maxIter: intVal(iterEl, 300),
            quality: intVal(qualityEl, 1),
            drawGrid,
            cancelToken: mandelCancel,
        });
    }

    // Julia-only tab using c value
    async function drawJuliaTab() {
        juliaCancel = resetCancel(juliaCancel);
        juliaView.resizeToDisplay({ trigger: false });

        await renderJulia({
            ctx: juliaCanvas.getContext("2d", { willReadFrequently: true }),
            canvas: juliaCanvas,
            view: juliaView.view,
            maxIter: intVal(iterEl, 300),
            quality: intVal(qualityEl, 1),
            c,
            drawGrid,
            cancelToken: juliaCancel,
        });
    }

    // Mandelbrot-Julia connection tab
    let connection;
    async function drawConnectionTab() {
        connCancel = resetCancel(connCancel);

        await nextFrame();
        mandelConnView.resizeToDisplay({ trigger: false });
        juliaConnView.resizeToDisplay({ trigger: false });

        // Keeps connection controller in sync with c
        connection.setC(c, { syncInputs: false });

        await connection.drawBoth();
    }
    
    // Draws active tab
    async function drawActive() {
        if (activeTab === "mandelbrot") return drawMandelbrotTab();
        if (activeTab === "julia") return drawJuliaTab();

        return drawConnectionTab();
    }

    // === VIEW === //
    const mandelView = new View2D({
        canvas: mandelCanvas,
        initial: { xMin: -2.5, xMax: 1.0, yMin: -1.5, yMax: 1.5 },
        enableDragPan: true,
        enableWheelZoom: true,
        enableClickZoom: false,
        wheelZoomFactor: 1.15,
        zoomIndicatorEl: document.getElementById("zoom-indicator"),
        mouseCoordsEl: document.getElementById("mouse-coords"),
        onChange: () => markViewChanged("mandelbrot"),
    });
    installDoubleClickZoom(mandelView, () => { if (activeTab === "mandelbrot") drawActive(); });

    const juliaView = new View2D({
        canvas: juliaCanvas,
        initial: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
        enableDragPan: true,
        enableWheelZoom: true,
        enableClickZoom: false,
        wheelZoomFactor: 1.15,
        zoomIndicatorEl: document.getElementById("zoom-indicator-julia"),
        mouseCoordsEl: document.getElementById("mouse-coords-julia"),
        onChange: () => markViewChanged("julia"),
    });
    installDoubleClickZoom(juliaView, () => { if (activeTab === "julia") drawActive(); });

    const mandelConnView = new View2D({
        canvas: mandelConnCanvas,
        initial: { xMin: -2.5, xMax: 1.0, yMin: -1.5, yMax: 1.5 },
        enableDragPan: true,
        enableWheelZoom: true,
        enableClickZoom: false,
        zoomIndicatorEl: null,
        mouseCoordsEl: null,
        onChange: () => markViewChanged("connection"),
    });
    installDoubleClickZoom(mandelConnView, () => { if (activeTab === "connection") drawActive(); });

    const juliaConnView = new View2D({
        canvas: juliaConnCanvas,
        initial: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
        enableDragPan: true,
        enableWheelZoom: true,
        enableClickZoom: false,
        zoomIndicatorEl: null,
        mouseCoordsEl: null,
        onChange: () => markViewChanged("connection"),
    });
    installDoubleClickZoom(juliaConnView, () => { if (activeTab === "connection") drawActive(); });

    // Ensures all canvases are the right size before rendering
    mandelView.resizeToDisplay({ trigger: false });
    juliaView.resizeToDisplay({ trigger: false });
    mandelConnView.resizeToDisplay({ trigger: false });
    juliaConnView.resizeToDisplay({ trigger: false });

    // Connection controller: central controller which handles clicking to choose c
    // and rendering corresponding Julia set on RHS
    connection = createMandelJuliaConnection({
        mandelCanvas: mandelConnCanvas,
        juliaCanvas: juliaConnCanvas,
        mandelView: mandelConnView,
        juliaView: juliaConnView,
        getMaxIter: () => intVal(iterEl, 300),
        getQuality: () => intVal(qualityEl, 1),
        getDrawGrid: () => drawGrid,

        // Syncs selected c to main controls/UI readout
        setCReadout: (newC, opts) => setC(newC, opts),
    });

    // Redrawing function after mouse interactions on each canvas, e.g. wheel/pan interactions
    installRenderOnInteraction({
        canvas: mandelCanvas,
        isActiveTab: () => activeTab === "mandelbrot",
        draw: () => drawActive(),
        consumeChanged: () => consumeViewChanged("mandelbrot"),
    });
    installRenderOnInteraction({
        canvas: juliaCanvas,
        isActiveTab: () => activeTab === "julia",
        draw: () => drawActive(),
        consumeChanged: () => consumeViewChanged("julia"),
    });
    installRenderOnInteraction({
        canvas: mandelConnCanvas,
        isActiveTab: () => activeTab === "connection",
        draw: () => drawActive(),
        consumeChanged: () => consumeViewChanged("connection"),
    });
    installRenderOnInteraction({
        canvas: juliaConnCanvas,
        isActiveTab: () => activeTab === "connection",
        draw: () => drawActive(),
        consumeChanged: () => consumeViewChanged("connection"),
    });

    async function runDimensionEstimate({ label = "" } = {}) {
        dimValueEl.textContent = "...";
        dimMetaEl.textContent = "Estimating...";

        const target = dimTargetEl.value;
        const mode = dimModeEl.value;

        const ds = Math.max(128, intVal(dimDownsampleEl, 768));
        const minBox = Math.max(1, intVal(dimMinBoxEl, 2));
        const maxBox = Math.max(minBox + 1, intVal(dimMaxBoxEl, 256));
        const samples = Math.max(6, intVal(dimSamplesEl, 12));

        // Determines which canvas, view and fractal family to use to estimate
        const info = pickTargetInfo({
            target,
            activeTab,
            mandelCanvas,
            juliaCanvas,
            mandelConnCanvas,
            juliaConnCanvas,
            mandelView,
            juliaView,
            mandelConnView,
            juliaConnView,
        });

        const size = ds;
        const maxIter = intVal(iterEl, 300);
        // Generates interior/escape data at chosen sample si\e
        const { interior, iterations } = makeEscapeData({
            family: info.family,
            view: info.view,
            size,
            maxIter,
            c,
        });

        // Chose mask for box-counting
        // "interior" counts filled interior (non-escaping) set
        // "boundary" counts the boundary mask
        const mask = (mode === "interior")
            ? interior
            : (info.family === "mandelbrot"
                ? mandelbrotFrontierMask(interior, iterations, size, size, maxIter)
                : boundaryFromBinaryMask(interior, size, size));

        let result;

        try {
            // Runs shared bitmap box-counting estimator
            result = DimensionLab.run({
                estimator: "boxCountBitmap",
                input: {
                    kind: "bitmap",
                    data: { width: size, height: size, mask }
                },
                options: { minBox, maxBox, samples },
            });
        } catch (err) {
            console.error(err);

            dimValueEl.textContent = "-";
            dimMetaEl.textContent = `Dimension error: ${err.message}`;

            return null;
        }

        // Specific separate display for the Mandelbrot boundary
        // Mandelbrot set has Hausdorff dimension 2, and the box-counting seems to be way off
        if (info.family === "mandelbrot" && mode === "boundary") {
            const finite = Number.isFinite(result.dimension) 
                ? result.dimension.toFixed(4) 
                : "-";
            
                const r2 = result.fit?.r2;

            dimValueEl.textContent = "2.0000";
            dimMetaEl.textContent = `${label || `${target}/${mode}`} | Mandelbrot boundary Hausdorff dimension; finite render box-count=${finite}${Number.isFinite(r2) ? `, \\(R^2 = ${r2.toFixed(3)}\\)` : ""}`;
            typesetMath(dimMetaEl);
            
            return result;
        }

        const lab = label || `${target}/${mode}`;
        setDimReadout(
            { valueEl: dimValueEl, metaEl: dimMetaEl }, 
            result, { label: lab }
        );
        
        return result;
    }

    dimRunBtn.addEventListener("click", () => runDimensionEstimate());

    async function maybeAutoDim() {
        // If automatic dimension calculations checkbox enabled, runs dimension estimation
        if (!dimAutoEl.checked) return;

        await runDimensionEstimate({ label: "auto" });
    }

    // Updates real part while typing
    cRealEl.addEventListener("input", () => {
        const v = parseFloat(cRealEl.value);
        if (!Number.isFinite(v)) return; // allow partial typing

        setC({ re: v, im: c.im }, { syncInputs: false });
        if (activeTab === "julia") {
            drawJuliaTab();
        }
    });

    // Updates imaginary part while typing
    cImagEl.addEventListener("input", () => {
        const v = parseFloat(cImagEl.value);
        if (!Number.isFinite(v)) return; // allows partial typing

        setC({ re: c.re, im: v }, { syncInputs: false });
        if (activeTab === "julia") {
            drawJuliaTab();
        }
    });

    drawBtn.addEventListener("click", async () => {
        await drawActive();
        await maybeAutoDim();
    });

    // Function: resets view for current tab
    resetBtn.addEventListener("click", async () => {
        if (activeTab === "mandelbrot") mandelView.reset({ trigger: false });
        if (activeTab === "julia") juliaView.reset({ trigger: false });
        
        if (activeTab === "connection") {
            mandelConnView.reset({ trigger: false });
            juliaConnView.reset({ trigger: false });
        }

        await drawActive();
        await maybeAutoDim();
    });

    // Exports canvas depending on active tab
    exportBtn.addEventListener("click", () => {
        if (activeTab === "mandelbrot") return exportCanvasPNG(mandelCanvas, "mandelbrot.png");
        if (activeTab === "julia") return exportCanvasPNG(juliaCanvas, "julia.png");
        
        // Assumes connection mode; exports both Mandelbrot and Julia canvases
        exportCanvasPNG(mandelConnCanvas, "connection_mandelbrot.png");
        exportCanvasPNG(juliaConnCanvas, "connection_julia.png");
    });

    // Function: toggles grid overlay and redraws
    toggleGridBtn.addEventListener("click", async () => {
        drawGrid = !drawGrid;

        await drawActive();
        await maybeAutoDim();
    });

    // Function: tab switching
    document.querySelectorAll(".tab").forEach((b) => {
        b.addEventListener("click", async () => {
            activeTab = b.dataset.tab;

            showOnlyPane(activeTab);

            // Wait to update layout before drawing new canvas
            await nextFrame();
            await drawActive();
        });
    });

    // Set-ups initiial tab
    showOnlyPane(activeTab);
    // Renders initial drawing
    await drawActive();

    function resizeActiveCanvasToDisplay() {
        if (activeTab === "mandelbrot") {
            return mandelView.resizeToDisplay({ trigger: false });
        }

        if (activeTab === "julia") {
            return juliaView.resizeToDisplay({ trigger: false });
        }

        const leftChanged = mandelConnView.resizeToDisplay({ trigger: false });
        const rightChanged = juliaConnView.resizeToDisplay({ trigger: false });
        return leftChanged || rightChanged;
    }

    // Prevents constantly resizing when scrolling
    const redrawAfterSettledResize = makeTimeoutDebouncer(async () => {
        if (resizeActiveCanvasToDisplay()) {
            await drawActive();
        }
    }, 260);

    // Redraw only after the active canvas really changes size, and only once the resize has settled.
    window.addEventListener("resize", redrawAfterSettledResize);
}

// Starts complex lab
main().catch((err) => {
    console.error(err);
    // Shows error if set-up fails
    alert(`Complex Lab failed:\n${err.message}\n\nCheck DevTools Console for details.`);
});
