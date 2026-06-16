// js/pages/curves.js:
import { qs, qsa, clamp, parseNumber } from "../shared/dom.js";
import { View2D } from "../shared/view2D.js";
import { exportCanvasPNG } from "../shared/exportMedia.js";
import { DimensionLab } from "../shared/dimension/index.js";
import { typesetMath } from "../shared/mathjax.js";

// Parses integer safely
const intOr = (v, fallback) => {
    // Converts value to a string first
    const n = parseInt(String(v), 10);      // parses as base-10

    // Uses parsed integer if valid
    // Falls back if value invalid
    return Number.isFinite(n) ? n : fallback;
};

// Clamps integer in interval [a, b]
const clampInt = (v, a, b) => Math.round(clamp(v, a, b));
// Parses number and clamps in interval [a, b]
const clampNum = (v, a, b) => clamp(parseNumber(v, a), a, b);


const normaliseHex6 = (s) => {
    // Normalises colour strings to six-character hex value without "#"
    const raw = String(s || "").trim().replace(/^#/, "");
    const cleaned = raw.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);

    // Pads incomplete hex colours s.t. valid
    return cleaned.padEnd(6, "0").toLowerCase();
};

// Converts six-character hex value to CSS colour
const cssColourFromHex6 = (hex6) => `#${normaliseHex6(hex6)}`;

// Reads current theme ink colour
const currentInk = () => 
    getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#111111";

// Reads current theme ink colour as hex-style string
const currentInkHex6 = () => normaliseHex6(currentInk());

// Waits until next animation frame
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
// Async delay; used for generation-by-generation build animation
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Converts world coordinates -> canvas pixel coordinates
function worldToCanvasPxLocal(view2d, worldX, worldY) {
    const v = view2d.view;
    const W = view2d.getWidthPx();
    const H = view2d.getHeightPx();

    const wW = v.xMax - v.xMin;
    const wH = v.yMax - v.yMin;

    const x = ((worldX - v.xMin) / wW) * W;
    // Flips y s.t. y-up coordinates drawn correctly on canvas
    const y = ((v.yMax - worldY) / wH) * H;

    return { x, y };
}

const UI = {
    tabs: () => qsa(".tab"),
    panes: () => qsa(".tabpane"),

    curveCanvas: () => qs("#curveCanvas"),
    spaceCanvas: () => qs("#spaceCanvas"),

    genBox: () => qs("#fractalGenControls"),
    genFractal: () => qs("#genFractal"),
    genStep: () => qs("#genStep"),
    genColor: () => qs("#genColor"),
    genColorPreview: () => qs("#genColorPreview"),
    genDrawBtn: () => qs("#genDrawBtn"),
    copyLinkBtn: () => qs("#copyLinkBtn"),

    presetSelect: () => qs("#presetSelect"),
    iterInput: () => qs("#iterInput"),
    lineWidthInput: () => qs("#lineWidthInput"),
    paddingInput: () => qs("#paddingInput"),
    animateSpeed: () => qs("#animateSpeed"),

    constructionMode: () => qs("#constructionMode"),
    generationScrub: () => qs("#generationScrub"),
    generationValue: () => qs("#generationValue"),
    showPreviousGen: () => qs("#showPreviousGen"),
    buildDelay: () => qs("#buildDelay"),
    buildAutoFit: () => qs("#buildAutoFit"),

    drawBtn: () => qs("#drawBtn"),
    resetBtn: () => qs("#resetBtn"),
    exportBtn: () => qs("#exportBtn"),

    angleInput: () => qs("#angleInput"),
    axiomInput: () => qs("#axiomInput"),
    rulesInput: () => qs("#rulesInput"),
    legendInput: () => qs("#legendInput"),
    applyCustomBtn: () => qs("#applyCustomBtn"),

    readout: () => qs("#curveReadout"),
    segReadout: () => qs("#seg-readout"),
    bboxReadout: () => qs("#bbox-readout"),
    segReadoutSpace: () => qs("#seg-readout-space"),
    bboxReadoutSpace: () => qs("#bbox-readout-space"),
    
    dimTarget: () => qs("#dimTarget"),
    dimMode: () => qs("#dimMode"),
    dimDownsample: () => qs("#dimDownsample"),
    dimMinBox: () => qs("#dimMinBox"),
    dimMaxBox: () => qs("#dimMaxBox"),
    dimSamples: () => qs("#dimSamples"),
    dimAuto: () => qs("#dimAutoAfterDraw"),
    dimRunBtn: () => qs("#dimRunBtn"),
    dimValue: () => qs("#dimValue"),
    dimMeta: () => qs("#dimMeta"),
};

function defaultTurtleMap() {
    // Each symbol mapped to a turtle action
    // Returns default turtle command map
    return { 
        F: "draw",                  // move forward with pen down
        G: "move",                  // move forward with pen up
        "+": "turnLeft",
        "-": "turnRight", 
        "[": "push", "]": "pop"     // for branching systems
    };
}

// Short code generator presets for URL controls
const GEN_CODES = [
    {
        code: "TRIC",
        name: "TRIC - Sierpinski Triangle (turtle)",
        axiom: "F-G-G",
        rules: { F: "F-G+F+G-F", G: "GG" },
        angleDeg: 120,
        turtle: { ...defaultTurtleMap(), F: "draw", G: "draw" },
        stepMax: 12,
    },
    {
        code: "KOCH",
        name: "KOCH - Koch curve",
        axiom: "F",
        rules: { F: "F+F--F+F" },
        angleDeg: 60,
        turtle: { ...defaultTurtleMap(), F: "draw" },
        stepMax: 10,
    },
    {
        code: "DRAG",
        name: "DRAG - Dragon curve",
        axiom: "FX",
        rules: { X: "X+YF+", Y: "-FX-Y" },
        angleDeg: 90,
        turtle: { ...defaultTurtleMap(), F: "draw", X: "noop", Y: "noop" },
        stepMax: 16,
    },
    {
        code: "LEVY",
        name: "LEVY - Levy C curve",
        axiom: "F",
        rules: { F: "+F--F+" },
        angleDeg: 45,
        turtle: { ...defaultTurtleMap(), F: "draw" },
        stepMax: 16,
    },
    {
        code: "PLNT",
        name: "PLNT - Fractal plant",
        axiom: "X",
        rules: { X: "F+[[X]-X]-F[-FX]+X", F: "FF" },
        angleDeg: 25,
        turtle: { ...defaultTurtleMap(), F: "draw", X: "noop" },
        stepMax: 7,
    },
];

