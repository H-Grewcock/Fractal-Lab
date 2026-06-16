// js/pages/3DFractals.js:
import { qs, parseNumber, resizeCanvasToDisplaySize } from "../shared/dom.js";
import { View2D } from "../shared/view2D.js";
import { exportCanvasPNG } from "../shared/exportMedia.js";

const canvas = qs("#fractal3DCanvas");
const ctx = canvas.getContext("2d", { alpha: false });

const statusReadout = qs("#statusReadout");
const extraIndicator = qs("#extra-indicator");
const zoomIndicatorEl = qs("#zoom-indicator");
const mouseCoordsEl = qs("#mouse-coords");

const elFractal = qs("#fractalExample");
const tabEscape = qs("#tabEscape");
const tabIFS = qs("#tabIFS");
const escapeControls = qs("#escapeControls");
const ifsControls = qs("#ifsControls");
const elBulbPreset = qs("#bulbPreset");
const elIfsPreset = qs("#ifsPreset");
const elIfsLambda = qs("#ifsLambda");
const elIfsRule = qs("#ifsRule");
const elIterations = qs("#iterationsInput");
const elQuality = qs("#renderQuality");
const elBulbPower = qs("#bulbPower");
const elKeepThreshold = qs("#keepThreshold");

const elJuliaCx = qs("#juliaCx");
const elJuliaCy = qs("#juliaCy");
const elJuliaCz = qs("#juliaCz");
const elJuliaReadout = qs("#juliaReadout");

// Sliced sections
const elPointSize = qs("#pointSize");
const elColour = qs("#colorScheme");
const elRotationSpeed = qs("#rotationSpeed");
const elZoomInput = qs("#zoomLevel");
const elSlicePlane = qs("#slicePlane");
const elSliceValue = qs("#sliceValue");
const elSliceSlider = qs("#sliceSlider");
const elSliceThickness = qs("#sliceThickness");
const elSliceReadout = qs("#sliceReadout");
const btnSlicePrev = qs("#slicePrevBtn");
const btnSliceNext = qs("#sliceNextBtn");
const btnSlicePreset01 = qs("#slicePreset01Btn");
const btnSlicePreset02 = qs("#slicePreset02Btn");
const btnSlicePreset03 = qs("#slicePreset03Btn");
const btnSliceOff = qs("#sliceOffBtn");

const btnRender = qs("#renderBtn");
const btnReset = qs("#resetViewBtn");
const btnSpin = qs("#toggleSpinBtn");
const btnExport = qs("#exportImageBtn");

// Dimension section
const btnDim = qs("#dimRunBtn");
const elDimValue = qs("#dimValue");
const elDimMeta = qs("#dimMeta");
const elDimDown = qs("#dimDownsample");
const elDimSamples = qs("#dimSamples");
const elDimMinBox = qs("#dimMinBox");
const elDimMaxBox = qs("#dimMaxBox");
const elDimMode = qs("#dimMode");

// 2D View State:
let view2d;

// 3D View State:
let angleX = Math.PI / 6;   // Rotation angle around x-axis
let angleY = Math.PI / 6;   // Rotation angle around y-axis
// Scale and pan offets for the projected image
let zoom = 1;
let offsetX = 0;
let offsetY = 0;

// Auto-spin state:
let spinning = false;
let spinRAF = null;

let points = [];            // Stores point cloud
let escapeIters = null;     // Optional escape-iteration data
let pointMeta = null;       // Optional generation/vertex metadata
let activeTab = "escape";   // escape | ifs

let dragging = false;
let dragMode = "rotate";    // rotate | pan
let last = { x: 0, y: 0 };
let visiblePointCount = 0;

// Small status message on the page
function setStatus(s) {
    if (statusReadout) {
        statusReadout.textContent = s;
    }
}

// Function ensures a number stays inside the interval [a,b]
function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
}

function resize() {
    resizeCanvasToDisplaySize(canvas);
}

