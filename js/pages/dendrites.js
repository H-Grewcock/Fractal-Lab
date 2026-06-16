// js/pages/dendrites.js:
import { qs, clamp, parseNumber } from "../shared/dom.js";
import { View2D } from "../shared/view2D.js";
import { exportCanvasPNG } from "../shared/exportMedia.js";
import { DimensionLab } from "../shared/dimension/index.js";
import { typesetMath } from "../shared/mathjax.js";

const canvas = document.getElementById("dendriteCanvas");
const ctx = canvas.getContext("2d", { alpha: true });

// Status readout for stuck particles and active walkers
const statusReadout = document.getElementById("statusReadout");

const els = {
    // Simulation controls
    simRes: document.getElementById("simRes"),
    walkerCount: document.getElementById("walkerCount"),
    stepsPerFrame: document.getElementById("stepsPerFrame"),
    stickProb: document.getElementById("stickProb"),
    spawnRadius: document.getElementById("spawnRadius"),
    killRadius: document.getElementById("killRadius"),
    colorScheme: document.getElementById("colorScheme"),
    colorChangeRate: document.getElementById("colorChangeRate"),
    colorMeaning: document.getElementById("colorMeaning"),
    seedMode: document.getElementById("seedMode"),

    // Display controls
    showWalkers: document.getElementById("showWalkers"),
    showArrows: document.getElementById("showArrows"),
    showGrid: document.getElementById("showGrid"),
    walkerAlpha: document.getElementById("walkerAlpha"),
    walkerStep: document.getElementById("walkerStep"),

    // Main buttons
    togglePlay: document.getElementById("togglePlay"),
    stepOnce: document.getElementById("stepOnce"),
    resetSim: document.getElementById("resetSim"),
    exportPNG: document.getElementById("exportPNG"),

    // Dimension controls
    dimMode: document.getElementById("dimMode"),
    dimDownsample: document.getElementById("dimDownsample"),
    dimMinBox: document.getElementById("dimMinBox"),
    dimMaxBox: document.getElementById("dimMaxBox"),
    dimSamples: document.getElementById("dimSamples"),
    dimRunBtn: document.getElementById("dimRunBtn"),
    dimValue: document.getElementById("dimValue"),
    dimMeta: document.getElementById("dimMeta"),
};

// Fixed world coordinate canvas for simulation
const WORLD = { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
let view2d;

// Animation state
let rafId = null;
let playing = false;

// Current hue used when colouring newly stuck particles
let hue = 0;
// Simulation state
let sim = null;

// Functions which read integers and decnimal numbers from input with fallback of invalid
function getInt(input, fallback) {
    const v = parseInt(input.value, 10);
    return Number.isFinite(v) ? v : fallback;
}
function getFloat(input, fallback) {
    const v = parseFloat(input.value);
    return Number.isFinite(v) ? v : fallback;
}

// Clamps number in interval [0, 1]
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
// Clamps integer in interval [a,b]
function clampInt(x, a, b) { return Math.max(a, Math.min(b, x | 0)); }

// Function sets one pixel in an ImageData array
function setPixelRGBA(data, x, y, w, r, g, b, a) {
    // data = raw RGBA array; x, y = pixel coordinates; w = image width
    const i = 4 * (y * w + x);

    data[i + 0] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
}

// Function converts HSL colour to RGB
// h,s,l in range [0,1]
function hslToRgb(h, s, l) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };

    let r, g, b;
    // Saturation zero --> grey colour
    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 
            ? l * (1 + s) 
            : l + s - l * s;
        const p = 2 * l - q;

        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    // Returns RGB values in range [0, 255]
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function applyWorldTransform(ctx2, view) {
    const w = view.xMax - view.xMin;
    const h = view.yMax - view.yMin;

    const sx = canvas.width / w;
    const sy = canvas.height / h;

    // Applies current world-to-canvas transform
    // y points upwards mathematically
    ctx2.setTransform(sx, 0, 0, -sy, -view.xMin * sx, view.yMax * sy);
}

