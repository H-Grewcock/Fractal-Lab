// js/pages/planeIts.js:
import { qs, clamp, parseNumber } from "../shared/dom.js";
import { View2D } from "../shared/view2D.js";
import { exportCanvasPNG } from "../shared/exportMedia.js";
import { DimensionLab } from "../shared/dimension/index.js";

// Function parses text range "-3, 3" into { min: 3, max: 3 }
function parseRangeStr(rangeStr, fallback = { min: -3, max: 3 }) {
    // If invalid type, returns fallback range
    if (typeof rangeStr !== "string") return { ...fallback };
    const parts = rangeStr.split(",").map((v) => Number(String(v).trim()));
    
    // If invalid input, returns fallback range
    if (parts.length !== 2 || !parts.every(Number.isFinite)) {
        return { ...fallback };
    }
    
    const [min, max] = parts;
    if (max <= min) return { ...fallback };

    return { min, max };
}

// Added
// Allows user-defined maths functions/constants to be used in f & g formulas
const MATH_KEYS = [
    "abs","acos","acosh","asin","asinh","atan","atan2","atanh","cbrt","ceil",
    "cos","cosh","exp","expm1","floor","fround","hypot","log","log1p","log10",
    "log2","max","min","pow","random","round","sign","sin","sinh","sqrt","tan","tanh","trunc",
    "PI","E"
];
// Object contains allowed Math functions/constants
const MATH_SCOPE = Object.fromEntries(MATH_KEYS.map((k) => [k, Math[k]]));

// Function compiles user's f(x,y) and g(x,y) strings into atual functions
function compileFG(fxStr, gyStr) {
    try {
        const fRaw = new Function(
            "x", "y", "scope",
            // Gives access to Math scope
            `const { ${MATH_KEYS.join(",")} } = scope; return (${fxStr});`
        );
        const gRaw = new Function(
            "x", "y", "scope",
            `const { ${MATH_KEYS.join(",")} } = scope; return (${gyStr});`
        );
        return {
            f: (x, y) => fRaw(x, y, MATH_SCOPE),
            g: (x, y) => gRaw(x, y, MATH_SCOPE),
        };
    } catch {
        throw new Error("Invalid function input.");
    }
}


function clear(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);      // clears canvas
}

function cssVar(name, fallback = "") {
    // Reads CSS variable from the current theme
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    return v || fallback;
}
function getPalette() {
    return {
        // Returns current theme colours used for the drawing
        ink: cssVar("--ink", "#111"),
        grid: cssVar("--line", "#888"),
        gridSoft: cssVar("--muted", "#777"),
        surface: cssVar("--surface", "#fff"),
    };
}

// Dimensions:
// Function downsamples canvases to smaller temporary canvas
// Used for image-based dimension estimates
function downsampleToCanvas(srcCanvas, size) {
    const s = Math.max(128, size | 0);

    const off = document.createElement("canvas");
    off.width = s;
    off.height = s;

    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.imageSmoothingEnabled = false;     // Keeps hard pixel edges rather than blurring mask

    octx.clearRect(0, 0, s, s);
    octx.drawImage(srcCanvas, 0, 0, s, s);
    
    return { octx, size: s };
}

// Builds binary mask from canvas image data
function makeInkMaskFromImageData(img, w, h, { alphaMin = 16 } = {}) {
    const mask = new Uint8Array(w * h);
    const d = img.data;

    // Iterates through pixels
    for (let i = 0, px = 0; i < d.length; i += 4, px++) {
        const a = d[i + 3];
        mask[px] = a >= alphaMin ? 1 : 0;   // Any pixel with alpha >= alphaMin treated as occupied/ink
    }

    return mask;
}

// Function creates boundary mask from occupied mask
function makeBoundaryFromMask(mask, w, h) {
    const out = new Uint8Array(w * h);
    const idx = (x, y) => y * w + x;

    // Iterates through pixels
    // Skips outer border to avoid reading outside the array
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = idx(x, y);

            // Only occupied pixels can be part of boundary
            if (!mask[i]) continue;
            if (
                !mask[idx(x + 1, y)] ||
                !mask[idx(x - 1, y)] ||
                !mask[idx(x, y + 1)] ||
                !mask[idx(x, y - 1)]
            ) {
                // Pixels is boundary if it is occupied & at least one of its direct neighbours is empty
                out[i] = 1;
            }
        }
    }

    return out;
}