function clear() {
    const bg = 
        getComputedStyle(document.documentElement)
            .getPropertyValue("--surface")
            .trim() || "#fff";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function updateJuliaReadout() {
    // 3D Julia parameter: c = (cx, cy, cz)
    const cx = parseNumber(elJuliaCx?.value, 0.3);
    const cy = parseNumber(elJuliaCy?.value, -0.2);
    const cz = parseNumber(elJuliaCz?.value, 0.4);

    // Updates visual readout
    if (elJuliaReadout) {
        elJuliaReadout.textContent = `${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}`;
    }

    return [cx, cy, cz];
}

// Sliced planes:
function sliceAxis(plane) {
    // bReturns coordinate index fixed by each slice plane
    if (plane === "xy") return 2;   // z-axis
    if (plane === "xz") return 1;   // y-axis
    if (plane === "yz") return 0;   // x-axis

    // -1 = slicing off/invalid
    return -1;
}

function sliceAxisName(plane) {
    // Returns coordinate name fixed by each slice plane
    if (plane === "xy") return "z";
    if (plane === "xz") return "y";
    if (plane === "yz") return "x";

    return "";
}

function sliceSettings() {
    // Selected slice plane read from UI
    const plane = elSlicePlane?.value || "off";
    // Converts plane name to coordiante index to test
    const axis = sliceAxis(plane);
    const value = clamp(parseNumber(elSliceValue?.value, 0.1), -1.5, 1.5);          // clamps slice centre to safe display range
    const thickness = clamp(parseNumber(elSliceThickness?.value, 0.08), 0.01, 1);   // clamps slice thickness s.t. positive and usable

    return { plane, axis, value, thickness };
}

function pointInSlice(p, settings = sliceSettings()) {
    // Slicing off => every point is visible
    if (settings.axis < 0) return true;

    // Keeps points close enough to selected slice value
    return Math.abs(p[settings.axis] - settings.value) <= settings.thickness / 2;
}

function updateSliceReadout() {
    // Current slice controls in clamped form
    const settings = sliceSettings();

    if (elSliceValue && document.activeElement !== elSliceValue) {
        elSliceValue.value = settings.value.toFixed(2);     // Keeps input synced unless user typing
    }

    if (elSliceSlider && document.activeElement !== elSliceSlider) {
        elSliceSlider.value = String(settings.value);       // Synced slider unless user dragging it
    }

    if (!elSliceReadout) return;

    if (settings.axis < 0) {
        // Simple label when no slice active
        elSliceReadout.textContent = "off";
        return;
    }

    // Displays active plane, fixed axis value, and visible point count
    const axis = sliceAxisName(settings.plane);
    elSliceReadout.textContent = 
        `${settings.plane.toUpperCase()} | ${axis} = ${settings.value.toFixed(2)} | ${visiblePointCount.toLocaleString()} pts`;
}

// Function to update page HUD
function updateHUD(mousePx = null) {
    if (zoomIndicatorEl) zoomIndicatorEl.textContent = `Zoom: ${zoom.toFixed(2)}x`;
    if (extraIndicator) {
        const settings = sliceSettings();
        extraIndicator.textContent = settings.axis < 0
            ? `pts: ${points.length.toLocaleString()}`
            : `slice: ${visiblePointCount.toLocaleString()} / ${points.length.toLocaleString()}`;
    }

    if (elZoomInput && document.activeElement !== elZoomInput) {
        elZoomInput.value = String(Math.round(zoom * 100) / 100);
    }
    if (mouseCoordsEl && mousePx) {
        mouseCoordsEl.textContent = `X: ${mousePx.x.toFixed(1)}, Y: ${mousePx.y.toFixed(1)}`;
    }

    updateSliceReadout();
}

// Projection function:
function project([x, y, z]) {
    const sinX = Math.sin(angleX);
    const cosX = Math.cos(angleX);
    const sinY = Math.sin(angleY);
    const cosY = Math.cos(angleY);

    // Rotating about y-axis
    let dx = cosY * x + sinY * z;
    let dz = -sinY * x + cosY * z;
    // Rotating about x-axis
    let dy = cosX * y - sinX * dz;
    dz = sinX * y + cosX * dz;

    // Scales to fit the canvas
    const scale = Math.min(canvas.width, canvas.height) * 0.35 * zoom;
    return [
        dx * scale + canvas.width / 2 + offsetX,
        dy * scale + canvas.height / 2 + offsetY,
        dz,
    ];
}

function paletteColour(index) {
    // Colours for vertex, map and index
    const colours = [
        "#2563eb", 
        "#16a34a", 
        "#dc2626", 
        "#d97706", 
        "#7c3aed", 
        "#0891b2", 
        "#be123c", 
        "#4d7c0f"
    ];

    // Returns index around palette length
    return colours[Math.abs(index) % colours.length];
}

function colourFor(i, depth = 0) {
    // Chooses colour for point
    const scheme = elColour?.value || "classic";
    // Current theme ink colour as default
    const ink = 
        getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || 
        "#000";

    // "classic" = normal text/ink from current theme
    if (scheme === "classic") return ink;
    // "escape" = shades points according to escape iteration
    if (scheme === "escape") {
        const e = escapeIters ? escapeIters[i] : null;

        // Fallback if escape data missing
        if (!Number.isFinite(e)) {
            return ink;
        }

        // Used for scaling escape iteration to greyscale value
        const maxIter = Math.max(1, parseNumber(elIterations?.value, 18));
        const t = clamp(e / maxIter, 0, 1);
        const v = Math.floor(25 + 230 * t);

        return `rgb(${v},${v},${v})`;
    }

    if (scheme === "depth") {
        // Colouring by depth/z-pos using greyscale gradient
        const t = clamp((depth + 1.8) / 3.6, 0, 1);
        const v = Math.floor(45 + 190 * t);

        return `rgb(${v},${v},${v})`;
    }

    if (scheme === "vertex") {
        // Used stored point metadata to choose a palette colour
        const m = pointMeta ? pointMeta[i] : null;

        return Number.isFinite(m) ? paletteColour(m) : ink;
    }

    // Fallback for unknown colour schemes
    return ink;
}

// Not used to regenerate the fractal -- see generate()
// Redraws existing points using current rotation, pan, colour scheme and point size
function draw() {
    resize();
    clear();
    visiblePointCount = 0;

    if (!points.length) {
        updateHUD();
        return;
    }

    const size = clamp(parseNumber(elPointSize?.value, 2), 1, 6);
    const settings = sliceSettings();

    const projected = [];
    for (let i = 0; i < points.length; i++) {
        if (!pointInSlice(points[i], settings)) continue;

        const [px, py, depth] = project(points[i]);
        // Skips points far outside canvas
        if (px < -10 || py < -10 || px > canvas.width + 10 || py > canvas.height + 10) continue;
        projected.push({ px, py, depth, index: i });
    }

    visiblePointCount = projected.length;
    projected.sort((a, b) => a.depth - b.depth);

    // Projects and draws each 3D point as a small circle
    for (const p of projected) {
        ctx.fillStyle = colourFor(p.index, p.depth);
        ctx.beginPath();
        ctx.arc(p.px, p.py, size, 0, Math.PI * 2);
        ctx.fill();
    }

    updateHUD();
}

// Function written to avoid NaN from float-point errors outside [-1, 1]
function safeAcos(x) {
    return Math.acos(Math.max(-1, Math.min(1, x)));
}

// Function sets chosen quality setting into a number of random sample points
function qualityDensity(q) {
    if (q === "low") return 12000;
    if (q === "high") return 60000;

    return 30000;
}

function genMandelbulb({ maxIter, power, density, bailout = 2}) {
    const pts = [];
    const esc = [];

    for (let i = 0; i < density; i++) {
        // Chaos Game: random starting point in a cube aroundthe origin
        const x0 = Math.random() * 3 - 1.5;
        const y0 = Math.random() * 3 - 1.5;
        const z0 = Math.random() * 3 - 1.5;

        let x = x0, y = y0, z = z0;
        let k = 0;

        // Iterates Mandelbulb formula
        for (; k < maxIter; k++) {
            const r = Math.sqrt(x * x + y * y + z * z);
            // Escapes if point too far away
            if (r > bailout) break;
            // Avoids unstable spherical coordinate calculations at the origin
            if (r < 1e-12) break;

            const theta = safeAcos(z / r);
            const phi = Math.atan2(y, x);

            const rn = Math.pow(r, power);
            const t = theta * power;
            const p = phi * power;

            // Spherical coordinates, then add original point
            x = rn * Math.sin(t) * Math.cos(p) + x0;
            y = rn * Math.sin(t) * Math.sin(p) + y0;
            z = rn * Math.cos(t) + z0;
        }

        // Stores original point and how long it survived
        pts.push([x0, y0, z0]);
        esc.push(k);
    }

    // Returns sampled points to be displayed
    return { pts, esc };
}

// Similar to Mandelbulb generator, but it doesn't add the original point each time,
// it adds fixed parameter c= = [cx, cy, cz]
function genJulia3D({ maxIter, power, density, c = [0.3, -0.2, 0.4], bailout = 2}) {
    const pts = [];
    const esc = [];

    for (let i = 0; i < density; i++) {
        // Chaos Game:  random starting point around the origin
        const x0 = Math.random() * 3 - 1.5;
        const y0 = Math.random() * 3 - 1.5;
        const z0 = Math.random() * 3 - 1.5;

        let k = 0;
        let x = x0, y = y0, z = z0;

        for (; k < maxIter; k++) {
            const r = Math.sqrt(x * x + y * y + z * z);
            // Escapes if point too far away
            if (r > bailout) break;
            // Avoids unstable spherical coordinate calculations at the origin
            if (r < 1e-12) break;

            const theta = safeAcos(z / r);
            const phi = Math.atan2(y, x);

            const rn = Math.pow(r, power);
            const t = theta * power;
            const p = phi * power;

            // Power map plus fixed c
            x = rn * Math.sin(t) * Math.cos(p) + c[0];
            y = rn * Math.sin(t) * Math.sin(p) + c[1];
            z = rn * Math.cos(t) + c[2];
        }

        // Stores original point and how long it survived
        pts.push([x0, y0, z0]);
        esc.push(k);
    }
    
    // Returns sampled points to be displayed
    return { pts, esc };
}

// Function to filter points by escape time
// If the filter removes everything, fallbackKeep reruns the function with a lower threshold
function filterByEscape({ pts, esc, keep, fallbackKeep = 0 }) {
    // keep = minimum number of iterations
    const filtered = [];
    const filteredEsc = [];
    const threshold = Math.max(0, keep);

    for (let i = 0; i < pts.length; i++) {
        if (threshold > 0 && esc[i] < threshold) continue;

        filtered.push(pts[i]);
        filteredEsc.push(esc[i]);
    }

    // If we keep some points, or no fallback needed, return the result
    if (filtered.length || fallbackKeep <= 0 || threshold <= fallbackKeep) {
        return { pts: filtered, esc: filteredEsc, keepUsed: threshold };
    }

    // Returns fallback threshold
    return filterByEscape({ 
        pts, 
        esc, 
        keep: fallbackKeep, 
        fallbackKeep: 0 
    });
}

function genSierpinski(count) {
    // V = vertices of tetrahedron
    const V = [
        [1, 1, 1],
        [-1, -1, 1],
        [-1, 1, -1],
        [1, -1, -1],
    ];

    // Starts from centre of shape
    let p = [0, 0, 0];
    const pts = new Array(count);

    for (let i = 0; i < count; i++) {
        // Chaos Game: picks one of the vertices at random
        const v = V[(Math.random() * 4) | 0];
        // Moves halfway from current point towards randomly chosen vertex
        p = [(p[0] + v[0]) / 2, (p[1] + v[1]) / 2, (p[2] + v[2]) / 2];
        // Stores a copy of the new point
        pts[i] = [p[0], p[1], p[2]];
    }

    // Returns generated point cloud
    return pts;
}

function polyhedronVertices(kind) {
    const phi = (1 + Math.sqrt(5)) / 2; // Golden ratio; for icosahedron

    if (kind === "cube") {
        // Cube verticles: all combos of x,y,z being -1 or 1
        return [-1, 1].flatMap((x) => 
            [-1, 1].flatMap((y) => 
                [-1, 1].map((z) => [x, y, z])
            )
        );
    }

    if (kind === "octa") {
        // Octahedron verticles lie on +ve/-ve coordinate axes
        return [
            [1, 0, 0], 
            [-1, 0, 0], 
            [0, 1, 0], 
            [0, -1, 0], 
            [0, 0, 1], 
            [0, 0, -1]
        ];
    }

    if (kind === "icosa") {
        // Standard icosahedron vertex coordintaes before scaling
        const raw = [
            [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
            [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
            [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
        ];

        // Normalises each vertex onto a sphere; scaled slightly
        return raw.map(([x, y, z]) => {
            const r = Math.hypot(x, y, z);

            return [x / r * 1.25, y / r * 1.25, z / r * 1.25];
        });
    }

    // Default: tetrahedron vertices
    return [
        [1, 1, 1],
        [-1, -1, 1],
        [-1, 1, -1],
        [1, -1, -1],
    ];
}

function isOppositeVertex(a, b, vertices) {
    // Invalid previous/current indices cannot be opposite
    if (a < 0 || b < 0) return false;

    const va = vertices[a];
    const vb = vertices[b];

    // Vertices opposite if every coordinate negated
    return va && vb && va[0] === -vb[0] && va[1] === -vb[1] && va[2] === -vb[2];
}

function chooseVertex(vertices, lastIndex, rule) {
    // Chaos Game: pick random candidate vertex
    let next = (Math.random() * vertices.length) | 0;
    let guard = 0;  // Initialised to prevent infinite loops if rule is too restrictive

    while (
        guard < 32 &&
        (
            // Avoids choosing same vertex twice in a row
            (rule === "noRepeat" && next === lastIndex) ||

            // Avoids jumping to opposite vertex
            (rule === "noOpposite" && isOppositeVertex(next, lastIndex, vertices))
        )
    ) {
        // Tries anotehr random vertex candidate
        next = (Math.random() * vertices.length) | 0;
        guard++;    // Counts retry s.t. guard limit can stop loop if needed
    }

    return next;
}

// 3D Chaos Game cloud using vertices of selected polyhedron
function genPolyhedronChaos({ preset, count, lambda, rule }) {
    // Get vertex set for selected polyhedron
    const vertices = polyhedronVertices(preset);

    // Preallocates point and metadata arrays for speed
    const pts = new Array(count);
    const meta = new Array(count);

    let p = [0, 0, 0];  // Starts chaos game at the origin
    let lastIndex = -1; // Tracks previous vertex for rules, e.g. noRepeat, noOpposite

    for (let i = 0; i < count; i++) {
        // Chooses next target vertex
        const index = chooseVertex(vertices, lastIndex, rule);
        const v = vertices[index];

        // Moves lambda of the way from current point to chosen vertex
        p = [
            p[0] + (v[0] - p[0]) * lambda,
            p[1] + (v[1] - p[1]) * lambda,
            p[2] + (v[2] - p[2]) * lambda,
        ];

        // Stores new point an dvertex index used to create it
        pts[i] = [p[0], p[1], p[2]];
        meta[i] = index;

        lastIndex = index;
    }

    return { pts, meta };
}

function pickWeightedMap(maps) {
    const r = Math.random();    // Random number in [0, 1); used to choose by cumulative probability
    // Accumulates probabilities as we scan through the maps
    let acc = 0;

    for (let i = 0; i < maps.length; i++) {
        // Adds map probability to cumulative total
        acc += maps[i].p;
        
        // First cumulative probability exceeding r wins
        if (r <= acc) return i;
    }

    // Fallback if probabilities do not sum to 1 exactly
    return maps.length - 1;
}

function applyAffineMap(map, [x, y, z]) {
    const a = map.a;

    return [
        // Applies affine transformation A x + b
        a[0][0] * x + a[0][1] * y + a[0][2] * z + map.b[0],
        a[1][0] * x + a[1][1] * y + a[1][2] * z + map.b[1],
        a[2][0] * x + a[2][1] * y + a[2][2] * z + map.b[2],
    ];
}

function affineMaps(kind) {
    if (kind === "tree3d") {
        return [
            { p: 0.42, a: [[0.55, -0.10, 0.08], [0.12, 0.62, 0.04], [-0.06, 0.02, 0.58]], b: [0.00, 0.42, 0.02] },
            { p: 0.25, a: [[0.36, -0.36, 0.10], [0.40, 0.38, 0.06], [0.02, 0.08, 0.46]], b: [-0.18, 0.46, 0.12] },
            { p: 0.25, a: [[0.36, 0.34, -0.08], [-0.38, 0.36, 0.06], [0.04, -0.04, 0.46]], b: [0.18, 0.46, -0.10] },
            { p: 0.08, a: [[0.18, 0, 0], [0, 0.28, 0], [0, 0, 0.18]], b: [0.00, 0.08, 0.00] },
        ];
    }

    // Default: 3D fern-ish affine IFS
    return [
        { p: 0.01, a: [[0, 0, 0], [0, 0.16, 0], [0, 0, 0.05]], b: [0, -1.05, 0] },
        { p: 0.84, a: [[0.85, 0.04, 0.02], [-0.04, 0.85, 0.04], [0.02, -0.02, 0.72]], b: [0, 0.26, 0.02] },
        { p: 0.07, a: [[0.20, -0.26, 0.10], [0.23, 0.22, 0.04], [-0.04, 0.08, 0.30]], b: [0, 0.05, 0.18] },
        { p: 0.08, a: [[-0.15, 0.28, -0.08], [0.26, 0.24, 0.05], [0.06, -0.05, 0.28]], b: [0, 0.04, -0.18] },
    ];
}

function normalisePointCloud(pts) {
    // If empty, no need to normalise
    if (!pts.length) return pts;

    // Minimum and maximum values in x, y, z to be narrowed down
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (const p of pts) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], p[k]);
            max[k] = Math.max(max[k], p[k]);
        }
    }

    // Centre of bounding box
    const centre = [
        (min[0] + max[0]) / 2, 
        (min[1] + max[1]) / 2, 
        (min[2] + max[2]) / 2
    ];
    // Largest side of bounding box
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;

    // Centers cloud and scales it consistent with display size
    return pts.map(([x, y, z]) => [
        ((x - centre[0]) / span) * 2.4,
        ((y - centre[1]) / span) * 2.4,
        ((z - centre[2]) / span) * 2.4,
    ]);
}