// PReset list split between fractal-curves tab and space-filling curves tab
const PRESETS = [
    // Fractal tab
    { 
        id: "koch", 
        name: "Koch (classic)", 
        category: "fractal", 
        axiom: "F", 
        rules: { F: "F+F--F+F" }, 
        angleDeg: 60, 
        turtle: { ...defaultTurtleMap(), F: "draw" } 
    },
    { 
        id: "levy", 
        name: "Levy C curve", 
        category: "fractal", 
        axiom: "F", 
        rules: { F: "+F--F+" }, 
        angleDeg: 45, 
        turtle: { ...defaultTurtleMap(), F: "draw" } 
    },
    { 
        id: "dragon", 
        name: "Heighway dragon", 
        category: "fractal", 
        axiom: "FX", 
        rules: { X: "X+YF+", Y: "-FX-Y" }, 
        angleDeg: 90, 
        turtle: { ...defaultTurtleMap(), F: "draw", X: "noop", Y: "noop" } 
    },
    { 
        id: "arrowhead", 
        name: "Sierpinski arrowhead", 
        category: "fractal", 
        axiom: "A", 
        rules: { A: "B-A-B", B: "A+B+A" }, 
        angleDeg: 60, 
        turtle: { ...defaultTurtleMap(), A: "draw", B: "draw" } 
    },
    { 
        id: "plant", 
        name: "Fractal plant", 
        category: "fractal", 
        axiom: "X", 
        rules: { X: "F+[[X]-X]-F[-FX]+X", F: "FF" }, 
        angleDeg: 25, 
        turtle: { ...defaultTurtleMap(), F: "draw", X: "noop" } 
    },

    // Space tab
    { 
        id: "hilbert", 
        name: "Hilbert curve", 
        category: "space", 
        axiom: "A", 
        rules: { A: "+BF-AFA-FB+", B: "-AF+BFB+FA-" }, 
        angleDeg: 90, 
        turtle: { ...defaultTurtleMap(), F: "draw", A: "noop", B: "noop" } 
    },
    { 
        id: "peano", 
        name: "Peano curve (simple)", 
        category: "space", 
        axiom: "X", 
        rules: { 
            X: "XFYFX+F+YFXFY-F-XFYFX", 
            Y: "YFXFY-F-XFYFX+F+YFXFY" 
        }, 
        angleDeg: 90, 
        turtle: { ...defaultTurtleMap(), F: "draw", X: "noop", Y: "noop" } },
    { 
        id: "moore", 
        name: "Moore curve (variant)", 
        category: "space", 
        axiom: "LFL+F+LFL", 
        rules: { L: "-RF+LFL+FR-", R: "+LF-RFR-FL+" }, 
        angleDeg: 90, 
        turtle: { ...defaultTurtleMap(), F: "draw", L: "noop", R: "noop" } 
    },
];

// Parses rules textarea -> rules object
function parseRulesText(text) {
    const rules = {};   // Stores rules as symbol -> replacement string

    String(text || "")
        .split("\n")
        .map((s) => s.trim())   // Trims/removes extra whitespace into separate lines
        .filter(Boolean)        // Ignores blank lines
        .forEach((line) => {
            // First equals sign separating symbol and replacement
            const eq = line.indexOf("=");
            if (eq === -1) return;                  // Ignores lines without equals sign
            const k = line.slice(0, eq).trim();     // LHS symbol to replace
            const v = line.slice(eq + 1).trim();    // RHS replacement string
            
            // Only adds rules with non-empty symbol
            if (k) {
                rules[k] = v;
            }                   
        });

    return rules;
}

// Parses turtle legend textarea -> symbol-action map
function parseLegend(text) {
    const map = {};
    String(text || "")
        .split("\n")
        .map((s) => s.trim())   // Trims/removes extra whitespace around each line
        .filter(Boolean)        // Ignores blank lines
        .forEach((line) => {
            // First equals sign separating symbol and action
            const eq = line.indexOf("=");
            if (eq === -1) return;                  // Ignores invalid legend lines
            const sym = line.slice(0, eq).trim();   // LHS L-system symbol
            const act = line.slice(eq + 1).trim();  // RHS turtle action

            // Only adds entries with non-empty symbol
            if (sym) {
                map[sym] = act;
            }
        });
    
    return map;
}

// Applies one L-System rewrite step to string
function rewriteOnce(s, rules) {
    let out = "";   // Builds rewritten string one character at a time

    for (const ch of s) {
        // Replaces character if it has a rule
        // Otherwise unchanged
        out += (rules[ch] !== undefined) ? rules[ch] : ch;
    }

    return out;
}

function rewrite(axiom, rules, n) {
    // Starting at axiom as a string
    let s = String(axiom || "");

    for (let i = 0; i < n; i++) {
        // Applies replacement rules once per iteration (n times)
        s = rewriteOnce(s, rules);

        // Safety stop to avoid huge strings freezing browser
        if (s.length > 2_000_000) break;
    }

    return s;
}