function drawAxes(ctx, view2d) {
    const w = view2d.getWidthPx();
    const h = view2d.getHeightPx();
    const P = getPalette();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1;

    // Draws axes using current View2D coordinate conversion
    // x-axis
    {
        const p = view2d.worldToCanvasPx(0, 0);
        ctx.beginPath();
        ctx.moveTo(0, p.y);
        ctx.lineTo(w, p.y);
        ctx.stroke();
    }
    // y-axis
    {
        const p = view2d.worldToCanvasPx(0, 0);
        ctx.beginPath();
        ctx.moveTo(p.x, 0);
        ctx.lineTo(p.x, h);
        ctx.stroke();
    }

    ctx.restore();
}

function drawPoint(ctx, view2d, x, y, r) {
    const p = view2d.worldToCanvasPx(x, y);
    const w = view2d.getWidthPx();
    const h = view2d.getHeightPx();

    // Skips points far outside the canvas
    if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) return;

    // Draws one point in world coordinates
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawSegment(ctx, view2d, x1, y1, x2, y2) {
    const p1 = view2d.worldToCanvasPx(x1, y1);
    const p2 = view2d.worldToCanvasPx(x2, y2);
    const w = view2d.getWidthPx();
    const h = view2d.getHeightPx();

    // Skips segments completely outside visilbe gion
    if ((p1.x < -50 && p2.x < -50) || (p1.x > w + 50 && p2.x > w + 50)) return;
    if ((p1.y < -50 && p2.y < -50) || (p1.y > h + 50 && p2.y > h + 50)) return;

    // Adds line segment between two world-coordinate points to the current path
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
}

// Orbit Engines:
// Iterates map: (x, y) -> (f(x,y), g(x,y))
function iterateOnce(f, g, x, y) {
    const nx = f(x, y);
    const ny = g(x, y);

    return [
        Number.isFinite(nx) ? nx : NaN, 
        Number.isFinite(ny) ? ny : NaN
    ];
}

function buildGridSeeds(view, N) {
    const seeds = [];

    // Ensures grid size is an integer with at least 2 points per side
    const nx = Math.max(2, N | 0);
    const ny = nx;
    
    // Builds N x N grid of seed points across current view window
    for (let j = 0; j < ny; j++) {
        // ty moves from 0 to 1 from bottom/top edges of view range
        const ty = j / (ny - 1);
        const y0 = view.yMin + ty * (view.yMax - view.yMin);

        for (let i = 0; i < nx; i++) {
            // tx moves from 0 to 1 across x-range of view
            const tx = i / (nx - 1);
            const x0 = view.xMin + tx * (view.xMax - view.xMin);

            // Stores current seed point
            seeds.push([x0, y0]);
        }
    }
    
    return seeds;
}

// Collects UI elements
// These are functions so they reference the current element from the page
const UI = {
    canvas: () => qs("#planeCanvas"),
    readout: () => qs("#planeReadout"),
    iterReadout: () => qs("#iter-readout"),

    mode: () => qs("#modeSelect"),
    fx: () => qs("#fx"),
    gy: () => qs("#gy"),
    xRange: () => qs("#xRange"),
    yRange: () => qs("#yRange"),

    dotSize: () => qs("#dotSize"),
    speed: () => qs("#speed"),

    seedBox: () => qs("#singleSeedBox"),
    seedX: () => qs("#seedX"),
    seedY: () => qs("#seedY"),

    gridBox: () => qs("#gridBox"),
    gridN: () => qs("#gridN"),
    gridIters: () => qs("#gridIters"),

    linesMode: () => qs("#linesMode"),

    playBtn: () => qs("#playBtn"),
    stepBtn: () => qs("#stepBtn"),
    resetWindowBtn: () => qs("#resetWindowBtn"),
    clearBtn: () => qs("#clearBtn"),
    zoomBtn: () => qs("#zoomBtn"),
    unzoomBtn: () => qs("#unzoomBtn"),
    exportBtn: () => qs("#exportBtn"),

    examplesList: () => qs("#examplesList"),

    dimMode: () => qs("#dimMode"),
    dimDownsample: () => qs("#dimDownsample"),
    dimMinBox: () => qs("#dimMinBox"),
    dimMaxBox: () => qs("#dimMaxBox"),
    dimSamples: () => qs("#dimSamples"),
    dimRunBtn: () => qs("#dimRunBtn"),
    dimValue: () => qs("#dimValue"),
    dimMeta: () => qs("#dimMeta"),
};