function genAffineIFS({ preset, count }) {
    const maps = affineMaps(preset);        // Get affine maps from IFS preset
    
    const pts = [];
    const meta = [];
    
    let p = [0, 0, 0];  // Starts iteration at origin
    const burnIn = 30;  // Ignores early points while orbit settles on attractor

    for (let i = 0; i < count + burnIn; i++) {
        // Chooses map according to its probability
        const index = pickWeightedMap(maps);

        // Applies chosen affine map to current point
        p = applyAffineMap(maps[index], p);

        if (i >= burnIn) {
            // Stores point after burn-in
            pts.push([p[0], p[1], p[2]]);

            // Stores chosen map index; used for optional colouring
            meta.push(index);
        }
    }

    // Normalises points s.t. different IFS presets fit in same view
    return { pts: normalisePointCloud(pts), meta };
}

function genMenger(level, centre = [0, 0, 0], size = 1) {
    // base case: one point
    if (level <= 0) return [centre];

    const out = [];
    const step = size / 3;
    
    // Splits cube into 3 x 3 x 3 grid and removes centre cube of each face
    // Removed cubes have at least two coordinates = 0
    for (const dx of [-1, 0, 1])
        for (const dy of [-1, 0, 1])
            for (const dz of [-1, 0, 1]) {
                const zeros = (dx === 0) + (dy === 0) + (dz === 0);
                // Skips removed cubes
                if (zeros >= 2) continue;

                out.push(
                    ...genMenger(
                        level - 1,
                        [
                            centre[0] + dx  * step, 
                            centre[1] + dy * step, 
                            centre[2] + dz * step
                        ],
                        step
                    )
                );
            }
    
    // Returns point-based Menger sponge
    return out;
}

