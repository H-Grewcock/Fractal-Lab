// js/pages/ifs.js:
import { View2D } from "../shared/view2D.js";
import { qs, parseNumber, resizeCanvasToDisplaySize } from "../shared/dom.js";
import { exportCanvasPNG } from "../shared/exportMedia.js";
import { DimensionLab } from "../shared/dimension/index.js";

// Keeps number in interval [a, b]
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Multiplication of 2 x 2 matrices
const mul2x2 = (A, B) => ([
    [
        A[0][0] * B[0][0] + A[0][1] * B[1][0], 
        A[0][0] * B[0][1] + A[0][1] * B[1][1]
    ],
    [
        A[1][0] * B[0][0] + A[1][1] * B[1][0], 
        A[1][0] * B[0][1] + A[1][1] * B[1][1]
    ],
]);
// Multiplies 2 x 2 matrix by 2D vector
const mul2x2Vec = (A, v) => ([
    A[0][0] * v[0] + A[0][1] * v[1], 
    A[1][0] * v[0] + A[1][1] * v[1]
]);
// Adds two 2D vectors
const add2 = (a, b) => ([a[0] + b[0], a[1] + b[1]]);

function orientToMatrixAndShift({ rot, flip }) {
    const R = [
        [[1, 0], [0, 1]],       // 0°
        [[0, -1], [1, 0]],      // 90°
        [[-1, 0], [0, -1]],     // 180°
        [[0, 1], [-1, 0]],      // 270°
    ][((rot % 4) + 4) % 4];

    const Fx = [[-1, 0], [0, 1]]; // Reflecting x |-> -x

    let S = R;
    let shift = [0, 0];

    if (flip) {
        // Applies reflection after current rotation
        S = mul2x2(S, Fx);
        // Shifts back because reflecting sends unit square into negative x
        shift = add2(shift, [1, 0]);
    }

    // Works out where transformed unit-square corners land
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]]
        .map(c => add2(mul2x2Vec(S, c), shift));

    // REshifts shape s.t it sits in positive unit-square region
    const minX = Math.min(...corners.map(p => p[0]));
    const minY = Math.min(...corners.map(p => p[1]));
    shift = add2(shift, [-minX, -minY]);

    return { S, shift };
}

function buildCellAffine(cell, orient) {
    // Scales by cell width/height
    const A = [[cell.w, 0], [0, cell.h]];
    // Translates to cell's bottom-left corner
    const b = [cell.x0, cell.y0];

    const { S, shift }=orientToMatrixAndShift(orient);
    // w(x) = A * (S*x + shift) + b => A' = A * s, b' = A * shift + b:
    const A2 = mul2x2(A, S);
    const b2 = add2(mul2x2Vec(A, shift), b);

    return {
        a: A2[0][0],
        b: A2[0][1],
        c: A2[1][0],
        d: A2[1][1],
        tx: b2[0],
        ty: b2[1]
    };
}

function det(m) {
    // Determinant calculation for affine map's 2 x 2 linear part
    return m.a * m.d - m.b * m.c;
}

// Applies inverse of an affine map to a point
function invApply(m, x, y) {
    const D = det(m);

    // Prevents singular or nearly singular maps
    if (Math.abs(D) < 1e-14) return null;

    const X = x - m.tx;
    const Y = y - m.ty;

    // Inverse of 2 x 2 matrix applied to translated point
    const u = ( m.d * X - m.b * Y) / D;
    const v = (-m.c * X + m.a * Y) / D;

    return [u, v];
}

function fwdApply(m, x, y) {
    // Applies affine map forwards to a point
    return [
        m.a * x + m.b * y + m.tx, 
        m.c * x + m.d * y + m.ty
    ];
}

function seedSquare(W, H) {
    const mask = new Uint8Array(W * H);
    // 1 = occupied/inside current construction
    mask.fill(1);

    // Creates a full square mask
    // Every pixel is initially occupied, representing the starting set E0
    return mask;
}

// Used for Sierpinski-triangle-style constructions
function seedTriangle(viewBounds, W, H) {
    // Creates triangular starting mask
    const mask = new Uint8Array(W * H);
    const xSpan = viewBounds.xMax - viewBounds.xMin;
    const ySpan = viewBounds.yMax - viewBounds.yMin;

    for (let j = 0; j < H; j++) {
        // Converts pixel row -> world y-coordinate
        const y = viewBounds.yMax - (j + 0.5) / H * ySpan;

        for (let i = 0; i < W; i++) {
            // Converts pixel column -> world x-coordinate
            const x = viewBounds.xMin + (i + 0.5) / W * xSpan;
            // Unit right triangle: x >= 0, y >= 0, x + y <= 1
            if (x >= 0 && y >= 0 && (x + y) <= 1) {
                mask[j * W + i] = 1;
            }
        }
    }

    return mask;
}

// Deterministic Iteration: applies all active affine maps to previous set and produces the next set mask
function iterateMask({ viewBounds, affines, maskIn, W, H}) {
    const maskOut = new Uint8Array(W * H);
    const xSpan = viewBounds.xMax - viewBounds.xMin;
    const ySpan = viewBounds.yMax - viewBounds.yMin;

    for (const m of affines) {
        for (let j = 0; j < H; j++) {
            // Output pixel y-coordinate in world space
            const y = viewBounds.yMax - (j + 0.5) / H * ySpan;

            for (let i = 0; i < W; i++) {
                // Output pixel x-coordinate in world space
                const x = viewBounds.xMin + (i + 0.5) / W * xSpan;

                // Pulls output point back through affine map
                const uv = invApply(m, x, y);
                if (!uv) continue;

                const u = uv[0];
                const v = uv[1];

                // Converts inverse point back to a pixel in the input mask
                const pi = ((u - viewBounds.xMin) / xSpan * W) | 0;
                const pj = ((viewBounds.yMax - v) / ySpan * H) | 0;

                // If inverse point occupied befor, marks this output pixel
                if (pi >= 0 && pi < W && pj >= 0 && pj < H) {
                    if (maskIn[pj * W + pi]) {
                        maskOut[j * W + i] = 1;
                    }
                }
            }
        }
    }

    return maskOut;
}

