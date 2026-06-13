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
const elIterations = qs("#iterationsInput");
const elQuality = qs("#renderQuality");
const elBulbPower = qs("#bulbPower");
const elKeepThreshold = qs("#keepThreshold");

const elJuliaCx = qs("#juliaCx");
const elJuliaCy = qs("#juliaCy");
const elJuliaCz = qs("#juliaCz");
const elJuliaReadout = qs("#juliaReadout");

const elPointSize = qs("#pointSize");
const elColour = qs("#colorScheme");
const elRotationSpeed = qs("#rotationSpeed");
const elZoomInput = qs("#zoomLevel");

const btnRender = qs("#renderBtn");
const btnReset = qs("#resetViewBtn");
const btnSpin = qs("#toggleSpinBtn");
const btnExport = qs("#exportImageBtn");

const btnDim = qs("#dimRunBtn");
const elDimValue = qs("#dimValue");
const elDimMeta = qs("#dimMeta");
const elDimDown = qs("#dimDownsample");
const elDimSamples = qs("#dimSamples");
const elDimMinBox = qs("#dimMinBox");
const elDimMaxBox = qs("#dimMaxBox");

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

let dragging = false;
let dragMode = "rotate";    // rotate | pan
let last = { x: 0, y: 0 };

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

// Function to update page HUD
function updateHUD(mousePx = null) {
    if (zoomIndicatorEl) zoomIndicatorEl.textContent = `Zoom: ${zoom.toFixed(2)}x`;
    if (extraIndicator) extraIndicator.textContent = `pts: ${points.length.toLocaleString()}`;

    if (elZoomInput && document.activeElement !== elZoomInput) {
        elZoomInput.value = String(Math.round(zoom * 100) / 100);
    }
    if (mouseCoordsEl && mousePx) {
        mouseCoordsEl.textContent = `X: ${mousePx.x.toFixed(1)}, Y: ${mousePx.y.toFixed(1)}`;
    }
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

function colourFor(i) {
    // Chooses colour for point
    const scheme = elColour?.value || "classic";
    const ink = 
        getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || 
        "#000";

    // "classic" means normal text/ink from current theme
    if (scheme === "classic") return ink;
    // "escape" means shades points according to escape iteration
    if (scheme === "escape") {
        const e = escapeIters ? escapeIters[i] : null;

        if (!Number.isFinite(e)) {
            return ink;
        }

        const maxIter = Math.max(1, parseNumber(elIterations?.value, 18));
        const t = clamp(e / maxIter, 0, 1);
        const v = Math.floor(25 + 230 * t);

        return `rgb(${v},${v},${v})`;
    }

    return ink;
}

// Not used to regenerate the fractal -- see generate()
// Redraws existing points using current rotation, pan, colour scheme and point size
function draw() {
    resize();
    clear();

    if (!points.length) {
        updateHUD();
        return;
    }

    const size = clamp(parseNumber(elPointSize?.value, 2), 1, 6);

    // Projects and draws each 3D point as a small circle
    for (let i = 0; i < points.length; i++) {
        const [px, py] = project(points[i]);
        // Skips points far outside canvas
        if (px < -10 || py < -10 || px > canvas.width + 10 || py > canvas.height + 10) continue;

        ctx.fillStyle = colourFor(i);
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
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

// Generates 3D fractal chosen and redraws
function generate() {
    const type = elFractal?.value || "mandelbulb";
    const maxIter = clamp(parseNumber(elIterations?.value, 18), 1, 200);
    const density = qualityDensity(elQuality?.value || "medium");
    const power = clamp(parseNumber(elBulbPower?.value, 8), 2, 12);
    const keep = clamp(parseNumber(elKeepThreshold?.value, 12), 0, 9999);

    setStatus("Generating...");

    if (type === "mandelbulb") {
        const { pts, esc } = genMandelbulb({ maxIter, power, density });
        const filtered = filterByEscape({ pts, esc, keep, fallbackKeep: Math.max(1, Math.floor(maxIter * 0.35)) });

        points = filtered.pts;
        escapeIters = filtered.esc;
    }

    if (type === "julia3d") {
        const c = updateJuliaReadout();
        const { pts, esc } = genJulia3D({ maxIter, power, density, c });
        const filtered = filterByEscape({ pts, esc, keep, fallbackKeep: Math.max(1, Math.floor(maxIter * 0.35)) });

        points = filtered.pts;
        escapeIters = filtered.esc;
    }

    if (type === "sierpinski") {
        const count = clamp(maxIter * 700, 3000, 250000);
        points = genSierpinski(count);
        escapeIters = null;
    }

    if (type === "menger") {
        // Higher iteration vlaues -> deeper Menger level
        const level = clamp(Math.round(maxIter / 12), 0, 4);
        points = genMenger(level);
        escapeIters = null;
    }

    setStatus(`Ready | ${points.length.toLocaleString()} pts`);
    draw();
}

function estimateProjectedDimension() {
    if (!points.length) return null;

    const N = clamp(parseNumber(elDimDown?.value, 768), 128, 2048);
    const minBox = clamp(parseNumber(elDimMinBox?.value, 2), 1, 256);
    const maxBox = clamp(parseNumber(elDimMaxBox?.value, 256), 2, 2048);
    const samples = clamp(parseNumber(elDimSamples?.value, 12), 6, 24);

    const mask = new Uint8Array(N * N);     // Binary mask of projected point cloud

    // Projects each 3D point to current 2D canvas view
    for (let i = 0; i < points.length; i++) {
        // project() applies current rotation, zoom and pan
        // returns current point position on the canvas
        const [px, py] = project(points[i]);

        // canvas pixel (x,y) -> position on N x N mask
        const x = Math.floor((px / canvas.width) * N);
        const y = Math.floor((py / canvas.height) * N);

        // Ensures only marks point if it is inside the mask
        // Point outside the canvas are ignored
        if (x >= 0 && x < N && y >= 0 && y < N) {
            // 1 means at least one projected fractal point here
            mask[y * N + x] = 1;
        }
    }

    // Chooses logarithmically-spaced box sizes; works better with dimension estimation
    const sizes = [];
    const a = Math.log(minBox);
    const b = Math.log(maxBox);

    for (let k = 0; k < samples; k++) {
        const t = k / (samples - 1);
        const s = Math.round(Math.exp(a + (b - a) * t));

        if (!sizes.length || s !== sizes[sizes.length - 1]) {
            sizes.push(s);
        }
    }

    const xs = [];
    const ys = [];
    
    // For each box size, counts how many boxes contain at lest one projected point
    for (const box of sizes) {
        const bx = Math.ceil(N / box);
        const by = Math.ceil(N / box);

        let count = 0;

        for (let j = 0; j < by; j++) {
            for (let i = 0; i < bx; i++) {
                let hit = false;

                const x0 = i * box;
                const y0 = j * box;
                const x1 = Math.min(N, x0 + box);
                const y1 = Math.min(N, y0 + box);

                // Checks if box contains any occupied mask pixel
                for (let yy = y0; yy < y1 && !hit; yy++) {
                    const row = yy * N;
                    
                    for (let xx = x0; xx < x1; xx++) {
                        if (mask[row + xx]) { hit = true; break; }
                    }
                }

                if (hit) {
                    count++;
                }
            }
        }

        // Box-counting: N(ε) vs ε, where ε ~ box/N
        const eps = box / N;
        xs.push(Math.log(1 / eps));
        ys.push(Math.log(Math.max(1, count)));
    }

    // See logFit helper -- same method, just written locally
    // least-squares calculation
    const n = xs.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;

    for (let i = 0; i < n; i++) {
        sx += xs[i];
        sy += ys[i];
        sxx += xs[i] * xs[i];
        sxy += xs[i] * ys[i];
    }

    const denom = n * sxx - sx * sx;
    const slope = denom === 0 
        ? NaN 
        : (n * sxy - sx * sy) / denom;

    return { D: slope, sizes, N };
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

    // Using generate() since it's changing the generated point cloud
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
            const res = estimateProjectedDimension();

            if (!res || !Number.isFinite(res.D)) {
                if (elDimValue) elDimValue.textContent = "D approx -";
                if (elDimMeta) elDimMeta.textContent = "-";
                return;
            }

            if (elDimValue) elDimValue.textContent = `D approx ${res.D.toFixed(4)}`;
            if (elDimMeta) elDimMeta.textContent = `N=${res.N}, boxes=${res.sizes.join(",")}`;
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