// Draws grid in world coordinates
function drawWorldGrid(ctx2, view) {
    const w = view.xMax - view.xMin;
    const targetLines = 12;
    const rawStep = w / targetLines;
    // Picks nice grid spacing
    const step = niceStep(rawStep);

    ctx2.save();
    applyWorldTransform(ctx2, view);

    ctx2.lineWidth = 0.0015;
    ctx2.strokeStyle = "rgba(120, 130, 150, 0.28)";

    // Outer grid lines still visible in the current view
    const xStart = Math.floor(view.xMin / step) * step;
    const xEnd = Math.ceil(view.xMax / step) * step;
    const yStart = Math.floor(view.yMin / step) * step;
    const yEnd = Math.ceil(view.yMax / step) * step;

    // Vertical grid lines
    for (let x = xStart; x <= xEnd + 1e-12; x += step) {
        ctx2.beginPath();
        ctx2.moveTo(x, yStart);
        ctx2.lineTo(x, yEnd);
        ctx2.stroke();
    }
    // Horizontal grid lines
    for (let y = yStart; y <= yEnd + 1e-12; y += step) {
        ctx2.beginPath();
        ctx2.moveTo(xStart, y);
        ctx2.lineTo(xEnd, y);
        ctx2.stroke();
    }

    // Draw x- and y-axis darker
    ctx2.lineWidth = 0.0022;
    ctx2.strokeStyle = "rgba(80, 90, 110, 0.45)";

    ctx2.beginPath();
    ctx2.moveTo(view.xMin, 0);
    ctx2.lineTo(view.xMax, 0);
    ctx2.stroke();

    ctx2.beginPath();
    ctx2.moveTo(0, view.yMin);
    ctx2.lineTo(0, view.yMax);
    ctx2.stroke();

    ctx2.restore();
}

// Function chooses clean grid step near x
function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const a = x / p;
    
    // Ensures its a 'nice' step, e.g. 0.02 and not 0.037
    if (a < 1.5) return 1 * p;
    if (a < 3.5) return 2 * p;
    if (a < 7.5) return 5 * p;

    return 10 * p;
}

// Dimensions:
// Function downsamples canvases to smaller temporary canvas
// Used for image-based dimension estimates
function downsampleToCanvas(srcCanvas, size) {
    const s = Math.max(128, size | 0);

    const off = document.createElement("canvas");
    off.width = s;
    off.height = s;

    // Converts visible canvas -> smaller bitmap
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
                // Pixel is boundary if it is occupied & at least one of its direct neighbours is empty
                out[i] = 1;
            }
        }
    }
    
    return out;
}

function setDimReadout(result) {
    if (!result || !Number.isFinite(result.dimension)) {
        els.dimValue.textContent = "-";
        els.dimMeta.textContent = "Could not estimate (try changing box range / samples).";
        
        return;
    }

    const r2 = result.fit?.r2;
    // Updates dimension readout after DimensionLab finishes
    els.dimValue.textContent = result.dimension.toFixed(4);
    els.dimMeta.textContent
        = `${result.estimator}${Number.isFinite(r2) ? `, \\(R^2=${r2.toFixed(3)}\\)` : ""}`;
    typesetMath(els.dimMeta);
}

function mixRgb(a, b, t) {
    // Clamps t so the blend stays between 0 and 1
    const u = clamp01(t);

    // Linearly interpolates each RGB channel
    return {
        r: Math.round(a.r + (b.r - a.r) * u),
        g: Math.round(a.g + (b.g - a.g) * u),
        b: Math.round(a.b + (b.b - a.b) * u),
    };
}

function hexToRgb(hex, fallback = { r: 17, g: 24, b: 39 }) {
    // Removes whitespace and any leading # from colour string
    const clean = String(hex || "").trim().replace("#", "");
    // Uses fallback if value not valid 6-digit hex colour
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
        return fallback;
    }

    // Converts each pair of hex pair to RGB channel
    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16),
    };
}