// Chaos Game: Rather than iterating whole sets, follows one random orbit and marks pixels it visits
function chaosGame({ viewBounds, affines, W, H, steps = 200000, burn = 200}) {
    const mask = new Uint8Array(W * H);
    // Fixed non-special starting point
    let x = 0.1234;
    let y = 0.5678;

    const xSpan = viewBounds.xMax - viewBounds.xMin;
    const ySpan = viewBounds.yMax - viewBounds.yMin;

    for (let k = 0; k < steps + burn; k++) {
        // Chooses random map uniformly
        const m = affines[(Math.random() * affines.length) | 0];

        // Applies chosen affine map
        [x, y] = fwdApply(m, x, y);

        // Skips early transient points
        if (k < burn) continue;

        // Converts world point -> mask pixel
        const i = ((x - viewBounds.xMin) / xSpan * W) | 0;
        const j = ((viewBounds.yMax - y) / ySpan * H) | 0;
        if (i >= 0 && i < W && j >= 0 && j < H) {
            mask[j * W + i] = 1;
        }
    }

    return mask;
}

// Draws binary mask to canvas
function drawMask(ctx, mask, W, H, sourceBounds, viewBounds) {
    const img = ctx.createImageData(W, H);
    const data = img.data;

    for (let p = 0; p < W * H; p++) {
        // Black for occupied
        // White for empty
        const on = mask[p] ? 0 : 255;
        const k = 4 * p;

        data[k] = on;
        data[k + 1] = on;
        data[k + 2] = on;
        data[k + 3] = 255;
    }

    // Puts mask on to an off-screen canvas first
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    off.getContext("2d").putImageData(img, 0, 0);

    const xSpan = viewBounds.xMax - viewBounds.xMin;
    const ySpan = viewBounds.yMax - viewBounds.yMin;

    // Find where the source bounds sit inside the current view
    const left = (sourceBounds.xMin - viewBounds.xMin) / xSpan * W;
    const right = (sourceBounds.xMax - viewBounds.xMin) / xSpan * W;
    const top = (viewBounds.yMax - sourceBounds.yMax) / ySpan * H;
    const bottom = (viewBounds.yMax - sourceBounds.yMin) / ySpan * H;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);

    ctx.imageSmoothingEnabled = false;      // Keeps hard pixel edges rather than blurring mask
    ctx.drawImage(off, left, top, right - left, bottom - top);
}

function drawAxes(ctx, viewBounds, W, H) {
    const xSpan = viewBounds.xMax - viewBounds.xMin;
    const ySpan = viewBounds.yMax - viewBounds.yMin;
    
    // Detect whether the current view is close to the unit square.
    const near01 = 
        Math.abs(viewBounds.xMin - 0) < 0.25 * xSpan &&
        Math.abs(viewBounds.xMax - 1) < 0.25 * xSpan &&
        Math.abs(viewBounds.yMin - 0) < 0.25 * ySpan &&
        Math.abs(viewBounds.yMax - 1) < 0.25 * ySpan;
    
    const xticks = near01 ? [0, 0.5, 1] : [viewBounds.xMin, viewBounds.xMax];
    const yticks = near01 ? [0, 0.25, 0.5, 0.75, 1] : [viewBounds.yMin, viewBounds.yMax];

    const xToPx = (x) => (x - viewBounds.xMin) / xSpan * W;
    const yToPx = (y) => (viewBounds.yMax - y) / ySpan * H;

    ctx.save();

    // Outer border
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Draws y-axis if x = 0 visible
    if (viewBounds.xMin <= 0 && viewBounds.xMax >= 0) {
        const px = xToPx(0);

        ctx.beginPath();
        ctx.moveTo(px + 0.5, 0);
        ctx.lineTo(px + 0.5, H);
        ctx.stroke();
    }

    // Draws x-axis if y = 0 visible
    if (viewBounds.yMin <= 0 && viewBounds.yMax >= 0) {
        const py = yToPx(0);
        ctx.beginPath();
        ctx.moveTo(0, py + 0.5);
        ctx.lineTo(W, py + 0.5);
        ctx.stroke();
    }

    ctx.fillStyle = "rgba(0, 0, 0, 0.86)";
    ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";

    // Formats common unit-square fractions nicely
    const fmt = (v) => {
        const eps = 1e-10;
        const fr = [[0,"0"],[0.25,"1/4"],[0.5,"1/2"],[0.75,"3/4"],[1,"1"]];

        for (const [a, s] of fr) {
            if (Math.abs(v - a) < eps) {
                return s;
            }
        }

        return String(Math.round(v * 1000) / 1000);
    };

    // Draws x-axis tick marks
    for (const t of xticks) {
        const px = xToPx(t);

        ctx.strokeStyle = "rgba(0, 0, 0, 0.36)";
        ctx.beginPath();
        ctx.moveTo(px + 0.5, H - 1);
        ctx.lineTo(px + 0.5, H - 8);
        ctx.stroke();

        ctx.fillText(fmt(t), px + 4, H - 13);
    }

    // Draws y-axis tick marks
    for (const t of yticks) {
        const py = yToPx(t);

        ctx.strokeStyle = "rgba(0, 0, 0, 0.36)";
        ctx.beginPath();
        ctx.moveTo(0, py + 0.5);
        ctx.lineTo(8, py + 0.5);
        ctx.stroke();

        ctx.fillText(fmt(t), 12, Math.max(14, py - 4));
    }

    // Corner labels for unit-square view
    if (near01) {
        ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
        ctx.fillText("(0,1)", 12, 18);
        ctx.fillText("(1,1)", Math.max(12, W - 70), 18);
        ctx.fillText("(0,0)", 12, H - 18);
        ctx.fillText("(1,0)", Math.max(12, W - 70), H - 18);
    }

    ctx.restore();
}