// Converts sequence -> turtle path points
function turtleToSegments(sequence, angleDeg, turtleMap) {
    const ang = (parseNumber(angleDeg, 90) * Math.PI) / 180;    // Converts turn angle into radians
    let x = 0, y = 0, dir = 0;      // Current turtle position and direction

    // Stores previous turtle states for branches
    const stack = [];
    // Fixed forward step length for each draw/move command
    const step = 1;

    const pts = [{ x, y }];     // path starts at the origin

    for (const ch of sequence) {
        // Looks up character's turtle position
        // Ignores unknown characters
        const action = turtleMap[ch] || "noop";

        if (action === "draw" || action === "move") {
            // Moves forward one turtle step in current direction
            x += step * Math.cos(dir);
            y += step * Math.sin(dir);

            // Adds new position to path
            pts.push({ x, y });
        } else if (action === "turnLeft") {
            // Rotates anticlockwise
            dir += ang;
        } else if (action === "turnRight") {
            // Rotates clockwise
            dir -= ang;
        } else if (action === "push") {
            // Saves current position and direction for a branch
            stack.push({ x, y, dir });
        } else if (action === "pop") {
            // Restores most recent saved branch state
            const st = stack.pop();
            if (st) {
                pts.push(null);         // breaks path (pen up)

                x = st.x; 
                y = st.y; 
                dir = st.dir;

                // Restarts path from restored position
                pts.push({ x, y });
            }
        }
    }

    return pts;
}