function getParticleColour(ix, iy) {
    const scheme = els.colorScheme.value;               // Choosing colouring behaviour from UI
    const rate = getFloat(els.colorChangeRate, 0.35);   // How quiclky hue changes

    if (scheme === "single") {
        // Main ink colour for all particles, depending on light/dark mode
        return hexToRgb(getThemeColours().ink, { r: 17, g: 24, b: 39 });
    }

    if (scheme === "radius") {
        // Converting grid coordinates -> world coordinates
        const p = sim._gridToWorld(ix, iy);
        // Measuring disance from central seed
        const d = Math.hypot(p.x, p.y);
        // Scales distance relative to spawn radius
        const t = clamp01(d / Math.max(0.05, getFloat(els.spawnRadius, 0.9)));

        // Blends blue near centre to amber farther out
        return mixRgb(
            { r: 37, g: 99, b: 235 }, 
            { r: 245, g: 158, b: 11 }, 
            t
        );
    }

    if (scheme === "angle") {
        // Converting grid coordinates -> world coordinates
        const p = sim._gridToWorld(ix, iy);
        // Converts particle angle around origin to hue value
        const h = ((Math.atan2(p.y, p.x) / (Math.PI * 2)) + 1) % 1;

        return hslToRgb(h, 0.72, 0.50);
    }

    if (scheme === "density") {
        // Counting h9w many neighbouring cells already occupied
        const neighbours = sim.countOccupiedNeighbours(ix, iy);
        const t = neighbours / 8;   // Converts neighbour count to 0 to 1 blend amount

        // Returns purple for sparse areas to green for crowded areas
        return mixRgb(
            { r: 124, g: 58, b: 237 }, 
            { r: 34, g: 197, b: 94 }, 
            t
        );
    }

    // Defaulting age mode: shifts hue slightly each time particle sticks
    hue = (hue + rate) % 360;

    return hslToRgb((hue % 360) / 360, 0.72, 0.50);
}

function updateColourMeaning() {
    // Explanation how each colour scheme works
    const meanings = {
        age: "Colour shows when each particle stuck: older near the seed, newer near the tips.",
        radius: "Colour shows distance from the seed: blue near the centre, amber farther out.",
        angle: "Colour shows branch direction around the seed, making directional symmetry visible.",
        density: "Colour shows local crowding: purple at sparse tips, green in denser regions.",
        single: "Colour uses the page ink colour so the dendrite reads as one solid structure.",
    };

    els.colorMeaning.textContent = meanings[els.colorScheme.value] || meanings.age;
    // Colour-change-rate only matters for age colouring
    els.colorChangeRate.disabled = els.colorScheme.value !== "age";
}

// Function runs box-counting dimension estiamtion on current dendrite drawing
function runDimensionEstimate() {
    els.dimValue.textContent = "...";
    els.dimMeta.textContent = "Estimating...";

    // Reads estimator options from UI
    const ds = Math.max(128, parseNumber(els.dimDownsample.value, 768) | 0);
    const minBox = Math.max(1, parseNumber(els.dimMinBox.value, 2) | 0);
    const maxBox = Math.max(minBox + 1, parseNumber(els.dimMaxBox.value, 256) | 0);
    const samples = Math.max(6, parseNumber(els.dimSamples.value, 12) | 0);

    // Converts visible canvas -> smaller bitmap
    const { octx, size } = downsampleToCanvas(canvas, ds);
    const img = octx.getImageData(0, 0, size, size);
    
    // Ink mask marks occupied pixels
    const ink = makeInkMaskFromImageData(img, size, size, { alphaMin: 16 });
    // Chooses whole dendrite OR just boundary
    const bitmap = (els.dimMode.value === "boundary") ? makeBoundaryFromMask(ink, size, size) : ink;

    try {
        const result = DimensionLab.run({
            estimator: "boxCountBitmap",
            input: {
                kind: "bitmap",
                data: { mask: bitmap, width: size, height: size },
                meta: { page: "dendrites", mode: els.dimMode.value },
            },
            options: { minBox, maxBox, samples },
        });
        
        setDimReadout(result);
    } catch (err) {
        console.error(err);

        els.dimValue.textContent = "-";
        els.dimMeta.textContent = `Dimension error: ${err.message}`;
    }
}