function setControlValue(el, value) {
    if (!el) return;
    // Stores control values as strings; format for form inputs
    el.value = String(value);
}

function applyBulbPreset() {
    // Reads selected preset name
    const preset = elBulbPreset?.value || "custom";
    // Leaves current custom controls unchanged for custom mode
    if (preset === "custom") return;

    // Preset parameter bundles for common 3D bulb/Julia views
    const presets = {
        classic8: { fractal: "mandelbulb", iter: 18, power: 8, keep: 12, c: [0.30, -0.20, 0.40] },
        power5: { fractal: "mandelbulb", iter: 24, power: 5, keep: 15, c: [0.30, -0.20, 0.40] },
        power9: { fractal: "mandelbulb", iter: 20, power: 9, keep: 13, c: [0.30, -0.20, 0.40] },
        softJulia: { fractal: "julia3d", iter: 24, power: 6, keep: 11, c: [0.18, -0.32, 0.38] },
        spikeJulia: { fractal: "julia3d", iter: 30, power: 8, keep: 17, c: [-0.12, 0.54, -0.28] },
    };

    const p = presets[preset];  // Looks up chosen preset
    if (!p) return;

    // Copies preset values to UI controls
    setControlValue(elFractal, p.fractal);
    setControlValue(elIterations, p.iter);
    setControlValue(elBulbPower, p.power);
    setControlValue(elKeepThreshold, p.keep);
    setControlValue(elJuliaCx, p.c[0]);
    setControlValue(elJuliaCy, p.c[1]);
    setControlValue(elJuliaCz, p.c[2]);

    // REfreshes Julia constant display after changing c
    updateJuliaReadout();
}