// Calculates bounding box of turtle path
function bboxOfSegments(pts) {
    // Starts with extreme values
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    // Shrinks values to around the points
    for (const p of pts) {
        if (!p) continue;

        // Updates smallest and largest x/y values so far
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    
    // Fallback if no valid ponits
    if (!Number.isFinite(minX)) {
        return { 
            minX: -1, 
            minY: -1, 
            maxX: 1, 
            maxY: 1, 
            w: 2, 
            h: 2 
        };
    }

    return { 
        minX, 
        minY, 
        maxX, 
        maxY,
        w: maxX - minX, 
        h: maxY - minY
    };
}

// Creates View2D window from bounding box
function viewFromBBox(bb, padPct = 12) {
    // Ensures no zero-width/-height views
    const w = Math.max(bb.w, 1e-9);
    const h = Math.max(bb.h, 1e-9);

    // Padding percentages
    const padFrac = clampNum(padPct / 100, 0, 0.95);
    const padX = w * padFrac;
    const padY = h * padFrac;

    // Expands bounding box by the padding amount
    return { 
        xMin: bb.minX - padX, 
        xMax: bb.maxX + padX, 
        yMin: bb.minY - padY, 
        yMax: bb.maxY + padY 
    };
}

// Progressive Rendering:
let fractalView = null;
let spaceView = null;

// Separates caches for fractal tab and space-filling tab
const cache = {
    fractal: { 
        pts: null, 
        prevPts: null, 
        bb: null, 
        stroke: "#111111", 
        lineWidth: 1.5, 
        seqLen: 0, 
        runningToken: 0, 
        segCount: 0 
    },
    space: { 
        pts: null, 
        prevPts: null, 
        bb: null, 
        stroke: "#111111", 
        lineWidth: 1.5, 
        seqLen: 0, 
        runningToken: 0, 
        segCount: 0 
    },
};

let buildToken = 0;     // Initialisd to track newest build request

// Function cancels any generation-by-generation build currently running
function cancelBuild() {
    buildToken++;
}

function getActiveTabId() {
    const btn = UI.tabs().find((b) => b.classList.contains("is-active"));

    // Returns currently active tab id
    return btn ? btn.dataset.tab : "fractal";
}

// Function returns active view, canvas, cache and HUD elements for chosen tab
function currentViewAndCanvas(tab) {
    if (tab === "space") {
        return { 
            view: spaceView, 
            canvas: UI.spaceCanvas(), 
            C: cache.space, 
            segEl: UI.segReadoutSpace(), 
            bboxEl: UI.bboxReadoutSpace() 
        };
    }

    return { 
        view: fractalView, 
        canvas: UI.curveCanvas(),
        C: cache.fractal, 
        segEl: UI.segReadout(), 
        bboxEl: UI.bboxReadout() 
    };
}

// Counts drawable line segments in a point path
function computeSegCount(pts) {
    // Initialising
    let count = 0;
    let prev = null;

    for (const p of pts) {
        if (!p) { 
            // Null values mark braks between separate path sections
            prev = null; 
            continue; 
        }

        if (prev) {
            // Segment exists wheneber there is a valid previous point
            count++;
        }
        prev = p;
    }
    
    return count;
}

// Function stores newly henerated curve in cache for a tab
function setCacheForTab(tab, { pts, prevPts = null, bb, stroke, lineWidth, seqLen }) {
    const C = (tab === "space") ? cache.space : cache.fractal;
    
    C.pts = pts;
    C.prevPts = prevPts;
    C.bb = bb;
    C.stroke = stroke;
    C.lineWidth = lineWidth;
    C.seqLen = seqLen;

    // Precomputes segment count for HUD
    C.segCount = computeSegCount(pts);
}

function clear(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
}

// Updates HUD: segment and bounding-box readouts
function updateHUD(segEl, bboxEl, C) {
    // Shows number of drawable line segments incurrent path
    segEl.textContent = `Segments: ${C.segCount.toLocaleString()}`;

    // Uses cached bounding box if available
    // Otherwise computes it from points using bboxOfSegments() function
    const bb = C.bb || bboxOfSegments(C.pts || []);

    // Displays bounding box corners (2 decimal places)
    bboxEl.textContent 
        = `BBox: [${bb.minX.toFixed(2)}, ${bb.minY.toFixed(2)}] -> [${bb.maxX.toFixed(2)}, ${bb.maxY.toFixed(2)}]`;
}

// Deaws complete path *fully* without animation
function drawStaticPath(ctx, view, pts) {
    let started = false;    // Tracks if current subpath has a starting point yet
    ctx.beginPath();

    for (const p of pts) {
        if (!p) {
            // Null points split drawing into separate subpaths
            if (started) {
                ctx.stroke();
                ctx.beginPath();

                started = false;
            }

            continue;
        }

        // Converts world-coordinate point -> canvas pixels
        const q = worldToCanvasPxLocal(view, p.x, p.y);

        // Starts new subpath, or continue existing one
        if (!started) {
            ctx.moveTo(q.x, q.y);
            started = true;
        } else {
            ctx.lineTo(q.x, q.y);
        }
    }

    // Strokes final subpath
    ctx.stroke();
}

// Function renders curve progressively for a tab
async function renderProgressive(tab, { resetView = false } = {}) {
    const { view, canvas, C, segEl, bboxEl } = currentViewAndCanvas(tab);
    if (!view || !canvas || !C.pts) return;

    // Increments tab's render token
    const token = ++C.runningToken;

    view.resizeToDisplay({ trigger: false });
    const ctx = view.ctx;

    // Clears canvas befroe drawing next frame
    clear(ctx, canvas.width, canvas.height);

    // Updates inputs
    if (resetView && C.bb) {
        const padPct = clampNum(UI.paddingInput()?.value ?? 12, 0, 60);
        view.initial = viewFromBBox(C.bb, padPct);
        view.setView(view.initial, { trigger: false });

        // Refreshes HUD info after changing view
        view.updateHUD();
    }

    // Updates text for segment count and bounding-box
    updateHUD(segEl, bboxEl, C);

    ctx.save();

    if (UI.showPreviousGen()?.checked && C.prevPts?.length) {
        // Draws previous generation first, underneath current curve
        ctx.strokeStyle = C.stroke;
        ctx.globalAlpha = 0.18;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        // Makes previous generation slightly thinner
        ctx.lineWidth = Math.max(0.75, C.lineWidth * 0.85);

        drawStaticPath(ctx, view, C.prevPts);
        // Resets alpha befroe drawing current generation
        ctx.globalAlpha = 1;
    }

    // Drawing style for current generation:
    ctx.strokeStyle = C.stroke;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = C.lineWidth;

    // Number of segments to draw before yielding to browser
    // Draws several segments at a time; keeps browser responsive
    const segsPerFrame = clampInt(intOr(UI.animateSpeed()?.value ?? 120, 120), 1, 5000);

    let drawnThisFrame = 0;     // Counts number of line segments drawn in current chunk
    let started = false;        // Tracks whether current subpath has starting point yet

    ctx.beginPath();

    for (let i = 0; i < C.pts.length; i++) {
        // Stops if another render stared while this running
        if (token !== C.runningToken) {
            ctx.restore();
            return;
        }

        const p = C.pts[i];

        if (!p) {
            // Null marks break between disconnected path components
            if (started) {
                // Finishes current subpath before starting another
                ctx.stroke();
                ctx.beginPath();
                started = false;
            }

            continue;
        }

        // Converts world coordinates -> canvas pixels
        const q = worldToCanvasPxLocal(view, p.x, p.y);

        if (!started) {
            // First point: moves without drawing
            ctx.moveTo(q.x, q.y);
            started = true;
        } else {
            // Draws segment from previous point
            ctx.lineTo(q.x, q.y);
            drawnThisFrame++;
        }

        if (drawnThisFrame >= segsPerFrame) {
            ctx.stroke();   // Strokes s.t. appears on screen

            // Starts new path from current endpoint
            ctx.beginPath();
            ctx.moveTo(q.x, q.y);

            drawnThisFrame = 0;
            await nextFrame();
        }
    }

    ctx.stroke();       // Stroke any remaining segments after loop
    ctx.restore();      // Restores canvas
}

function onViewChange(tab) {
    // redraws callback used after panning/zooming
    renderProgressive(tab, { resetView: false }).catch(console.error);
}

// Animating iteration-by-iteration:
async function animateBuildCurve(tab, {
    title = "",
    axiom,
    rules,
    angleDeg,
    turtleMap,
    lineWidth,
    stroke,
    iterations,
}) {
    // Cancels current build before starting the animation
    cancelBuild();
    const myToken = buildToken;

    const delayMs = Math.max(0, intOr(UI.buildDelay().value, 180));     // delay between generations
    const autoFitEach = !!UI.buildAutoFit().checked;

    let s = String(axiom || "");                // starts axiom as generation 0
    const n = clampInt(iterations, 0, 30);      // clamps iteration count to avoid big build-ups

    for (let i = 0; i <= n; i++) {
        if (myToken !== buildToken) return;

        // Renders info for this generated curve
        const pts = turtleToSegments(s, angleDeg, turtleMap);
        const bb = bboxOfSegments(pts);

        // Converts sequence to drawable turtle path points
        const prevSeq = i > 0 ? rewrite(axiom, rules, i - 1) : "";
        const prevPts = i > 0 
            ? turtleToSegments(prevSeq, angleDeg, turtleMap) 
            : null;

        setCacheForTab(tab, { 
            pts, 
            prevPts, 
            bb, 
            stroke, 
            lineWidth, 
            seqLen: s.length 
        });

        // Shows progress info in readout
        UI.readout().textContent 
            = `${title}${title ? " | " : ""}build ${i}/${n} | seq~${s.length.toLocaleString()} | segments~${cache[tab].segCount.toLocaleString()}`;
        syncGenerationUI(i, n);

        // Renders the generation progressively
        await renderProgressive(tab, { resetView: autoFitEach });
        // Check in case cancelled mid-rendering
        if (myToken !== buildToken) return;

        if (i < n) {
            // Rewrites once to produce next gen
            s = rewriteOnce(s, rules);
            if (s.length > 2_000_000) break;

            // May be used to pause between generations
            if (delayMs > 0) {
                await sleep(delayMs);
            }
        }
    }

    // Optional: runs dimension estimate after animation finishes
    await maybeAutoDim();
}

// Updates preset dropdown s.t. only shows presets for active tab
function refreshPresetListForTab(tabId) {
    const select = UI.presetSelect();

    // Using correct presets for the current tab
    const wanted = tabId === "space" ? "space" : "fractal";
    const items = PRESETS.filter((p) => p.category === wanted);

    // Remember current selection before rebuilding dropdown
    const current = select.value;
    select.innerHTML = "";

    for (const p of items) {
        // Creates one option per valid preset
        const opt = document.createElement("option");

        opt.value = p.id;
        opt.textContent = p.name;

        select.appendChild(opt);
    }

    // Keeps current selection if exists in new tab
    const still = items.some((p) => p.id === current);
    // Otherwise, fallback to first preset for that tab
    select.value = still 
        ? current 
        : (items[0]?.id || "");
}

function getSelectedPreset() {
    const id = UI.presetSelect().value;

    // Returns currently selected preset object
    // Otehrwise, null
    return PRESETS.find((p) => p.id === id) || null;
}

// Synchronises generation slider and generation text readout
function syncGenerationUI(value, max = null) {
    const v = clampInt(value, 0, 30);   // clamps in safe range

    const scrub = UI.generationScrub();
    if (scrub) {
        if (max !== null) {
            // Updates slider max when new bild has known final generation
            scrub.max = String(Math.max(0, max));
        }

        if (document.activeElement !== scrub) {
            // Ensures we are not competing with user's slider drag
            scrub.value = String(v);
        }
    }

    if (UI.generationValue()) {
        UI.generationValue().textContent = `gen ${v}`;      // Updates generation label
    }
}

// Builds grammar object from current input fields
function currentGrammarFromFields() {
    const preset = getSelectedPreset();
    // Reads drawing style from UI
    const lineWidth = clampNum(UI.lineWidthInput().value, 0.5, 12);
    const stroke = currentInk();

    return {
        title: preset ? preset.name : "Custom grammar",
        axiom: UI.axiomInput().value.trim() || preset?.axiom || "F",
        rules: parseRulesText(UI.rulesInput().value),
        angleDeg: parseNumber(UI.angleInput().value, preset?.angleDeg ?? 90),
        turtleMap: { 
            ...defaultTurtleMap(), 
            ...(preset?.turtle || {}), 
            ...parseLegend(UI.legendInput().value) 
        },
        lineWidth,
        stroke,
    };
}

// Builds curve for specific generation (no animation)
function buildCurveFromGrammarAt(tab, grammar, iterations) {
    // Clamp generation count
    const n = clampInt(iterations, 0, 30);
    // Builds generation string
    const seq = rewrite(grammar.axiom, grammar.rules, n);

    // Converts sequence to drawable turtle path points
    const prevSeq = n > 0 ? rewrite(grammar.axiom, grammar.rules, n - 1) : "";
    const prevPts = n > 0 
        ? turtleToSegments(prevSeq, grammar.angleDeg, grammar.turtleMap) 
        : null;

    // Renders info for this generated curve
    const pts = turtleToSegments(seq, grammar.angleDeg, grammar.turtleMap);
    const bb = bboxOfSegments(pts);

    // Caches generated path
    setCacheForTab(tab, {
        pts,
        prevPts,
        bb,
        stroke: grammar.stroke,
        lineWidth: grammar.lineWidth,
        seqLen: seq.length,
    });
    
    // Syncs generation scrubber to generated value
    syncGenerationUI(n, clampInt(parseNumber(UI.iterInput().value, n), 0, 30));
    
    // Updates main readout with generator details
    UI.readout().textContent 
    = `${grammar.title} | generation ${n} | seq~${seq.length.toLocaleString()} | segments~${cache[tab].segCount.toLocaleString()}`;
}

// Function builds final curve from currently selected preset or custom grammar
function buildCurveFromPresetOrCustomFinal(tab) {
    // Main iteration input as target generation
    const iterations = clampInt(parseNumber(UI.iterInput().value, 0), 0, 30);
    buildCurveFromGrammarAt(tab, currentGrammarFromFields(), iterations);       // Builds using what's in advanced fields
}

// Copies presets to grammar fields
function loadPresetIntoAdvanced(preset) {
    if (!preset) return;
    
    // Copies preset's angle and axiom into form
    UI.angleInput().value = preset.angleDeg;
    UI.axiomInput().value = preset.axiom;
    // Converts preset rules object to textarea lines
    UI.rulesInput().value = Object.entries(preset.rules)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    
    if (!UI.legendInput().value.trim()) {
        UI.legendInput().value = 
        `F=draw\nG=move\n+=turnLeft\n-=turnRight\n[=push\n]=pop`;
    }
}

function parseParams() {
    // Reads query parameters from current page URL
    const sp = new URLSearchParams(location.search);

    return {
        fractal: (sp.get("fractal") || "TRIC").toUpperCase(),   // compact generator controls
        step: intOr(sp.get("step"), 6),
        color: sp.has("color") ? normaliseHex6(sp.get("color")) : currentInkHex6(),     // normalised six-digit hex string
    };
}

// Builds sharable link
function buildLinkFromGenControls() {
    // Current generator settings
    const fractal = (UI.genFractal().value || "TRIC").toUpperCase();
    const step = clampInt(intOr(UI.genStep().value, 0), 0, 30);
    const color = normaliseHex6(UI.genColor().value);

    const sp = new URLSearchParams();

    // Stores settings in query string
    sp.set("fractal", fractal);
    sp.set("step", String(step));
    sp.set("color", color);

    // Returns full URL
    return `${location.origin}${location.pathname}?${sp.toString()}`;
}

// Builds final curve from compact generator controls
function buildCurveFromGeneratorFinal() {
    // Finds selected compact generator preset
    const code = (UI.genFractal().value || "TRIC").toUpperCase();
    const spec = GEN_CODES.find((x) => x.code === code) || GEN_CODES[0];

    // Clamps steps to preset's maximum allowed
    const step = clampInt(intOr(UI.genStep().value, 0), 0, 30);
    const stepClamped = clampInt(step, 0, spec.stepMax ?? 30);
    UI.genStep().value = String(stepClamped);       // Writes clamped step back into input

    // Normalises colour input
    const color6 = normaliseHex6(UI.genColor().value);
    UI.genColor().value = color6;
    UI.genColorPreview().textContent = `#${color6}`;        // Updates colour preview text

    // Builds generation sequence
    const seq = rewrite(spec.axiom, spec.rules, stepClamped);
    const prevSeq = stepClamped > 0 ? rewrite(spec.axiom, spec.rules, stepClamped - 1) : "";
    
    // Converts sequence to drawable turtle path points
    const pts = turtleToSegments(seq, spec.angleDeg, spec.turtle);
    
    const prevPts = stepClamped > 0 
        ? turtleToSegments(prevSeq, spec.angleDeg, spec.turtle) 
        : null;
    
    // Renders info for this generated curve
    const bb = bboxOfSegments(pts);
    const lw = clampNum(UI.lineWidthInput().value, 0.5, 12);

    // Stores generated compact-preset curve in fractal tab cache
    setCacheForTab("fractal", {
        pts, 
        prevPts, 
        bb,
        stroke: cssColourFromHex6(color6),
        lineWidth: lw,
        seqLen: seq.length
    });

    // Updates main readout with generator details
    UI.readout().textContent 
        = `fractal=${spec.code} | step=${stepClamped} | seq~${seq.length.toLocaleString()}`;
    // Compact generator has one fixed ifnal step, so max = current step
    syncGenerationUI(stepClamped, stepClamped);
}

// Function sets active tab and updates the tab-dependent UI
function setActiveTab(tabId) {
    // Stops any building/animation from previous tab
    cancelBuild();

    UI.tabs().forEach((btn) => {
        const on = btn.dataset.tab === tabId;

        // Marks selected tab
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", String(on));
    });

    UI.panes().forEach((p) => {
        // Shows only pane matching active tab
        p.classList.toggle("is-active", p.dataset.pane === tabId)
    });

    // Compact generator controls only belong on fractal tab
    if (UI.genBox()) {
        UI.genBox().style.display = (tabId === "fractal") ? "block" : "none";
    }

    // Updates presets and advanced fields for now active tab
    refreshPresetListForTab(tabId);
    loadPresetIntoAdvanced(getSelectedPreset() || PRESETS[0]);
}

function initTabs() {
    // installs tab button event listeners
    UI.tabs().forEach((btn) => btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;

        setActiveTab(tab);

        renderProgressive(tab, { resetView: false }).catch(console.error);
    }));
}