// Builds fresh simulation using the current UI settings
function buildSim() {
    const res = clampInt(getInt(els.simRes, 700), 200, 1800);
    els.simRes.value = String(res);     // Writes clamped value back in input

    sim = new DLASim({
        res,
        world: WORLD,
        seedMode: els.seedMode.value,
    });

    sim.setWalkerCount(getInt(els.walkerCount, 400));
    hue = 0;    // resets colour cycle

    updateStatus();
}

// Ensures the simultion exists before stepping or drawing
function ensureSim() {
    if (!sim) buildSim();
}

function updateStatus() {
    // Updates status text with current simulation counts
    statusReadout.textContent = `Stuck: ${sim.stuckCount} | Walkers: ${sim.walkers.length}`;
}

function stepSimulation(stepsPerFrame) {
    const stickProb = getFloat(els.stickProb, 1);
    const spawnR = getFloat(els.spawnRadius, 0.9);
    const killR = getFloat(els.killRadius, 1.15);
    const walkerStepCells = clampInt(getInt(els.walkerStep, 1), 1, 8);

    // Copies UI settings to simulation parameters
    sim.params.stickProb = clamp01(stickProb);
    sim.params.spawnRadius = Math.max(0.05, spawnR);
    sim.params.killRadius = Math.max(sim.params.spawnRadius + 0.05, killR);
    sim.params.walkerStepCells = walkerStepCells;

    // Advances simulation by given number of micro-steps
    for (let s = 0; s < stepsPerFrame; s++) {
        const stuckThisStep = sim.step((ix, iy) => getParticleColour(ix, iy));

        // Only updates status when something is stuck
        if (stuckThisStep) updateStatus();
    }
}

function drawFrame() {
    ensureSim();
    // Resets transform before clearing screen
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draws grid underneath cluster
    if (els.showGrid.checked) drawWorldGrid(ctx, view2d.view);

    ctx.save();
    applyWorldTransform(ctx, view2d.view);

    // Draws current simulation frame; mapped from hidden pixel canvas
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        sim.canvas, 
        WORLD.xMin, 
        WORLD.yMin, 
        WORLD.xMax - WORLD.xMin, 
        WORLD.yMax - WORLD.yMin
    );

    ctx.restore();
    // Draws live walkers over cluster if enabled
    if (els.showWalkers.checked) {
        drawWalkersOverlay();
    }
}

// Just overlay; stuck dendrite cluster stored separately in sim.canvas
function drawWalkersOverlay() {
    const alpha = clamp01(getFloat(els.walkerAlpha, 0.75));
    const showArrows = els.showArrows.checked;
    const { ink, muted } = getThemeColours();

    ctx.save();
    applyWorldTransform(ctx, view2d.view);

    ctx.globalAlpha = alpha;

    ctx.fillStyle = ink;
    ctx.strokeStyle = muted;
    ctx.lineWidth = 0.0025;

    const r = 0.006;

    for (const w of sim.walkers) {
        // Draws current moving walker as small dot
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Optional arrow/trail showing the previous step
        if (showArrows) {
            ctx.beginPath();
            ctx.moveTo(w.prevX, w.prevY);
            ctx.lineTo(w.x, w.y);
            ctx.stroke();
        }
    }

    ctx.restore();
    // Resets alpha s.t. doesn't affect later drawing
    ctx.globalAlpha = 1;
}

function getThemeColours() {
    const root = getComputedStyle(document.documentElement);
    
    // Useful colours from CSS file
    const ink = (root.getPropertyValue("--ink").trim() || "#111");
    const text = (root.getPropertyValue("--text").trim() || "#111");
    const muted = (root.getPropertyValue("--muted").trim() || "#777");
    const line = (root.getPropertyValue("--line").trim() || "#ccc");

    return { ink, text, muted, line };
}