// States
let view2d = null;
let ctx = null;

// Animation states
let playing = false;
let rafId = null;

// Compiled map functions
let f = null;
let g = null;

// Current mode: "single", "grid"
let mode = "single";

// Single orbit state
let x = 0, y = 0;
let orbitPts = [];

// Grid mode state
let gridSeeds = [];
let gridPts = [];
let gridStep = 0;

// Current dot radius
function dotRadius() { 
    return Math.max(1, parseNumber(UI.dotSize().value, 1)); 
}
function itersPerFrame() {
    // Number of iterations computed per animation frame
    return Math.max(1, parseNumber(UI.speed().value, 250) | 0);
}
function linesEnabled() { 
    // Enables conneting successive points with line segments
    return !!UI.linesMode().checked; 
}

function installDoubleClickZoom(view2d, factor = 1.6) {
    view2d.canvas.addEventListener("dblclick", (e) => {
        e.preventDefault();

        const rect = view2d.canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (view2d.canvas.width / rect.width);
        const cy = (e.clientY - rect.top) * (view2d.canvas.height / rect.height);
        
        const w = view2d.canvasPxToWorld(cx, cy);
        // Shift + double click zooms out
        const f = e.shiftKey ? 1 / factor : factor;
        // Double-click zoom:
        view2d.zoomAtWorldPoint(w.x, w.y, f, { trigger: true });
    });
}

function syncViewFromInputs() {
    // Reads x and y range inputs
    const xr = parseRangeStr(UI.xRange().value, { min: -3, max: 3 });
    const yr = parseRangeStr(UI.yRange().value, { min: -3, max: 3 });

    // Applies inputs to the View2D window
    view2d.setView(
        { xMin: xr.min, xMax: xr.max, yMin: yr.min, yMax: yr.max },
        { trigger: true }
    );
}

function syncInputsFromView() {
    const v = view2d.view;

    // Writes current View2D window to range input boxes
    UI.xRange().value = `${v.xMin.toFixed(2)}, ${v.xMax.toFixed(2)}`;
    UI.yRange().value = `${v.yMin.toFixed(2)}, ${v.yMax.toFixed(2)}`;
}

// Redraws single-orbit picture fully from stored orbit points
function fullRedrawSingle() {
    view2d.resizeToDisplay({ trigger: false });

    const w = view2d.getWidthPx();
    const h = view2d.getHeightPx();

    // Clears canvas and redraws coordinate axes
    clear(ctx, w, h);
    drawAxes(ctx, view2d);

    const r = dotRadius();
    const P = getPalette();

    ctx.save();
    // Drawing style for points and connecting lines
    ctx.fillStyle = P.ink;
    ctx.strokeStyle = P.ink;

    const pointAlpha = 0.92;
    const lineAlpha = 0.38;

    ctx.lineWidth = Math.max(1, r);

    if (!orbitPts.length) {
        ctx.restore(); return;
    }

    // If linesEnabled(), draws connecting lines first underneath points
    if (linesEnabled() && orbitPts.length >= 2) {
        ctx.globalAlpha = lineAlpha;
        ctx.beginPath();

        for (let i = 1; i < orbitPts.length; i++) {
            const [x1, y1] = orbitPts[i - 1];
            const [x2, y2] = orbitPts[i];
            // Ignores invalid points
            if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
                continue;
            }
            
            drawSegment(ctx, view2d, x1, y1, x2, y2);
        }
        
        ctx.stroke();
    }

    // Draws all orbit points
    ctx.globalAlpha = pointAlpha;
    for (const [px, py] of orbitPts) {
        // Ignores invalid inputs
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

        drawPoint(ctx, view2d, px, py, r);
    }

    ctx.restore();
}