function exportActiveCanvas() {
    const tab = getActiveTabId();
    const canvas = (tab === "space") ? UI.spaceCanvas() : UI.curveCanvas();

    exportCanvasPNG(canvas, `curves-${tab}.png`);
}

// Fucntion chooses canvas for dimension estimation
function pickCanvasByTarget(target) {
    const active = getActiveTabId();

    if (target === "active") {
        return (active === "space") ? UI.spaceCanvas() : UI.curveCanvas();
    }

    if (target === "space") {
        return UI.spaceCanvas();
    }
    
    return UI.curveCanvas();
}

// Dimensions:
// Function downsamples canvases to smaller temporary canvas
// Used for image-based dimension estimates
function downsampleToCanvas(srcCanvas, size) {
    const s = Math.max(64, size | 0);

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
        mask[px] = a >= alphaMin ? 1 : 0;       // Any pixel with alpha >= alphaMin treated as occupied/ink
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
                // Pixel is boundary if it occupied & at least one of its direct neighbours is empty
                out[i] = 1;
            }
        }
    }
    
    return out;
}

// Displays result of a dimension estimation
function setDimReadout(result, label = "") {
    const valueEl = UI.dimValue();
    const metaEl = UI.dimMeta();

    if (!result || !Number.isFinite(result.dimension)) {
        valueEl.textContent = "-";
        metaEl.textContent = "Could not estimate (try increasing samples / changing max box).";
        
        return;
    }

    const d = result.dimension;
    const r2 = result.fit?.r2;
    // Updates dimension readout after DimensionLab finishes
    valueEl.textContent = d.toFixed(4);
    metaEl.textContent
        = `${label}${label ? " | " : ""}${result.estimator}${Number.isFinite(r2) ? `, \\(R^2=${r2.toFixed(3)}\\)` : ""}`;
    typesetMath(metaEl);
}