// Starts simulation animation
function play() {
    ensureSim();

    playing = true;
    els.togglePlay.textContent = "Pause";

    loop();
}

// Play/pause toggle function
function togglePlay() {
    if (!playing) play();
    else stop();
}

// Stops simulation animation
function stop() {
    playing = false;
    els.togglePlay.textContent = "Play";
    
    if (rafId) {
        cancelAnimationFrame(rafId);
    }

    rafId = null;
}

function loop() {
    if (!playing) return;

    view2d.resizeToDisplay({ trigger: false });             // Resizes canvas if needed
    const stepsPerFrame = getInt(els.stepsPerFrame, 250);
    stepSimulation(stepsPerFrame);                          // Steps simulation
    drawFrame();                                            // Redraws frame

    rafId = requestAnimationFrame(loop);                    // Requests next frame
}

class DLASim {
    constructor({ res, world, seedMode = "center" }) {
        this.res = res;
        this.world = { ...world };

        this.canvas = document.createElement("canvas");
        this.canvas.width = res;
        this.canvas.height = res;
        this.sctx = this.canvas.getContext("2d", { willReadFrequently: false });

        this.image = this.sctx.createImageData(res, res);
        this.occ = new Uint8Array(res * res);   // 1 = stuck particle exists in cell

        this.walkers = [];              // moving random walkers
        this.stuckCount = 0;            // stores number of stuck cells in the cluster
        this.maxClusterRadius = 0;      // used to spawn walkers just outside the current cluster
        
        this.params = {
            stickProb: 1,
            spawnRadius: 0.9,
            killRadius: 1.15,
            walkerStepCells: 1,
        };

        this._seed(seedMode);           // adds initial seed cluster
        this._flushImage();             // draws seed pixels to hidden simulation canvas
    }

    setWalkerCount(n) {
        // Allows us to adjust number of active walkers
        const target = clampInt(n, 1, 5000);
        // Too many active walkers: trim array
        if (this.walkers.length > target) {
            this.walkers.length = target;

            return;
        }

        // Too few active walkers: spawn more
        while (this.walkers.length < target) {
            this.walkers.push(this._spawnWalker());
        }
    }

    // Initial stuck seed
    _seed(mode) {
        this.occ.fill(0);
        this.image.data.fill(0);
        this.stuckCount = 0;

        const paintCell = (ix, iy, rgb) => {
            if (!this._inBounds(ix, iy)) return;

            const idx = iy * this.res + ix;
            // Ensures we do not double-count an already occupied cell
            if (this.occ[idx]) return;

            this.occ[idx] = 1;
            this.stuckCount++;

            this._trackClusterRadius(ix, iy);

            setPixelRGBA(this.image.data, ix, iy, this.res, rgb.r, rgb.g, rgb.b, 255);
        };

        const mid = Math.floor(this.res / 2);
        const base = { r: 80, g: 80, b: 80 };

        // Modes:
        // - centre: one point in the middle
        // - line: short horizontal seed
        // - cross: short cross seed
        if (mode === "line") {
            const half = Math.floor(this.res * 0.05);
            for (let d = -half; d <= half; d++) {
                paintCell(mid + d, mid, base);
            }

            return;
        }

        if (mode === "cross") {
            const half = Math.floor(this.res * 0.05);
            for (let d = -half; d <= half; d++) {
                paintCell(mid + d, mid, base);
                paintCell(mid, mid + d, base);
            }

            return;
        }

        // Default seed is single central cell
        paintCell(mid, mid, base);
    }

    // Copies current ImageData to hidden simulation canvas
    _flushImage() { this.sctx.putImageData(this.image, 0, 0); }