// Function switche sbetweeen escape-fractal controls and IFS controls
function setActiveTab(tab) {
    activeTab = tab;                // Stores active tab globally
    const isIFS = tab === "ifs";    // IFS uses different controls from Mandelbulb/Julia escape rendering

    // Updates tab acessibility state
    if (tabEscape) tabEscape.setAttribute("aria-selected", String(!isIFS));
    if (tabIFS) tabIFS.setAttribute("aria-selected", String(isIFS));

    // Shows controls belonging to selected tab
    if (escapeControls) escapeControls.hidden = isIFS;
    if (ifsControls) ifsControls.hidden = !isIFS;

    generate(); // Regenerates point cloud for newly selected tab
}

// Generates 3D fractal chosen and redraws
function generate() {
    // Escape-fractal controls:
    const type = elFractal?.value || "mandelbulb";
    const maxIter = clamp(parseNumber(elIterations?.value, 18), 1, 200);
    const density = qualityDensity(elQuality?.value || "medium");
    const power = clamp(parseNumber(elBulbPower?.value, 8), 2, 12);
    const keep = clamp(parseNumber(elKeepThreshold?.value, 12), 0, 9999);

    setStatus("Generating...");
    pointMeta = null;       // Clears metadata before generating new point set

    if (activeTab === "ifs") {
        // Reads selected IFS preset
        const preset = elIfsPreset?.value || "tetra";
        // Calculates how many points to generate using quality and iteration count
        const count = clamp(density + maxIter * 500, 5000, 180000);

        if (preset === "fern3d" || preset === "tree3d") {
            // Fern/tree presets using weighted affine maps
            const generated = genAffineIFS({ preset, count });

            points = generated.pts;
            pointMeta = generated.meta;
            escapeIters = null;
        } else {
            // 3D Chaos Game: Polyhedron presets
            const generated = genPolyhedronChaos({
                preset,
                count,
                lambda: clamp(parseNumber(elIfsLambda?.value, 0.5), 0.05, 0.95),
                rule: elIfsRule?.value || "none",
            });

            points = generated.pts;
            pointMeta = generated.meta;
            escapeIters = null;
        }

        // IFS generation finished
        setStatus(`Ready | ${points.length.toLocaleString()} pts`);
        draw();     // Redraws

        return;
    }

    if (type === "mandelbulb") {
        // Generates candidate Julia points and escape iteration data
        const { pts, esc } = genMandelbulb({ maxIter, power, density });
        // 'filtered' keeps points according to escape threshold
        const filtered = filterByEscape({ 
            pts, esc, keep, 
            fallbackKeep: Math.max(1, Math.floor(maxIter * 0.35)) 
        });

        points = filtered.pts;
        escapeIters = filtered.esc;
    }

    if (type === "julia3d") {
        // Updates Julia constant c
        const c = updateJuliaReadout();

        // Generates candidate Julia points and escape iteration data
        const { pts, esc } = genJulia3D({ maxIter, power, density, c });
        // 'filtered' keeps points according to escape threshold
        const filtered = filterByEscape({ 
            pts, esc, keep, 
            fallbackKeep: Math.max(1, Math.floor(maxIter * 0.35)) 
        });

        points = filtered.pts;
        escapeIters = filtered.esc;
    }

    if (type === "sierpinski") {
        // Generates 3D Sierpinski-style point cloud
        const count = clamp(maxIter * 700, 3000, 250000);
        points = genSierpinski(count);
        escapeIters = null;
    }

    if (type === "menger") {
        // Higher iteration values -> deeper Menger level
        const level = clamp(Math.round(maxIter / 12), 0, 4);
        points = genMenger(level);
        escapeIters = null;
    }

    // Shows final point count
    setStatus(`Ready | ${points.length.toLocaleString()} pts`);
    draw();     // redraws canvas
}