// Function adds figure-specific labels to main canvas
function drawFigureAnnotations(ctx, viewBounds, W, H) {
    const xSpan = viewBounds.xMax - viewBounds.xMin;
    const ySpan = viewBounds.yMax - viewBounds.yMin;

    const xToPx = (x) => (x - viewBounds.xMin) / xSpan * W;
    const yToPx = (y) => (viewBounds.yMax - y) / ySpan * H;

    ctx.save();
    ctx.font = "18px Georgia, 'Times New Roman', serif";
    ctx.fillStyle = "rgba(0, 0, 0, 0.88)";

    const eLabel = currentIter === 0 ? "E0" : `E${currentIter}`;
    ctx.fillText(eLabel, W / 2 - 12, H - 16);

    if (activePreset === "falconerBlocks") {
        const lambda = clamp(parseNumber(lambdaEl?.value, 0.18), 0, 0.45);
        ctx.font = "15px Georgia, 'Times New Roman', serif";

        // Length labels for the Falconer-style construction.
        ctx.fillText("1/2", xToPx(0.22), yToPx(2 / 3) + 20);
        ctx.fillText("1/3", xToPx(0.52), yToPx(5 / 6));
        ctx.fillText("1/2", xToPx(lambda + 0.2), yToPx(1 / 3) - 8);
        ctx.fillText("1/3", xToPx(lambda + 0.52), yToPx(1 / 6));

        // Lambda distance marker
        const y = yToPx(0.08);
        const x0 = xToPx(0);
        const x1 = xToPx(lambda);

        ctx.strokeStyle = "rgba(0, 0, 0, 0.82)";
        ctx.fillStyle = "rgba(0, 0, 0, 0.82)";

        // Adds lambda arrow to match mathematical construction
        drawArrow(ctx, x0 + 10, y, x1 - 4, y);
        drawArrow(ctx, x1 - 4, y, x0 + 10, y);

        ctx.fillText("lambda", Math.max(12, (x0 + x1) / 2 - 22), y - 8);
    }

    ctx.restore();
}

// Function draws small arrow between two canvas-pixel points
function drawArrow(ctx, x1, y1, x2, y2) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = 8;

    // Main line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrow head
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}

function drawConstructionOverlay(ctx, viewBounds, W, H) {
    // Draws optional construction overlays for active maps
    const showBoxes = showConstructionEl?.checked ?? true;
    const showLabels = showLabelsEl?.checked ?? true;
    if (!showBoxes && !showLabels) return;

    const xSpan = viewBounds.xMax - viewBounds.xMin;
    const ySpan = viewBounds.yMax - viewBounds.yMin;

    const xToPx = (x) => (x - viewBounds.xMin) / xSpan * W;
    const yToPx = (y) => (viewBounds.yMax - y) / ySpan * H;

    ctx.save();
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";

    maps.forEach((map, idx) => {
        if (!map.enabled) return;

        const aff = buildCellAffine(map.cell, map.orient);
        // Image of unit square under this map
        const corners = [
            fwdApply(aff, 0, 0),
            fwdApply(aff, 1, 0),
            fwdApply(aff, 1, 1),
            fwdApply(aff, 0, 1),
        ];
        const pts = corners.map(([x, y]) => ({
            x: xToPx(x), 
            y: yToPx(y)
        }));

        const centre = fwdApply(aff, 0.5, 0.5);
        const arrowStart = fwdApply(aff, 0.25, 0.5);
        const arrowEnd = fwdApply(aff, 0.78, 0.5);

        if (showBoxes) {
            // Blue dashed image box
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(37, 99, 235, 0.85)";
            
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);

            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }

            ctx.closePath();
            ctx.stroke();

            // Red direction arrow inside the box
            ctx.setLineDash([]);
            ctx.strokeStyle = "rgba(220, 38, 38, 0.9)";
            ctx.fillStyle = "rgba(220, 38, 38, 0.9)";
            ctx.lineWidth = 2;
            // Optional direction arrows
            drawArrow(
                ctx,
                xToPx(arrowStart[0]),
                yToPx(arrowStart[1]),
                xToPx(arrowEnd[0]),
                yToPx(arrowEnd[1])
            );
        }

        if (showLabels) {
            // Optional labels
            const label = map.label || `w${idx + 1}`;
            const px = xToPx(centre[0]);
            const py = yToPx(centre[1]);

            // Label background
            ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
            const width = ctx.measureText(label).width + 10;
            ctx.fillRect(px - width / 2, py - 10, width, 18);

            ctx.strokeStyle = "rgba(15, 23, 42, 0.18)";
            ctx.strokeRect(px - width / 2, py - 10, width, 18);

            // Label text
            ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
            ctx.fillText(label, px - width / 2 + 5, py + 3);
        }
    });

    ctx.restore();
}