// Function runs box-counting dimension estimation on current dendrite drawing
async function runDimensionEstimate({ label = "" } = {}) {
    UI.dimValue().textContent = "...";
    UI.dimMeta().textContent = "Estimating...";

    const target = UI.dimTarget().value;
    const mode = UI.dimMode().value;

    // Reads estimator options from UI
    const ds = Math.max(128, intOr(UI.dimDownsample().value, 768));
    const minBox = Math.max(1, intOr(UI.dimMinBox().value, 2));
    const maxBox = Math.max(minBox + 1, intOr(UI.dimMaxBox().value, 256));
    const samples = Math.max(6, intOr(UI.dimSamples().value, 12));

    const canvas = pickCanvasByTarget(target);

    // Converts visible canvas -> smaller bitmap
    const { octx, size } = downsampleToCanvas(canvas, ds);
    const img = octx.getImageData(0, 0, size, size);

    // Ink mask marks occupied data
    const ink = makeInkMaskFromImageData(img, size, size, { alphaMin: 16 });
    // Chooses all visible ink OR only boundary pixels
    const bitmap = (mode === "boundary") 
        ? makeBoundaryFromMask(ink, size, size) 
        : ink;

    let result;

    try {
        result = DimensionLab.run({
            estimator: "boxCountBitmap",
            input: {
                kind: "bitmap",
                data: { mask: bitmap, width: size, height: size },
                meta: { target, mode },
            },
            options: { minBox, maxBox, samples },
        });
    } catch (err) {
        console.error(err);

        UI.dimValue().textContent = "-";
        UI.dimMeta().textContent = `Dimension error: ${err.message}`;

        return null;
    }

    setDimReadout(result, label || `${target}/${mode}`);
    return result;
}