function fitSlope(xs, ys) {
    const n = xs.length;    // Number of data points used in linear fit
    // Requires at least two points to define a slope
    if (n < 2) return NaN;

    // Running sums for least-squares regression
    let sx = 0, sy = 0, sxx = 0, sxy = 0;

    for (let i = 0; i < n; i++) {
        // Sum x-values and y-values
        sx += xs[i];
        sy += ys[i];

        // Sum x^2 and xy terms
        sxx += xs[i] * xs[i];
        sxy += xs[i] * ys[i];
    }

    // Denominator of least-squares slope formula
    const denom = n * sxx - sx * sx;
    // Returns NaN if x-values have no variation
    return denom === 0 
        ? NaN 
        : (n * sxy - sx * sy) / denom;
}

function pointBounds(sample) {
    // Minimum and maximum coordinates in x, y, z to narrow down
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (const p of sample) {
        for (let k = 0; k < 3; k++) {
            // Expands bounds to include this point
            min[k] = Math.min(min[k], p[k]);
            max[k] = Math.max(max[k], p[k]);
        }
    }

    // Uses largest side length as common scale
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    
    return { min, span };
}

function currentAnalysisPoints() {
    const settings = sliceSettings();   // currently active slice settings
    
    // Slicing off => analysing all points
    // Otherwise, analyse only visible slice points
    return settings.axis < 0 
        ? points 
        : points.filter((p) => pointInSlice(p, settings));
}

function samplePoints(maxCount) {
    // Starts from points currently available for analysis
    const source = currentAnalysisPoints();
    // If already few enough points, copy and return them
    if (source.length <= maxCount) {
        return source.slice();
    }

    const sample = [];
    // Evently step through point cloud to get representative subset
    const step = source.length / maxCount;
    
    for (let i = 0; i < maxCount; i++) {
        sample.push(source[Math.floor(i * step)]);
    }

    return sample;
}

function logSpacedIntegers(minValue, maxValue, count) {
    const out = [];

    // Works in log-space s.t. sizes multiplicatively spaced
    const a = Math.log(minValue);
    const b = Math.log(maxValue);

    for (let k = 0; k < count; k++) {
        // Interpolation parameter from 0 to 1
        const t = k / Math.max(1, count - 1);
        // Converts log-spaced value -> integer
        const value = Math.round(Math.exp(a + (b - a) * t));

        // Prevents duplicate sizes after rounding
        if (!out.length || value !== out[out.length - 1]) out.push(value);
    }

    return out;
}

function estimateBoxDimension3D() {
    // Requires points to estimtae dimension
    if (!points.length) return null;

    // Clamps box-counting settings from UI
    const gridMax = clamp(parseNumber(elDimDown?.value, 768), 128, 2048);
    const grid = clamp(Math.round(gridMax / 8), 24, 192);
    const samples = clamp(parseNumber(elDimSamples?.value, 12), 6, 24);
    const minBox = clamp(parseNumber(elDimMinBox?.value, 2), 1, 64);
    const maxBox = clamp(parseNumber(elDimMaxBox?.value, 256), 4, grid);
    
    // Downsamples large point clouds for performance
    const cloud = samplePoints(80000);

    // Too few points gives an unreliable estimate
    if (cloud.length < 8) return null;

    // Gets point cloud bounds for mapping points to grif
    const { min, span } = pointBounds(cloud);
    // Chooses log spaced box sizes
    const sizes = logSpacedIntegers(minBox, maxBox, samples).filter((s) => s <= grid);
    
    const xs = [];
    const ys = [];

    for (const box of sizes) {
        // Stores unique occupied boxes at this scale
        const occupied = new Set();

        for (const p of cloud) {
            // Converts point to integer grid coordinates
            const ix = clamp(Math.floor(((p[0] - min[0]) / span) * grid), 0, grid - 1);
            const iy = clamp(Math.floor(((p[1] - min[1]) / span) * grid), 0, grid - 1);
            const iz = clamp(Math.floor(((p[2] - min[2]) / span) * grid), 0, grid - 1);
            
            // Collapses grid coordinates to coarser box index
            occupied.add(`${Math.floor(ix / box)},${Math.floor(iy / box)},${Math.floor(iz / box)}`);
        }

        const eps = box / grid;     // relative box side length
        // Box dimension is slope of log(N(Îµ)) vs log(1/Îµ)
        xs.push(Math.log(1 / eps));
        ys.push(Math.log(Math.max(1, occupied.size)));
    }

    return { 
        D: fitSlope(xs, ys), 
        sizes, 
        N: grid, 
        sampleCount: cloud.length 
    };
}