const canvas = qs("#ifsCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const constructionStrip = qs("#constructionStrip");

const modeEl = qs("#ifsMode");
const resEl = qs("#ifsResolution");
const nEl = qs("#ifsIterations");
const seedEl = qs("#ifsSeed");
const exampleEl = qs("#ifsExample");
const lambdaEl = qs("#lambdaParam");
const showConstructionEl = qs("#showConstruction");
const showLabelsEl = qs("#showLabels");

const drawBtn = qs("#drawIFS");
const stepBtn = qs("#stepIFS");
const playBtn = qs("#playIFS");
const pauseBtn = qs("#pauseIFS");
const resetViewBtn = qs("#resetViewIFS");
const exportBtn = qs("#exportIFS");
const exportFigureBtn = qs("#exportFigureIFS");
const clearBtn = qs("#clearIFS");

const addMapBtn = qs("#addMapIFS");
const mapsContainer = qs("#mapsContainer");

const xMinEl = qs("#xMin");
const xMaxEl = qs("#xMax");
const yMinEl = qs("#yMin");
const yMaxEl = qs("#yMax");
const applyRangeBtn = qs("#applyRangeIFS");

const ifsReadout = qs("#ifsReadout");
const iterIndicator = qs("#iter-indicator");
const zoomIndicatorEl = qs("#zoom-indicator");
const mouseCoordsEl = qs("#mouse-coords");

// Dimension
const dimModeEl = qs("#dimMode");
const dimDownsampleEl = qs("#dimDownsample");
const dimMinBoxEl = qs("#dimMinBox");
const dimMaxBoxEl = qs("#dimMaxBox");
const dimSamplesEl = qs("#dimSamples");
const dimRunBtn = qs("#dimRunBtn");
const dimValueEl = qs("#dimValue");
const dimMetaEl = qs("#dimMeta");

const DEFAULT_VIEW = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };

let view2d;
let maps = [];
let activePreset = "falconerBlocks";
let simBounds = { ...DEFAULT_VIEW };
let maskBounds = { ...DEFAULT_VIEW };
let currentIter = 0;
let mask = null;

let playing = false;
let raf = null;

// Function formats numbers neatly for input boxes and readouts
function fmt(x, places = 3) {
    const n = Number(x);
    if (!Number.isFinite(n)) {
        return "0";
    }
    const r = Number(n.toFixed(places));

    // Avoids displaying value "-0"
    return Object.is(r, -0) ? "0" : String(r);
}

function newMap({ x0, y0, w, h, rot = 0, flip = 0, enabled = true, label = "" }) {
    // Creates new map object from simple rectangle/orientation data
    return {
        cell: { x0, y0, w, h },
        orient: { rot, flip },
        enabled,
        label,
    };
}

function setSimResolution(px) {
    // Sets the simulation canvas resolution
    const r = clamp(parseInt(px, 10) || 600, 120, 2400);
    canvas.width = r;   // Canvsa kept square
    canvas.height = r;

    view2d?.resizeToDisplay?.({ trigger: false });
    ifsReadout.textContent = `iter = ${currentIter} | res = ${r}`;
}

function activeAffines() {
    // Returns all currently enabled affine maps
    return maps
        // Filtered to currently enabled maps
        .filter(m => m.enabled)
        .map(m => buildCellAffine(m.cell, m.orient));
}

function resetSeed() {
    // Resets current mask to the chosen seed set
    setSimResolution(resEl.value);
    
    currentIter = 0;
    iterIndicator.textContent = `Iter: ${currentIter}`;
    
    maskBounds = { ...simBounds };

    // Chooses square or triangle seed set
    mask = (seedEl.value === "unitTriangle")
        ? seedTriangle(simBounds, canvas.width, canvas.height)
        : seedSquare(canvas.width, canvas.height);
    
    renderConstructionStrip();
}

function redraw(mouseWorld = null) {
    if (!mask) return;

    // Redraws the main IFS canvas
    drawMask(ctx, mask, canvas.width, canvas.height, maskBounds, view2d.view);
    drawAxes(ctx, view2d.view, canvas.width, canvas.height);
    drawConstructionOverlay(ctx, view2d.view, canvas.width, canvas.height);
    drawFigureAnnotations(ctx, view2d.view, canvas.width, canvas.height);

    ifsReadout.textContent = `iter = ${currentIter} | res = ${canvas.width}`;
    iterIndicator.textContent = `Iter: ${currentIter}`;

    if (mouseWorld && mouseCoordsEl) {
        mouseCoordsEl.textContent = `X: ${mouseWorld.x.toFixed(2)}, Y: ${mouseWorld.y.toFixed(2)}`;
    }

    if (zoomIndicatorEl) {
        const initW = (view2d.initial.xMax - view2d.initial.xMin);
        const currW = (view2d.view.xMax - view2d.view.xMin);
        const z = initW / currW;

        zoomIndicatorEl.textContent = `Zoom: ${z.toFixed(2)}x`;
    }
}

// Builds seed mask used for construciton-stage previews
function stageSeed(W, H) {
    return (seedEl.value === "unitTriangle")
        ? seedTriangle(simBounds, W, H)
        : seedSquare(W, H);
}

// Draws one small construction-stage preview panel
function drawMiniStage(canvasEl, stageMask, label) {
    const W = 220;
    const H = 220;

    canvasEl.width = W;
    canvasEl.height = H;

    const miniCtx = canvasEl.getContext("2d", { willReadFrequently: true });
    drawMask(miniCtx, stageMask, W, H, simBounds, simBounds);
    drawAxes(miniCtx, simBounds, W, H);

    miniCtx.save();

    miniCtx.font = "17px Georgia, 'Times New Roman', serif";
    miniCtx.fillStyle = "rgba(0, 0, 0, 0.88)";
    miniCtx.fillText(label, W / 2 - miniCtx.measureText(label).width / 2, H - 12);

    miniCtx.restore();
}