// Runs dimension estimation automatically after drawing, if checked
async function maybeAutoDim() {
    // If not checked, returns
    if (!UI.dimAuto().checked) return;

    try {
        // Runs estimator and marks result as automatic
        await runDimensionEstimate({ label: "auto" }); 
    } catch (e) { 
        // If estimation fails, log error
        console.error(e); 
        setDimReadout(null);    // Clears dimension readout
    }
}

function initGeneratorControls() {
    // Rebuilds generator preset dropdown
    UI.genFractal().innerHTML = "";

    for (const f of GEN_CODES) {
        const opt = document.createElement("option")
        ;
        opt.value = f.code;
        opt.textContent = f.name;

        UI.genFractal().appendChild(opt);
    }

    // Loads initial values from UI parameters
    const params = parseParams();

    if (GEN_CODES.some((x) => x.code === params.fractal)) {
        UI.genFractal().value = params.fractal;
    }

    UI.genStep().value = String(clampInt(params.step, 0, 30));
    UI.genColor().value = params.color;
    UI.genColorPreview().textContent = `#${params.color}`;

    UI.genColor().addEventListener("input", () => {
        // Keeps preview label synced with colour input
        UI.genColorPreview().textContent = `#${normaliseHex6(UI.genColor().value)}`;
    });

    UI.genDrawBtn().addEventListener("click", async () => {
        // Stops previous buld
        cancelBuild();

        const code = (UI.genFractal().value || "TRIC").toUpperCase();
        const spec = GEN_CODES.find((x) => x.code === code) || GEN_CODES[0];

        // Clamps requested geneartion to fractal's allowed range
        const step = clampInt(intOr(UI.genStep().value, 0), 0, 30);
        const stepClamped = clampInt(step, 0, spec.stepMax ?? 30);
        UI.genStep().value = String(stepClamped);

        // Normalises colour
        const color6 = normaliseHex6(UI.genColor().value);
        UI.genColor().value = color6;
        UI.genColorPreview().textContent = `#${color6}`;    // Updates preview

        const lw = clampNum(UI.lineWidthInput().value, 0.5, 12);
        const stroke = cssColourFromHex6(color6);

        const mode = UI.constructionMode()?.value || "animate";

        if (mode === "animate") {
            // ANimates generator preset generation-by-generation
            await animateBuildCurve("fractal", {
                title: `fractal=${spec.code}`,
                axiom: spec.axiom,
                rules: spec.rules,
                angleDeg: spec.angleDeg,
                turtleMap: spec.turtle,
                lineWidth: lw,
                stroke,
                iterations: stepClamped,
            });
        } else {
            // Builds and renders final generation directly
            buildCurveFromGeneratorFinal();
            await renderProgressive("fractal", { resetView: true });
            await maybeAutoDim();
        }
    });

    UI.copyLinkBtn().addEventListener("click", async () => {
        const link = buildLinkFromGenControls();
        try {
            // Copies shareable link from current generator settings
            await navigator.clipboard.writeText(link);

            UI.copyLinkBtn().textContent = "Copied!";
            setTimeout(() => (UI.copyLinkBtn().textContent = "Copy link"), 900);
        } catch {
            // Fallback for browsers where clipboard access is blocked
            prompt("Copy this link:", link);
        }
    });
}