function estimateCorrelationDimension3D() {
    // Require poitns to estiamte dimension
    if (!points.length) return null;

    // Correlation pairwise, so use smaller sample for speed
    const cloud = samplePoints(1800);
    // Too few points gives unreliable estimate
    if (cloud.length < 8) return null;

    const { span } = pointBounds(cloud);
    // Reads number of radius samples from UI
    const samples = clamp(parseNumber(elDimSamples?.value, 12), 6, 18);
    const radii = [];

    // Smallest and largest radii as fractions of cloud scale
    const minR = span * 0.015;
    const maxR = span * 0.45;

    for (let i = 0; i < samples; i++) {
        // Log-space interpolation between minR and maxR
        const t = i / Math.max(1, samples - 1);
        radii.push(Math.exp(Math.log(minR) + (Math.log(maxR) - Math.log(minR)) * t));
    }

    // counts[r] stores how many point pairs are within radii[r]
    const counts = new Array(radii.length).fill(0);
    let pairs = 0;

    for (let i = 0; i < cloud.length; i++) {
        const a = cloud[i];

        for (let j = i + 1; j < cloud.length; j++) {
            const b = cloud[j];

            // Euclidean distance between two 3D points
            const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
            
            pairs++;

            // Counts pair for every radius containing it
            for (let r = 0; r < radii.length; r++) {
                if (d <= radii[r]) counts[r]++;
            }
        }
    }

    const xs = [];
    const ys = [];

    for (let i = 0; i < radii.length; i++) {
        // Correlation sum: proportion of pairs within radius
        const c = counts[i] / Math.max(1, pairs);
        
        if (c > 0) {
            // Correlation dimension is slope of log (C(r)) vs log(r)
            xs.push(Math.log(radii[i]));
            ys.push(Math.log(c));
        }
    }

    return { D: fitSlope(xs, ys), sizes: radii, N: cloud.length, sampleCount: cloud.length };
}

function estimateDimension() {
    // Chooses estimator from UI
    const mode = elDimMode?.value || "box3d";

    const result = mode === "correlation3d"
        ? estimateCorrelationDimension3D()
        : estimateBoxDimension3D();

    // Attaches mode to result
    return result ? { ...result, mode } : null;
}

// Mouse event -> canvas pixel coordinates:
function clientToCanvasPx(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
}

function bindInteraction() {
    // Prevents browser right-click meny appearing over the canvas
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);

        dragging = true;
        last = { x: e.clientX, y: e.clientY };

        // Holding down shift key switches between rotate mode and pan mode
        dragMode = e.shiftKey ? "pan" : "rotate";
    });

    canvas.addEventListener("pointerup", () => (dragging = false));
    canvas.addEventListener("pointercancel", () => (dragging = false));

    canvas.addEventListener("pointermove", (e) => {
        updateHUD(clientToCanvasPx(e));

        if (!dragging) return;

        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };

        if (dragMode === "pan") {
            // Pan in screen pixels
            const rect = canvas.getBoundingClientRect();
            offsetX += dx * (canvas.width / rect.width);
            offsetY += dy * (canvas.height / rect.height);
        } else {
            // Rotates object based on mouse movement
            const s = 0.01;
            angleY += dx * s;
            angleX += dy * s;
        }

        draw();
    });

    // Mouse wheel zoom
    canvas.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();

            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            zoom = clamp(zoom * factor, 0.05, 20);

            draw();
        },
        { passive: false }
    );

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space") {
            toggleSpin();
            e.preventDefault();
        }
        if (e.key === "+" || e.key === "=") {
            zoom = clamp(zoom * 1.12, 0.05, 20);
            draw();

            e.preventDefault();
        }
        if (e.key === "-" || e.key === "_") {
            zoom = clamp(zoom / 1.12, 0.05, 20);
            draw();

            e.preventDefault();
        }
    });
}

// Spinning function: one frame of auto-spin animation
function spinTick() {
    if (!spinning) return;

    // Rotation speed comes from UI in deg/s
    const degPerSec = clamp(parseNumber(elRotationSpeed?.value, 30), 0, 720);
    const radPerFrame = (degPerSec * Math.PI) / 180 / 60;

    angleY += radPerFrame;
    draw();

    spinRAF = requestAnimationFrame(spinTick);
}

// Toggles auto-spin on/off
function toggleSpin() {
    spinning = !spinning;

    if (spinning) {
        setStatus("Spin: on");
        spinTick();
    } else {
        if (spinRAF) {
            cancelAnimationFrame(spinRAF);
        }

        spinRAF = null;
        setStatus("Spin: off");
    }
}

// Resets view rotation, zoom and pan
function resetView() {
    angleX = Math.PI / 6;
    angleY = Math.PI / 6;
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    
    draw();
}

// Sets active slice plane and/or slice value, and redraws
function setSlice({ plane = null, value = null } = {}) {
    // Updates selected sliec plane if new one was provided
    if (plane !== null && elSlicePlane) {
        elSlicePlane.value = plane;
    }

    if (value !== null) {
        // Clamps slice position to valid view range
        const v = clamp(parseNumber(value, 0.1), -1.5, 1.5);

        // Keeps input and slider in sync
        if (elSliceValue) elSliceValue.value = v.toFixed(2);
        if (elSliceSlider) elSliceSlider.value = String(v);
    }

    draw();
}