function buildStagePanels() {
    const aff = activeAffines();
    const W = 220;
    const H = 220;
    const finalN = clamp(parseInt(nEl.value, 10) || 8, 4, 16);

    // Strip shows early stages plus final chosen stage
    const wanted = new Map([
        // Stage-panel masks E1, E2, E3 & F
        [1, "E1"],
        [2, "E2"],
        [3, "E3"],
        [finalN, "F"],
    ]);

    let stageMask = stageSeed(W, H);
    const panels = [];

    for (let iter = 1; iter <= finalN; iter++) {
        stageMask = iterateMask({
            viewBounds: simBounds,
            affines: aff,
            maskIn: stageMask,
            W,
            H,
        });

        if (wanted.has(iter)) {
            // Copies mask so later iterations do not mutate saved panel
            panels.push({
                label: wanted.get(iter), 
                mask: new Uint8Array(stageMask) 
            });
        }
    }

    return panels;
}

function renderConstructionStrip() {
    if (!constructionStrip) return;
    constructionStrip.replaceChildren();

    // Renders small construction strip underneath/alongside the main figure
    const panels = buildStagePanels();

    panels.forEach((panel, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "stage-panel";

        const c = document.createElement("canvas");
        const label = document.createElement("div");
        label.className = "stage-label";
        label.textContent = panel.label;

        wrap.append(c, label);
        constructionStrip.appendChild(wrap);
        drawMiniStage(c, panel.mask, panel.label);

        if (idx < panels.length - 1) {
            const arrow = document.createElement("div");
            arrow.className = "stage-arrow";
            arrow.textContent = "->";
            constructionStrip.appendChild(arrow);
        }
    });
}

// Exports separate construciton figure made from stage panels
function exportConstructionFigure() {
    const panels = buildStagePanels();
    if (!panels.length) return;

    const panelSize = 260;
    const gap = 54;
    const pad = 24;
    const labelH = 34;

    const W = pad * 2 + panels.length * panelSize + (panels.length - 1) * gap;
    const H = pad * 2 + panelSize + labelH;

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;

    const outCtx = out.getContext("2d", { willReadFrequently: true });

    // White background for exporting
    outCtx.fillStyle = "#fff";
    outCtx.fillRect(0, 0, W, H);

    panels.forEach((panel, idx) => {
        const x = pad + idx * (panelSize + gap);
        const y = pad;

        const mini = document.createElement("canvas");
        mini.width = panelSize;
        mini.height = panelSize;

        const miniCtx = mini.getContext("2d", { willReadFrequently: true });

        drawMask(miniCtx, panel.mask, panelSize, panelSize, simBounds, simBounds);
        drawAxes(miniCtx, simBounds, panelSize, panelSize);

        outCtx.drawImage(mini, x, y);

        // Borders around each panel
        outCtx.strokeStyle = "rgba(0, 0, 0, 0.65)";
        outCtx.strokeRect(x + 0.5, y + 0.5, panelSize - 1, panelSize - 1);

        // Label between each panel
        outCtx.font = "20px Georgia, 'Times New Roman', serif";
        outCtx.fillStyle = "rgba(0, 0, 0, 0.92)";
        outCtx.fillText(panel.label, x + panelSize / 2 - outCtx.measureText(panel.label).width / 2, y + panelSize + 25);

        if (idx < panels.length - 1) {
            outCtx.font = "28px Georgia, 'Times New Roman', serif";
            // Arrow between panels
            outCtx.fillText("->", x + panelSize + gap / 2 - 12, y + panelSize / 2 + 8);
        }
    });

    exportCanvasPNG(out, "ifs_construction_figure.png");
}

function stepOnce() {
    if (!mask) resetSeed();
    setSimResolution(resEl.value);

    const aff = activeAffines();
    if (!aff.length) return;

    // Performs one deterministic IFS iteration
    mask = iterateMask({
        viewBounds: simBounds,
        affines: aff,
        maskIn: mask,
        W: canvas.width,
        H: canvas.height
    });

    currentIter += 1;
    redraw();   // Redraws
}

function stop() {
    playing = false;

    if (raf) {
        cancelAnimationFrame(raf);
    }
    raf = null;
}

function runFinal(nTarget) {
    stop();
    resetSeed();
    redraw();

    const n = clamp(parseInt(nTarget, 10) || 0, 0, 40);
    // Runs deterministic iteration
    // Iterated up to chosen final stage
    for (let k = 0; k < n; k++) {
        stepOnce();
    }
}

// Runs Chaos Game render using active maps
function runChaos(nTarget) {
    stop();
    resetSeed();

    const aff = activeAffines();    // active maps
    if (!aff.length) return;

    const n = clamp(parseInt(nTarget, 10) || 0, 0, 40);
    // More requested iterations means more Chaos Game samples
    const steps = 60000 + n * 25000;

    mask = chaosGame({
        viewBounds: simBounds,
        affines: aff,
        W: canvas.width,
        H: canvas.height,
        steps,
        burn: 200
    });

    currentIter = n;
    redraw();
}