// Installs main button and controls event handlers
function initButtons() {
    UI.drawBtn().addEventListener("click", async () => {
        // Stops any curve build in progress
        cancelBuild();

        const tab = getActiveTabId();
        const mode = UI.constructionMode()?.value || "animate";

        if (mode === "animate") {
            const grammar = currentGrammarFromFields();
            const n = clampInt(parseNumber(UI.iterInput().value, 0), 0, 30);

            // Animates curve construction generation-by-generation
            await animateBuildCurve(tab, {
                title: grammar.title,
                axiom: grammar.axiom,
                rules: grammar.rules,
                angleDeg: grammar.angleDeg,
                turtleMap: grammar.turtleMap,
                lineWidth: grammar.lineWidth,
                stroke: grammar.stroke,
                iterations: n,
            });

            return;
        }

        // Scrub mode: uses slider value
        // Otherwise, uses iteration input
        const n = mode === "scrub"
            ? clampInt(parseNumber(UI.generationScrub()?.value, UI.iterInput().value), 0, 30)
            : clampInt(parseNumber(UI.iterInput().value, 0), 0, 30);

        buildCurveFromGrammarAt(tab, currentGrammarFromFields(), n);
        await renderProgressive(tab, { resetView: true });
        await maybeAutoDim();
    });

    UI.resetBtn().addEventListener("click", async () => {
        cancelBuild();

        const tab = getActiveTabId();

        // Resets view belonging to active tab
        if (tab === "space") {
            spaceView.reset({ trigger: true });
        } else {
            fractalView.reset({ trigger: true });
        }

        await maybeAutoDim();
    });

    UI.exportBtn().addEventListener("click", exportActiveCanvas);

    UI.applyCustomBtn().addEventListener("click", async () => {
        cancelBuild();

        const sel = UI.presetSelect();
        // Adds temporary custom preset if neeeded
        if (!sel.querySelector('option[value="__custom__"]')) {
            const opt = document.createElement("option");

            opt.value = "__custom__";
            opt.textContent = "Custom (Advanced)";

            sel.insertBefore(opt, sel.firstChild);
        }

        sel.value = "__custom__";

        const tab = getActiveTabId();
        const mode = UI.constructionMode()?.value || "animate";

        if (mode === "animate") {
            const n = clampInt(parseNumber(UI.iterInput().value, 0), 0, 30);
            const grammar = currentGrammarFromFields();

            // Animates user-entered custom grammar
            await animateBuildCurve(tab, {
                title: "preset=Custom",
                axiom: grammar.axiom,
                rules: grammar.rules,
                angleDeg: grammar.angleDeg,
                turtleMap: grammar.turtleMap,
                lineWidth: grammar.lineWidth,
                stroke: grammar.stroke,
                iterations: n,
            });
            
            return;
        }

        const n = mode === "scrub"
            ? clampInt(parseNumber(UI.generationScrub()?.value, UI.iterInput().value), 0, 30)
            : clampInt(parseNumber(UI.iterInput().value, 0), 0, 30);
        
            buildCurveFromGrammarAt(tab, currentGrammarFromFields(), n);
        await renderProgressive(tab, { resetView: true });
        await maybeAutoDim();
    });

    UI.presetSelect().addEventListener("change", () => {
        // Loads selected preset to editable advanced fields
        loadPresetIntoAdvanced(getSelectedPreset() || PRESETS[0])
    });

    UI.iterInput().addEventListener("input", () => {
        const max = clampInt(parseNumber(UI.iterInput().value, 0), 0, 30);
        
        // Keeps generation scrubber within chosen max iteration count
        syncGenerationUI(
            Math.min(clampInt(parseNumber(UI.generationScrub()?.value, max), 0, 30), max), 
            max
        );
    });

    UI.generationScrub().addEventListener("input", async () => {
        cancelBuild();

        // Moving scrubber swtches construction to scrub mode
        UI.constructionMode().value = "scrub";

        const tab = getActiveTabId();
        const n = clampInt(parseNumber(UI.generationScrub().value, 0), 0, 30);
        
        buildCurveFromGrammarAt(tab, currentGrammarFromFields(), n);
        await renderProgressive(tab, { resetView: true });
    });

    UI.showPreviousGen().addEventListener("change", () => {
        // Redraws with/without previous generation overlay
        renderProgressive(getActiveTabId(), { resetView: false }).catch(console.error);
    });

    UI.dimRunBtn().addEventListener("click", () => runDimensionEstimate());
}

function installDoubleClickZoom(view2d, drawAfter, factor = 1.6) {
    view2d.canvas.addEventListener("dblclick", (e) => {
        e.preventDefault();

        const rect = view2d.canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (view2d.canvas.width / rect.width);
        const cy = (e.clientY - rect.top) * (view2d.canvas.height / rect.height);
       
        const w = view2d.canvasPxToWorld(cx, cy);
        // Shift + double click zooms out
        const f = e.shiftKey ? 1 / factor : factor;
        // Double click-zoom:
        view2d.zoomAtWorldPoint(w.x, w.y, f, { trigger: true });
        if (typeof drawAfter === "function") drawAfter();
    });
}

function initViews() {
    // Main fractal/curve canvas view
    fractalView = new View2D({
        canvas: UI.curveCanvas(),
        initial: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
        enableDragPan: true,
        enableWheelZoom: true,
        enableClickZoom: false,

        // Redraws after panning/zooming
        onChange: () => onViewChange("fractal"),
    });
    // Double-click zoom added to curve canvas
    installDoubleClickZoom(fractalView, () => onViewChange("fractal"));

    // Space-filling curve canvas view
    spaceView = new View2D({
        canvas: UI.spaceCanvas(),
        zoomIndicatorEl: qs("#zoom-indicator-space"),
        mouseCoordsEl: qs("#mouse-coords-space"),
        initial: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
        enableDragPan: true,
        enableWheelZoom: true,
        enableClickZoom: false,

        // Redraws afer panning/zooming
        onChange: () => onViewChange("space"),
    });

    // Adds double-click zoom to space-filling canvas
    installDoubleClickZoom(spaceView, () => onViewChange("space"));

    fractalView.resizeToDisplay({ trigger: false });
    spaceView.resizeToDisplay({ trigger: false });
}

function initResizeRedraw() {
    let t = null;       // Stores resize timer
    window.addEventListener("resize", () => {
        clearTimeout(t);    // Cancels previous redraw request if still resizing
        // Small debounce for redrawing after browser resizing
        t = setTimeout(() => {
            fractalView.resizeToDisplay({ trigger: false });
            spaceView.resizeToDisplay({ trigger: false });

            // Redraws tab currently active
            onViewChange(getActiveTabId());
        }, 80);
    });
}

// Main page initialisaiton
async function init() {
    initTabs();
    initViews();
    initGeneratorControls();
    initButtons();
    initResizeRedraw();

    setActiveTab("fractal");
    refreshPresetListForTab("fractal");
    loadPresetIntoAdvanced(getSelectedPreset() || PRESETS[0]);

    const n = clampInt(parseNumber(UI.iterInput().value, 4), 0, 30);
    syncGenerationUI(n, n);
    const grammar = currentGrammarFromFields();

    await animateBuildCurve("fractal", {
        title: grammar.title,
        axiom: grammar.axiom,
        rules: grammar.rules,
        angleDeg: grammar.angleDeg,
        turtleMap: grammar.turtleMap,
        lineWidth: grammar.lineWidth,
        stroke: grammar.stroke,
        iterations: n,
    });
}

// Starts page
init().catch((err) => {
    // Reports set-up errors clearly
    console.error(err);
    alert(`Curves Lab failed:\n${err.message}`);
});