// Function fully redraws grid-mode paths
function fullRedrawGrid() {
    view2d.resizeToDisplay({ trigger: false });

    const w = view2d.getWidthPx();
    const h = view2d.getHeightPx();

    // Clears canvas and redraws coordinate axes
    clear(ctx, w, h);
    drawAxes(ctx, view2d);

    const r = dotRadius();
    const P = getPalette();

    ctx.save();
    // Drawing style for points and connecting lines
    ctx.fillStyle = P.ink;
    ctx.strokeStyle = P.ink;

    const pointAlpha = 0.85;
    const lineAlpha = 0.28;

    ctx.lineWidth = Math.max(1, r);

    // Redraws every stored orbit/path in grid
    for (const path of gridPts) {
        if (!path || path.length < 1) continue;

        // Draws connected orbit lines when enabled
        if (linesEnabled() && path.length >= 2) {
            ctx.globalAlpha = lineAlpha;
            ctx.beginPath();

            for (let i = 1; i < path.length; i++) {
                const [x1, y1] = path[i - 1];
                const [x2, y2] = path[i];
                
                // Ignores invalid points rather than breaking the function
                if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
                    continue;
                }
                
                drawSegment(ctx, view2d, x1, y1, x2, y2);
            }

            ctx.stroke();
        } else {
            // Else: draws orbit as separate points
            ctx.globalAlpha = pointAlpha;

            for (const [px, py] of path) {
                if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
                
                drawPoint(ctx, view2d, px, py, r);
            }
        }
    }

    // Restores canvas state after changing alpha, stroke, fill, etc
    ctx.restore();
}

function fullRedraw() {
    syncInputsFromView();

    // Redraws whichever mode is active
    if (mode === "grid") {
        fullRedrawGrid();
    } else {
        fullRedrawSingle();
    }
}

function drawIncrementalSingle(fromIdx, toIdx) {
    // Uses current dot size and theme colours
    const r = dotRadius();
    const P = getPalette();

    ctx.save();
    // Drawing style for points and connecting lines
    ctx.fillStyle = P.ink;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = Math.max(1, r);

    // If linesEnabled, draws line segments between consecutive orbit points
    if (linesEnabled()) {
        ctx.globalAlpha = 0.38;
        ctx.beginPath();

        for (let i = Math.max(1, fromIdx); i <= toIdx; i++) {
            const [x1, y1] = orbitPts[i - 1] || [NaN, NaN];
            const [x2, y2] = orbitPts[i] || [NaN, NaN];

            // Skips invalid/missing points
            if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
                continue;
            }

            drawSegment(ctx, view2d, x1, y1, x2, y2);
        }

        ctx.stroke();
    }

    // Draws new orbit points over the top of the lines
    ctx.globalAlpha = 0.92;
    for (let i = fromIdx; i <= toIdx; i++) {
        const p = orbitPts[i];
        if (!p) continue;

        const [px, py] = p;
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        
        drawPoint(ctx, view2d, px, py, r);
    }

    ctx.restore();      // Restores canvas settings s.t. later drawing not affected
}

function stop() {
    playing = false;

    if (rafId) {
        cancelAnimationFrame(rafId);
    }

    rafId = null;
    UI.readout().textContent = "Paused.";
}

// Function compiles f & g from current input boxes
function compileFromInputs() {
    const out = compileFG(UI.fx().value, UI.gy().value);

    f = out.f;
    g = out.g;
}