// Builds editor card for one affine map
function mapCard(idx) {
    const m = maps[idx];
    const el = document.createElement("div");
    el.className = "map-row";

    // Editor mainly generated as HTML as repetitive
    el.innerHTML = `
        <div class="map-head">
            <div class="pill">Map ${idx + 1}</div>
            <label class="pill" style="display:flex; gap:8px; align-items:center;">
                <input type="checkbox" ${m.enabled ? "checked" : ""} data-act="toggle" data-idx="${idx}" />
                enabled
            </label>
        </div>

        <div class="map-grid4">
            <div class="control" style="margin:0;">
                <label>label</label>
                <input value="${m.label || `w${idx + 1}`}" data-label="1" data-idx="${idx}" />
            </div>
            <div class="control" style="margin:0;">
                <label>x0</label>
                <input value="${fmt(m.cell.x0)}" data-k="x0" data-idx="${idx}" />
            </div>
            <div class="control" style="margin:0;">
                <label>y0</label>
                <input value="${fmt(m.cell.y0)}" data-k="y0" data-idx="${idx}" />
            </div>
            <div class="control" style="margin:0;">
                <label>w</label>
                <input value="${fmt(m.cell.w)}" data-k="w" data-idx="${idx}" />
            </div>
            <div class="control" style="margin:0;">
                <label>h</label>
                <input value="${fmt(m.cell.h)}" data-k="h" data-idx="${idx}" />
            </div>
        </div>

        <div class="map-foot">
            <div class="map-actions">
                <button class="btn-mini" data-act="left" data-idx="${idx}" title="Move left">Left</button>
                <button class="btn-mini" data-act="right" data-idx="${idx}" title="Move right">Right</button>
                <button class="btn-mini" data-act="down" data-idx="${idx}" title="Move down">Down</button>
                <button class="btn-mini" data-act="up" data-idx="${idx}" title="Move up">Up</button>
            </div>

            <div class="map-actions">
                <button class="btn-mini" data-act="narrow" data-idx="${idx}" title="Narrow">Narrow</button>
                <button class="btn-mini" data-act="wide" data-idx="${idx}" title="Widen">Widen</button>
                <button class="btn-mini" data-act="short" data-idx="${idx}" title="Shorter">Shorter</button>
                <button class="btn-mini" data-act="tall" data-idx="${idx}" title="Taller">Taller</button>
            </div>

            <div class="map-actions">
                <button class="btn-mini" data-act="rotL" data-idx="${idx}" title="Rotate left">Rotate <-</button>
                <button class="btn-mini" data-act="rotR" data-idx="${idx}" title="Rotate right">Rotate -></button>
                <button class="btn-mini" data-act="flip" data-idx="${idx}" title="Flip">Flip <-></button>
                <span class="pill">r=${m.orient.rot * 90} deg ${m.orient.flip ? "flip" : ""}</span>
            </div>

            <div class="map-actions">
                <button class="btn-mini" data-act="del" data-idx="${idx}" title="Delete">Delete</button>
            </div>
        </div>
    `;

    return el;
}

// Function renders all map editor cards nad attaches their event listeners
function renderMaps() {
    mapsContainer.innerHTML = "";
    maps.forEach((_, idx) => {
        mapsContainer.appendChild(mapCard(idx));
    });

    // Numeric cell inputs
    mapsContainer.querySelectorAll("input[data-k]").forEach(inp => {
        inp.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx, 10);
            const k = e.target.dataset.k;
            maps[idx].cell[k] = parseNumber(e.target.value, maps[idx].cell[k]);

            stop();
            resetSeed();
            redraw();
        });
    });

    // Label inputs
    mapsContainer.querySelectorAll("input[data-label]").forEach(inp => {
        inp.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx, 10);
            
            maps[idx].label = e.target.value.trim() || `w${idx + 1}`;
            
            renderConstructionStrip();
            redraw();
        });
    });

    // Enables/disables checkboxes
    mapsContainer.querySelectorAll("input[data-act=toggle]").forEach(ch => {
        ch.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx, 10);
            maps[idx].enabled = !!e.target.checked;

            stop();
            resetSeed();
            redraw();
        });
    });

    // Map action buttons
    mapsContainer.querySelectorAll("button[data-act]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const act = e.currentTarget.dataset.act;
            const idx = parseInt(e.currentTarget.dataset.idx, 10);
            const m = maps[idx];
            const delta = 0.02;
            const scaleStep = 0.02;

            // Position controls
            if (act === "left") m.cell.x0 -= delta;
            if (act === "right") m.cell.x0 += delta;
            if (act === "down") m.cell.y0 -= delta;
            if (act === "up") m.cell.y0 += delta;

            // Size controls
            if (act === "narrow") m.cell.w = Math.max(0.01, m.cell.w - scaleStep);
            if (act === "wide") m.cell.w += scaleStep;
            if (act === "short") m.cell.h = Math.max(0.01, m.cell.h - scaleStep);
            if (act === "tall") m.cell.h += scaleStep;

            // Orientation controls
            if (act === "rotL") m.orient.rot = (m.orient.rot + 3) % 4;
            if (act === "rotR") m.orient.rot = (m.orient.rot + 1) % 4;
            if (act === "flip") m.orient.flip = m.orient.flip ? 0 : 1;

            // Deleting map controls
            if (act === "del") maps.splice(idx, 1);

            renderMaps();
            stop();
            resetSeed();
            redraw();
        });
    });
}