    // Function advances walker by one step
    step(nextColourFn) {
        let anyStuck = false;

        const stepCells = clampInt(this.params.walkerStepCells, 1, 8);
        const cellStep = stepCells;

        for (let i = 0; i < this.walkers.length; i++) {
            const w = this.walkers[i];
            // Stores previous world position for optional arrow drawing
            w.prevX = w.x; w.prevY = w.y;

            // Randomly choose one of eight possible random-walk directions
            const dir = (Math.random() * 8) | 0;

            const dx = [1, -1, 0, 0, 1, 1, -1, -1][dir] * cellStep;
            const dy = [0, 0, 1, -1, 1, -1, 1 ,-1][dir] * cellStep;

            w.ix += dx;
            w.iy += dy;

            // If walker leaves bounds, i.e. leaves the simulation grid, respawns
            if (!this._inBounds(w.ix, w.iy)) {
                this.walkers[i] = this._spawnWalker();
                continue;
            }

            // Updates world coordinates after moving in grid coordinates
            const world = this._gridToWorld(w.ix, w.iy);
            w.x = world.x;
            w.y = world.y;

            // Kill radius prevents walkers wandering forever far away
            if ((w.x * w.x + w.y * w.y) > (this.params.killRadius * this.params.killRadius)) {
                // If walker moves too far from orogin, respawns near cluster
                this.walkers[i] = this._spawnWalker();
                
                continue;
            }

            if (this._touchesCluster(w.ix, w.iy)) {
                // If walker touches cluster, it has a chance to stuck
                // Lower stuck probability makes the growth softer/more irregular
                if (Math.random() <= this.params.stickProb) {
                    const rgb = typeof nextColourFn === "function" 
                        ? nextColourFn(w.ix, w.iy) 
                        : { r: 17, g: 24, b: 39 };

                    this._occupy(w.ix, w.iy, rgb);
                    anyStuck = true;

                    // Replaces stuck walker with new moving walker
                    this.walkers[i] = this._spawnWalker();
                }
            }
        }

        if (anyStuck) {
            // Updates hidden canvas only if cluster changed
            this._flushImage();
        }
        return anyStuck;
    }

    _occupy(ix, iy, rgb) {
        const idx = iy * this.res + ix;

        if (this.occ[idx]) return;
        // Marks one cell as part of the stuck cluster
        this.occ[idx] = 1;
        this.stuckCount++;
        this._trackClusterRadius(ix, iy);

        setPixelRGBA(this.image.data, ix, iy, this.res, rgb.r, rgb.g, rgb.b, 255);
    }

    // Used when choosing where to spawn new walkers
    _trackClusterRadius(ix, iy) {
        const p = this._gridToWorld(ix, iy);
        // Updates largest cluster radius seen so far
        this.maxClusterRadius = Math.max(this.maxClusterRadius, Math.hypot(p.x, p.y));
    }