function resetSingleOrbit({ clearPicture = true } = {}) {
    // Recompiles iteration functions from the current input boxes
    compileFromInputs();

    // If input invalid, falls back to 0
    x = parseNumber(UI.seedX().value, 0);
    y = parseNumber(UI.seedY().value, 0);

    orbitPts = [[x, y]];        // Stores starting point as first point in orbit

    view2d.resizeToDisplay({ trigger: false });
    if (clearPicture) {
        // Clears whole canvas
        clear(ctx, view2d.getWidthPx(), view2d.getHeightPx());
        // Redraws coordinate axes afterwards
        drawAxes(ctx, view2d);
    } else {
        // Leaving alone but state resets:
    }

    // Updates UI readout
    UI.iterReadout().textContent = `i = 0`;
    UI.readout().textContent = "Ready (single orbit).";
}

// Resets grid mode
function resetGrid({ clearPicture = true } = {}) {
    // Recompiles iteration functions from the current input boxes
    compileFromInputs();

    const N = Math.max(2, parseNumber(UI.gridN().value, 12) | 0);
    const iters = Math.max(1, parseNumber(UI.gridIters().value, 120) | 0);

    const v = view2d.view;
    gridSeeds = buildGridSeeds(v, N);
    gridPts = gridSeeds.map((s) => [s]);    // starts at seed point
    gridStep = 0;                           // initialising grid step

    view2d.resizeToDisplay({ trigger: false });
    if (clearPicture) {
        // Resets grid mode
        clear(ctx, view2d.getWidthPx(), view2d.getHeightPx());
        // Draws grid of starting points, giving each one its own path
        drawAxes(ctx, view2d);
    }

    // Updating UI readouts
    UI.iterReadout().textContent = `i = 0 / ${iters}`;
    UI.readout().textContent = `Ready (grid: ${N}x${N}).`;
}

function resetAll({ clearPicture = true } = {}) {
    stop();

    syncViewFromInputs();
    mode = UI.mode().value;

    // Shows correct controls for the active mode
    UI.seedBox().style.display = (mode === "single") ? "" : "none";
    UI.gridBox().style.display = (mode === "grid") ? "" : "none";

    // Resets active mode
    if (mode === "grid") {
        resetGrid({ clearPicture });
    } else {
        resetSingleOrbit({ clearPicture });
    }

    // Redraws the whole picture
    fullRedraw();
}

// Function performs one single visible step
function stepOnce() {
    // Ensures f & g exist
    if (!f || !g) {
        // Recompiles iteration functions from the current input boxes
        compileFromInputs();
    }

    // "single" mode: advances one orbit
    // "grid" mode: advances every seed path
    if (mode === "single") {
        const prevLen = orbitPts.length;
        const k = itersPerFrame();

        for (let i = 0; i < k; i++) {
            const [nx, ny] = iterateOnce(f, g, x, y);

            x = nx;
            y = ny;

            orbitPts.push([x, y]);
            // Prevents invalid inputs
            if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        }

        UI.iterReadout().textContent = `i = ${orbitPts.length - 1}`;
        UI.readout().textContent = "Drawing...";

        drawIncrementalSingle(prevLen, orbitPts.length - 1);

        return;
    }

    const itersMax = Math.max(1, parseNumber(UI.gridIters().value, 120) | 0);
    const k = itersPerFrame();
    const startStep = gridStep;

    for (let t = 0; t < k && gridStep < itersMax; t++) {
        gridStep++;

        for (let p = 0; p < gridPts.length; p++) {
            const path = gridPts[p];
            const last = path[path.length - 1];
            if (!last) continue;

            const [lx, ly] = last;
            const [nx, ny] = iterateOnce(f, g, lx, ly);

            path.push([nx, ny]);
        }
    }

    UI.iterReadout().textContent = `i = ${gridStep} / ${itersMax}`;
    UI.readout().textContent = "Drawing...";

    // Grid mode made simpler to keep correct by redrawing full picture
    if (gridStep !== startStep) {
        fullRedrawGrid();
    }
}

function animate() {
    if (!playing) return;
    stepOnce();

    // Animation loop using requestAnimationFrame()
    rafId = requestAnimationFrame(animate);
}

// Stops animation when clicks on canvas
function installStopOnCanvasClick() {
    UI.canvas().addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        if (!playing) return;

        stop();
    });
}