// Preset construction loader
function preset(name) {
    activePreset = name;

    // Most presets live in unit square
    xMinEl.value = "0"; xMaxEl.value = "1";
    yMinEl.value = "0"; yMaxEl.value = "1";

    simBounds = { ...DEFAULT_VIEW };

    if (name === "falconerBlocks") {
        seedEl.value = "unitSquare";

        const lambda = clamp(parseNumber(lambdaEl?.value, 0.18), 0, 0.45);
        
        maps = [
            newMap({ x0: 0, y0: 2 / 3, w: 0.5, h: 1 / 3, label: "w1" }),
            newMap({ x0: lambda, y0: 0, w: 0.5, h: 1 / 3, label: "w2" }),
        ];
    }

    if (name === "carpet3") {
        seedEl.value = "unitSquare";
        maps = [];

        const s = 1 / 3;

        // 3 x 3 carpet with centre square rmeoved
        for (let j = 0; j < 3; j++) {
            for (let i = 0; i < 3; i++) {
                if (i === 1 && j === 1) continue;

                maps.push(newMap({
                    x0: i * s, 
                    y0: j * s, 
                    w: s, 
                    h: s, 
                    label: `w${maps.length + 1}`
                }));
            }
        }
    }

    if (name === "diagonalDust") {
        seedEl.value = "unitSquare";

        maps = [
            newMap({ x0: 0.0, y0: 0.0, w: 0.5, h: 0.5, label: "w1" }),
            newMap({ x0: 0.5, y0: 0.5, w: 0.5, h: 0.5, label: "w2" }),
        ];
    }

    if (name === "serpinskiTri") {
        seedEl.value = "unitTriangle";

        maps = [
            newMap({ x0: 0.0, y0: 0.0, w: 0.5, h: 0.5, label: "w1" }),
            newMap({ x0: 0.5, y0: 0.0, w: 0.5, h: 0.5, label: "w2" }),
            newMap({ x0: 0.0, y0: 0.5, w: 0.5, h: 0.5, label: "w3" }),
        ];
    }

    if (name === "rotatedTriangle") {
        seedEl.value = "unitTriangle";

        maps = [
            newMap({ x0: 0.0, y0: 0.0, w: 0.5, h: 0.5, label: "w1", rot: 0 }),
            newMap({ x0: 0.5, y0: 0.0, w: 0.5, h: 0.5, label: "w2", rot: 1 }),
            newMap({ x0: 0.0, y0: 0.5, w: 0.5, h: 0.5, label: "w3", rot: 3, flip: 1 }),
        ];
    }

    if (name === "stripColumn") {
        seedEl.value = "unitTriangle";

        maps = [
            newMap({ x0: 0.00, y0: 0.00, w: 0.24, h: 0.12, label: "w1" }),
            newMap({ x0: 0.25, y0: 0.00, w: 0.24, h: 0.12, label: "w2" }),
            newMap({ x0: 0.50, y0: 0.00, w: 0.24, h: 0.12, label: "w3" }),
            newMap({ x0: 0.75, y0: 0.00, w: 0.24, h: 0.12, label: "w4" }),
            newMap({ x0: 0.00, y0: 0.25, w: 0.28, h: 0.18, label: "w5" }),
            newMap({ x0: 0.50, y0: 0.25, w: 0.28, h: 0.18, label: "w6" }),
            newMap({ x0: 0.00, y0: 0.75, w: 0.42, h: 0.18, label: "w7" }),
        ];
    }

    if (name === "orientedBlocks") {
        seedEl.value = "unitSquare";

        maps = [
            newMap({ x0: 0.00, y0: 0.66, w: 0.5, h: 0.33, label: "w1" }),
            newMap({ x0: 0.50, y0: 0.66, w: 0.5, h: 0.33, label: "w2", rot: 1 }),
            newMap({ x0: 0.00, y0: 0.00, w: 0.5, h: 0.33, label: "w3", flip: 1 }),
            newMap({ x0: 0.50, y0: 0.00, w: 0.5, h: 0.33, label: "w4", rot: 3, flip: 1 }),
        ];
    }

    renderMaps();
    stop();

    view2d.setView(DEFAULT_VIEW, { trigger: false });
    resetSeed();
    redraw();
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

// Builds binary mask from cavnas image data
function makeInkMaskFromImageData(img, w, h, { alphaMin = 16 } = {}) {
    const mask = new Uint8Array(w * h);
    const d = img.data;

    // Iterates through pixels
    for (let i = 0, px = 0; i < d.length; i += 4, px++) {
        const a = d[i + 3];
        mask[px] = a >= alphaMin ? 1 : 0;     // Any pixel with alpha >= alphaMin treated as occupied/ink
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

function setDimReadout(result) {
    if (!result || !Number.isFinite(result.dimension)) {
        if (dimValueEl) dimValueEl.textContent = "-";
        if (dimMetaEl) dimMetaEl.textContent = "Could not estimate (try changing box range / samples).";

        return;
    }

    const r2 = result.fit?.r2;
    // Updates dimension readout after DimensionLab finishes
    if (dimValueEl) {
        dimValueEl.textContent = result.dimension.toFixed(4);
    }
    if (dimMetaEl) {
        dimMetaEl.textContent 
            = `${result.estimator}${Number.isFinite(r2) ? `, R2=${r2.toFixed(3)}` : ""}`;
    }
}

// Function runs box-counting dimension estimation on current dendrite drawing
function runDimensionEstimate() {
    if (!dimValueEl || !dimMetaEl) return;
    dimValueEl.textContent = "...";
    dimMetaEl.textContent = "Estimating...";

    // Reads estimator options from UI
    const ds = Math.max(128, parseNumber(dimDownsampleEl?.value, 768) | 0);
    const minBox = Math.max(1, parseNumber(dimMinBoxEl?.value, 2) | 0);
    const maxBox = Math.max(minBox + 1, parseNumber(dimMaxBoxEl?.value, 256) | 0);
    const samples = Math.max(6, parseNumber(dimSamplesEl?.value, 12) | 0);

    // Converts visible canvas -> smaller bitmap
    const { octx, size } = downsampleToCanvas(canvas, ds);
    const img = octx.getImageData(0, 0, size, size);
    
    const data = img.data;
    const fillMask = new Uint8Array(size * size);

    for (let p = 0; p < size * size; p++) {
        const k = 4 * p;
        const r = data[k];
        const g = data[k + 1];
        const b = data[k + 2];

        // Since drawing B&W, dark pixels count as occupied
        fillMask[p] = (r + g + b) < 600 ? 1 : 0;
    }

    // Chooses all visible ink OR only boundary pixels
    const bitmap = (dimModeEl?.value === "boundary")
        ? makeBoundaryFromMask(fillMask, size, size)
        : fillMask;

    try {
        const result = DimensionLab.run({
            estimator: "boxCountBitmap",
            input: {
                kind: "bitmap",
                data: { mask: bitmap, width: size, height: size },
                meta: { page: "ifs" }
            },
            options: { minBox, maxBox, samples },
        });

        setDimReadout(result);
    } catch (err) {
        console.error(err);
        dimValueEl.textContent = "-";
        dimMetaEl.textContent = `Dimension error: ${err.message}`;
    }
}

dimRunBtn?.addEventListener("click", runDimensionEstimate);

// Draw button: runs selected IFS mode
drawBtn.addEventListener("click", () => {
    const mode = modeEl.value;
    const n = nEl.value;

    if (mode === "final") {
        runFinal(n);
        return;
    }
    if (mode === "chaos") {
        runChaos(n);
        return;
    }
    
    stop();
    resetSeed();

    if (activeAffines().length) {
        // In step mode, begin with one determinstic step
        stepOnce();
    } else {
        redraw();
    }
});

// Step button
stepBtn.addEventListener("click", () => {
    stop();

    const mode = modeEl.value;
    if (mode === "chaos") {
        // Chaos mode active = all at once
        runChaos(nEl.value);
    } else {
        // One deterministic step
        stepOnce();
    }
});

playBtn.addEventListener("click", () => {
    stop();
    playing = true;     // Marks aniation as active
    
    // Clamps in safe range s.t. animation can't run forever
    const target = clamp(parseInt(nEl.value, 10) || 0, 0, 40);  // Target number of iterations from UI input
    const mode = modeEl.value;

    if (mode === "chaos") { 
        // Chaos mode drawn all at once rather than step-by-step
        runChaos(target);

        // Turns play state off when Chaos Game render complete
        playing = false; 
        return; 
    }

    const tick = () => {
        if (!playing) return;

        if (currentIter >= target) {
            // Stops when reaching iteration numer
            stop(); 
            return; 
        }

        // Does one determinstic IFS iteration and redraws
        stepOnce();
        // Queues up next animation frame
        raf = requestAnimationFrame(tick);
    };
    // starts animation loop
    raf = requestAnimationFrame(tick);
});

pauseBtn.addEventListener("click", () => stop());

resetViewBtn.addEventListener("click", () => {
    stop();

    view2d.initial = { ...simBounds };
    view2d.setView(simBounds, { trigger: true });
    xMinEl.value = fmt(simBounds.xMin);
    xMaxEl.value = fmt(simBounds.xMax);
    yMinEl.value = fmt(simBounds.yMin);
    yMaxEl.value = fmt(simBounds.yMax);

    resetSeed();    // resetting seed
    redraw();
});

exportBtn.addEventListener("click", () => exportCanvasPNG(canvas, "ifs.png"));
exportFigureBtn?.addEventListener("click", () => exportConstructionFigure());

clearBtn.addEventListener("click", () => {
    stop();
    maps = [];

    renderMaps();
    resetSeed();
    redraw();
});

// Adding a default map button
addMapBtn.addEventListener("click", () => {
    maps.push(newMap({ 
        x0: 0, y0: 0, 
        w: 0.5, h: 0.5, 
        label: `w${maps.length + 1}` 
    }));
    
    renderMaps();
    stop();
    resetSeed();
    redraw();
});

// Example and parameter controls
exampleEl.addEventListener("change", () => preset(exampleEl.value));
lambdaEl?.addEventListener("change", () => {
    if (exampleEl.value === "falconerBlocks") {
        preset(exampleEl.value);
    }
});

showConstructionEl?.addEventListener("change", () => redraw());
showLabelsEl?.addEventListener("change", () => redraw());

seedEl.addEventListener("change", () => { 
    stop(); 
    resetSeed(); 
    redraw(); 
});

resEl.addEventListener("change", () => { 
    stop(); 
    resetSeed(); 
    redraw(); 
});

nEl.addEventListener("change", () => renderConstructionStrip());

// Applies typed coordinate bounds
applyRangeBtn.addEventListener("click", () => {
    stop();

    const xMin = parseNumber(xMinEl.value, view2d.view.xMin);
    const xMax = parseNumber(xMaxEl.value, view2d.view.xMax);
    const yMin = parseNumber(yMinEl.value, view2d.view.yMin);
    const yMax = parseNumber(yMaxEl.value, view2d.view.yMax);

    simBounds = { xMin, xMax, yMin, yMax };
    view2d.setView({ xMin, xMax, yMin, yMax }, { trigger: true });

    resetSeed();
    redraw();
});

function init() {
    // Initialises IFS page
    resizeCanvasToDisplaySize(canvas);

    view2d = new View2D({
        canvas,
        zoomIndicatorEl,
        mouseCoordsEl,
        initial: DEFAULT_VIEW,
        enableDragPan: true,
        enableWheelZoom: true,
        enableRightClickZoom: true,
        enableClickZoom: false,

        // When view changes (e.g. panning, zooming), redraws
        onChange: () => redraw(),
    });

    canvas.addEventListener("pointermove", (e) => {
        const rect = canvas.getBoundingClientRect();

        // Converts CSS mouse position -> canvas pixel coordinates
        const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const cy = (e.clientY - rect.top) * (canvas.height / rect.height);

        const w = view2d.canvasPxToWorld(cx, cy);

        redraw(w);
    }, { passive: true });

    preset(exampleEl.value);
}

init();