// Moves current slice forwards or backwards by small step
function stepSlice(direction) {
    const current = parseNumber(elSliceValue?.value, 0.1);                      // Reads slice value from UI
    const step = Math.max(0.01, parseNumber(elSliceSlider?.step, 0.01) * 10);   // Uses ten slider steps at a time
    
    // Applies moved slice value
    setSlice({ value: current + direction * step });
}

// Function to connect all buttons, sliders and inputs to their individual code
function bindUI() {
    btnRender.addEventListener("click", generate);
    btnReset.addEventListener("click", resetView);
    btnSpin.addEventListener("click", toggleSpin);
    btnExport.addEventListener("click", () => {
        exportCanvasPNG(canvas, "3d-fractal.png");
    });
    
    // Manual zoom input
    elZoomInput.addEventListener("input", () => {
        const z = parseNumber(elZoomInput.value, zoom);
        zoom = clamp(z, 0.05, 20);

        draw();
    });

    // Using draw() since it is only display changes
    elPointSize.addEventListener("input", draw);
    elColour.addEventListener("change", draw);

    // Redraws when slice plane changes
    if (elSlicePlane) elSlicePlane.addEventListener("change", draw);
    // Redraws when slice thickness changes
    if (elSliceThickness) elSliceThickness.addEventListener("input", draw);
    
    if (elSliceValue) {
        // Keeps slider sunced with input
        elSliceValue.addEventListener("input", () => {
            if (elSliceSlider) {
                elSliceSlider.value = elSliceValue.value;
            }

            draw();
        });
    }

    if (elSliceSlider) {
        elSliceSlider.addEventListener("input", () => {
            // Keeps input synced with slider
            if (elSliceValue) {
                elSliceValue.value = parseNumber(elSliceSlider.value, 0.1).toFixed(2);
            }

            draw();
        });
    }

    // Slice navigation buttons
    if (btnSlicePrev) btnSlicePrev.addEventListener("click", () => stepSlice(-1));
    if (btnSliceNext) btnSliceNext.addEventListener("click", () => stepSlice(1));
    
    // Quick slice presets through XY plane
    if (btnSlicePreset01) btnSlicePreset01.addEventListener("click", () => setSlice({ plane: "xy", value: 0.1 }));
    if (btnSlicePreset02) btnSlicePreset02.addEventListener("click", () => setSlice({ plane: "xy", value: 0.2 }));
    if (btnSlicePreset03) btnSlicePreset03.addEventListener("click", () => setSlice({ plane: "xy", value: 0.3 }));
    
    // Turns sliciing off
    if (btnSliceOff) btnSliceOff.addEventListener("click", () => setSlice({ plane: "off" }));

    // Tab switching:
    if (tabEscape) tabEscape.addEventListener("click", () => setActiveTab("escape"));
    if (tabIFS) tabIFS.addEventListener("click", () => setActiveTab("ifs"));
    
    if (elBulbPreset) {
        elBulbPreset.addEventListener("change", () => {
            // Selected Mandelbulb/Julia preset
            applyBulbPreset();
            setActiveTab("escape"); // Switches to escape mode
        });
    }

    // IFS controls change generated point cloud
    [elIfsPreset, elIfsLambda, elIfsRule].forEach((el) => {
        if (el) el.addEventListener("change", generate);
    });

    // Controls change generated escpae-fractal point cloud
    elFractal.addEventListener("change", generate);
    elIterations.addEventListener("change", generate);
    elQuality.addEventListener("change", generate);
    elBulbPower.addEventListener("change", generate);
    elKeepThreshold.addEventListener("change", generate);

    // Julia parameter inputs
    [elJuliaCx, elJuliaCy, elJuliaCz].forEach((el) => {
        el.addEventListener("input", () => {
            updateJuliaReadout();
            // Only regenerates if current fractal is 3D Julia
            if (elFractal.value === "julia3d") generate();
        });
    });

    // Dimension button:
    if (btnDim) {
        btnDim.addEventListener("click", () => {
            // Runs currently selected dimension estimator
            const res = estimateDimension();

            if (!res || !Number.isFinite(res.D)) {
                // Fallback text if estimate fails
                if (elDimValue) elDimValue.textContent = "D approx -";
                if (elDimMeta) elDimMeta.textContent = "-";

                return;
            }

            if (elDimValue) {
                // Displayed estimated dimension
                elDimValue.textContent = `D approx ${res.D.toFixed(4)}`;
            }

            if (elDimMeta) {
                // Readable label for chosen estimator 
                const label = res.mode === "correlation3d"
                    ? "3D correlation"
                    : "3D box";
                
                // Extra estimator details; used for debugging/comparing
                const detail = res.mode === "correlation3d"
                    ? `sample=${res.sampleCount}`
                    : `N=${res.N}, boxes=${res.sizes.join(",")}`;
                
                elDimMeta.textContent = `${label} | ${detail}`;
            }
        });
    }

    // Redraws on browser resize s.t. canvas is sharp and centred
    window.addEventListener("resize", () => draw());
}

function init() {
    resize();

    // Reuses shared HUD conventions
    view2d = new View2D({
        canvas,
        zoomIndicatorEl,
        mouseCoordsEl,
        initial: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },

        // Direct interaction disabled; page has custom 3D rotation/pan/zoom controls
        enableWheelZoom: false,
        enableDragPan: false,
        enableRightClickZoom: false,
        enableClickZoom: false,
        
        onChange: null,
    });

    updateJuliaReadout();
    bindInteraction();
    bindUI();
    generate();
    setStatus("Ready");
}

init();     // Starts page