function setDimReadout(result) {
    const valueEl = UI.dimValue();
    const metaEl = UI.dimMeta();

    if (!result || !Number.isFinite(result.dimension)) {
        valueEl.textContent = "-";
        metaEl.textContent = "Could not estimate.";

        return;
    }

    const r2 = result.fit?.r2;

    // Updates dimension readout
    valueEl.textContent = result.dimension.toFixed(4);
    metaEl.textContent 
        = `${result.estimator}${Number.isFinite(r2) ? `, R2=${r2.toFixed(3)}` : ""}`;
}

// Function runs box-counting dimension estimation on current canvas image
async function runDimensionEstimate() {
    UI.dimValue().textContent = "...";
    UI.dimMeta().textContent = "Estimating...";

    // Reads estimator options from UI
    const ds = Math.max(128, parseNumber(UI.dimDownsample().value, 768) | 0);
    const minBox = Math.max(1, parseNumber(UI.dimMinBox().value, 2) | 0);
    const maxBox = Math.max(minBox + 1, parseNumber(UI.dimMaxBox().value, 256) | 0);
    const samples = Math.max(6, parseNumber(UI.dimSamples().value, 12) | 0);

    // Converts visible canvas -> smaller bitmap
    const { octx, size } = downsampleToCanvas(UI.canvas(), ds);
    const img = octx.getImageData(0, 0, size, size);

    // Ink mask marks occupied pixels
    const ink = makeInkMaskFromImageData(img, size, size, { alphaMin: 16 });
    // Chooses all ink pixels OR just boundary of ink pixels
    const bitmap = (UI.dimMode().value === "boundary") ? makeBoundaryFromMask(ink, size, size) : ink;

    try {
        const result = DimensionLab.run({
            estimator: "boxCountBitmap",
            input: {
                kind: "bitmap",
                data: { mask: bitmap, width: size, height: size },
                meta: { page: "planeIts" }
            },
            options: { minBox, maxBox, samples },
        });
        setDimReadout(result);
    } catch (err) {
        console.error(err);
        UI.dimValue().textContent = "-";
        UI.dimMeta().textContent = `Dimension error: ${err.message}`;
    }
}

const EXAMPLES = [
    {
        name: "Henon (classic-ish)",
        f: "y + 1 - 1.4*x*x",
        g: "0.3*x",
        view: { xMin: -1.6, xMax: 1.6, yMin: -0.4, yMax: 0.4 },
        seed: { x: 0, y: 0 },
        mode: "single",
    },
    {
        name: "Henon variant (y^2)",
        f: "y + 1 - 1.4*x*x",
        g: "0.3*x + 2*y*y - 0.15",
        view: { xMin: -2, xMax: 2, yMin: -1, yMax: 1 },
        seed: { x: 0, y: 0 },
        mode: "single",
    },
    {
        name: "Sine swap",
        f: "sin(2*y)",
        g: "sin(2*x)",
        view: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
        seed: { x: 0.1, y: 0.1 },
        mode: "single",
    },
    {
        name: "Spiral linear",
        f: "x + 0.08*y",
        g: "y - 0.08*x",
        view: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
        seed: { x: 1, y: 0 },
        mode: "single",
    },
];

function renderExamples() {
    const root = UI.examplesList();
    root.innerHTML = "";

    // Builds example cards in page
    // Each card fills input boxes with an example map and resets picture/canvas
    EXAMPLES.forEach((ex, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "example-item";

        const title = document.createElement("div");
        title.style.fontWeight = "750";
        title.textContent = ex.name;

        const mono = document.createElement("div");
        mono.className = "mono";
        mono.innerHTML = `f(x,y) = ${ex.f}<br/>g(x,y) = ${ex.g}`;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Try this";
        btn.addEventListener("click", () => {
            stop();

            UI.mode().value = ex.mode;
            UI.fx().value = ex.f;
            UI.gy().value = ex.g;

            UI.seedX().value = String(ex.seed?.x ?? 0);
            UI.seedY().value = String(ex.seed?.y ?? 0);

            view2d.initial = { ...ex.view };
            view2d.setView(ex.view, { trigger: true });

            resetAll({ clearPicture: true });
        });

        wrap.appendChild(title);
        wrap.appendChild(mono);
        wrap.appendChild(btn);
        root.appendChild(wrap);
    });
}