    _touchesCluster(ix, iy) {
        // Iterating through the 8 neighbouring cells around the walker
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                if (ox === 0 && oy === 0) continue;

                const x = ix + ox;
                const y = iy + oy;

                // Checks if grid cell touches stuck cluster
                if (!this._inBounds(x,y)) continue;
                if (this.occ[y * this.res + x]) {
                    return true;
                }
            }
        }

        return false;
    }

    countOccupiedNeighbours(ix, iy) {
        let count = 0;

        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                if (ox === 0 && oy === 0) continue;

                const x = ix + ox;
                const y = iy + oy;

                if (this._inBounds(x, y) && this.occ[y * this.res + x]) count++;
            }
        }

        return count;
    }

    // Spawns new walker near the current cluster
    _spawnWalker() {
        // Walker starts on a circle around the origin
        const a = Math.random() * Math.PI * 2;
        // As cluster grows, spawn radius moves outwards as well
        const r = Math.min(
            this.params.spawnRadius,
            Math.max(0.12, this.maxClusterRadius + 0.12)
        );

        const x = r * Math.cos(a);
        const y = r * Math.sin(a);

        const { ix, iy } = this._worldToGrid(x, y);
        const w = { ix, iy, x, y, prevX: x, prevY: y };

        for (let tries = 0; tries < 16; tries++) {
            // If first chosen cell invalid/already occupied, nudges randomly a few times to keep functionality
            if (this._inBounds(w.ix, w.iy) && !this.occ[w.iy * this.res + w.ix]) return w;

            w.ix = clampInt(w.ix + (((Math.random() * 7) | 0) - 3), 0, this.res - 1);
            w.iy = clampInt(w.iy + (((Math.random() * 7) | 0) - 3), 0, this.res - 1);
            
            const ww = this._gridToWorld(w.ix, w.iy);
            
            w.x = ww.x;
            w.y = ww.y;
            w.prevX = w.x;
            w.prevY = w.y;
        }

        return w;
    }

    // Condition to show whether grid coordinatesa re inside simulation grid
    _inBounds(ix, iy) {
        return ix >= 0 && iy >= 0 && ix < this.res && iy < this.res;
    }

    // Converts world coordinates -> grid coordinates
    _worldToGrid(x, y) {
        const u = (x - this.world.xMin) / (this.world.xMax - this.world.xMin);
        // y formula inverted because world y points upwards, but grid y increases downwards
        const v = (this.world.yMax - y) / (this.world.yMax - this.world.yMin);

        const ix = clampInt(Math.floor(u * this.res), 0, this.res - 1);
        const iy = clampInt(Math.floor(v * this.res), 0, this.res - 1);

        return { ix, iy };
    }

    // Converts grid coordinates -> world coordinates
    _gridToWorld(ix, iy) {
        // +0.5 places world point at centre of the grid cell
        const u = (ix + 0.5) / this.res;
        const v = (iy + 0.5) / this.res;

        const x = this.world.xMin + u * (this.world.xMax - this.world.xMin);
        const y = this.world.yMax - v * (this.world.yMax - this.world.yMin);
        
        // Returns world coordinates
        return { x, y };
    }
}

function init() {
    view2d = new View2D({
        canvas,
        zoomIndicatorEl: document.getElementById("zoom-indicator"),
        mouseCoordsEl: document.getElementById("mouse-coords"),
        initial: { xMin: -1.2, xMax: 1.2, yMin: -1.2, yMax: 1.2 },
        enableClickZoom: false,
        enableWheelZoom: true,
        enableDragPan: true,
        enableRightClickZoom: true,

        // Redraws when view changes
        onChange: () => drawFrame(),
    });
    
    window.addEventListener("resize", () => {
        // Redraws canvas when browser window changes size
        view2d.resizeToDisplay({ trigger: false });
        drawFrame();
    });

    els.togglePlay.addEventListener("click", togglePlay);

    // Runs one frame worth of simulation steps on request
    els.stepOnce.addEventListener("click", () => {
        ensureSim();
        stepSimulation(getInt(els.stepsPerFrame, 250));
        drawFrame();
    });

    els.resetSim.addEventListener("click", () => {
        stop();
        buildSim();
        drawFrame();
    });

    els.exportPNG.addEventListener("click", () => {
        exportCanvasPNG(canvas, "dendrites.png");
    });
    
    // Changes to resolution or seed mode requires an entire simulation rebuild, not just drawFrame()
    ["simRes", "seedMode", "colorScheme"].forEach((id) => {
        els[id].addEventListener("change", () => {
        stop();
        updateColourMeaning();
        buildSim();
        drawFrame();
        });
    });
    
    els.walkerCount.addEventListener("change", () => {
        ensureSim();
        // Changing walker count adjusts the active walkers, not stuck cluster.
        sim.setWalkerCount(getInt(els.walkerCount, 400));

        updateStatus();
        drawFrame();
    });
    
    // Display-only controls
    // Only requires a redraw rather than an entire simulation rebuild
    ["showWalkers", "showArrows", "showGrid", "walkerAlpha"].forEach((id) => {
        els[id].addEventListener("change", () => drawFrame());
        els[id].addEventListener("input", () => drawFrame());
    });
    
    els.dimRunBtn.addEventListener("click", () => runDimensionEstimate());
    
    // Builds first simulation
    updateColourMeaning();
    buildSim();
    view2d.resizeToDisplay({ trigger: false });
    drawFrame();    // Draws said simulation
}

init();