function zoomAtCenter(factor) {
    const cx = view2d.getWidthPx() / 2;
    const cy = view2d.getHeightPx() / 2;
    const w = view2d.canvasPxToWorld(cx, cy);
    
    // Zooms at centre of current canvas view
    view2d.zoomAtWorldPoint(w.x, w.y, factor, { trigger: true });
}

// Connects all buttons and controls page behaviour in one function
function bindUI() {
    // Switching between modes resets correct orbit/grid states
    UI.mode().addEventListener("change", () => resetAll({ clearPicture: true }));

    // Applies typed coordinate window
    UI.resetWindowBtn().addEventListener("click", () => {
        stop();
        syncViewFromInputs();

        // Treats new typed window as new reset/default window
        view2d.initial = { ...view2d.view };

        resetAll({ clearPicture: true });
    });

    UI.clearBtn().addEventListener("click", () => {
        stop();

        view2d.resizeToDisplay({ trigger: false });
        clear(ctx, view2d.getWidthPx(), view2d.getHeightPx());
        drawAxes(ctx, view2d);

        if (UI.mode().value === "grid") {
            resetGrid({ clearPicture: false });
        } else {
            resetSingleOrbit({ clearPicture: false });
        }

        UI.readout().textContent = "Cleared.";
    });

    // Play/pause animation
    UI.playBtn().addEventListener("click", () => {
        if (!f || !g) {
            try { 
                compileFromInputs(); 
            }
            catch (e) { 
                console.error(e); 
                UI.readout().textContent = e.message;

                return; 
            }
        }

        // Toggles between states
        playing = !playing;

        if (playing) {
            UI.readout().textContent = "Drawing... (click canvas to stop)";
            if (!rafId) {
                rafId = requestAnimationFrame(animate);
            }
        } else {
            stop();
        }
    });

    // Manual single step button
    UI.stepBtn().addEventListener("click", () => {
        stop();

        try { 
            compileFromInputs(); 
        }
        catch (e) { 
            console.error(e); 
            UI.readout().textContent = e.message; 
            
            return; 
        }

        stepOnce();
    });

    UI.zoomBtn().addEventListener("click", () => zoomAtCenter(1.35));
    UI.unzoomBtn().addEventListener("click", () => zoomAtCenter(1 / 1.35));

    UI.exportBtn().addEventListener("click", () => {
        exportCanvasPNG(UI.canvas(), "plane-iterations.png")
    });

    // Redraws when switching between dots-only/line mode
    UI.linesMode().addEventListener("change", () => fullRedraw());

    UI.dimRunBtn().addEventListener("click", () => runDimensionEstimate());
}

// Initialising canvas
function init() {
    const canvas = UI.canvas();
    ctx = canvas.getContext("2d");

    // Shared View2D controller for planeIts.js
    view2d = new View2D({
        canvas,
        zoomIndicatorEl: qs("#zoom-indicator"),
        mouseCoordsEl: qs("#mouse-coords"),
        initial: { xMin: -1.6, xMax: 1.6, yMin: -0.4, yMax: 0.4 },
        enableDragPan: true,
        enableWheelZoom: true,
        enableClickZoom: false,
        enableRightClickZoom: true,
        
        onChange: () => {
            // Redraws when zooming/panning changes the view
            fullRedraw();
        }
    });

    installDoubleClickZoom(view2d);
    installStopOnCanvasClick();

    view2d.resizeToDisplay({ trigger: false });
    clear(ctx, view2d.getWidthPx(), view2d.getHeightPx());
    drawAxes(ctx, view2d);

    syncInputsFromView();
    mode = UI.mode().value;

    renderExamples();
    bindUI();

    // Redraws theme changes
    const mo = new MutationObserver(() => fullRedraw());
    // Ensures colours are correct when switching between light/dark mode
    mo.observe(document.documentElement, { 
        attributes: true, 
        attributeFilter: ["class"] 
    });

    resetAll({ clearPicture: true });
    UI.readout().textContent = "Ready. Press Play.";
}

init();