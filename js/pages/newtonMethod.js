// js/pages/newtonMethod.js:
import { exportCanvasPNG } from "../shared/exportMedia.js";
import { DimensionLab, canvasToMask, boundaryFromClasses } from "../shared/dimension/index.js";
import { typesetMath } from "../shared/mathjax.js";

// File draws the basins of attraction for Newton's method applied to f(z) = z**3 + (k-1)z - k
// Each pixel trated as starting value z0, and we iterate Newton's method, see which root it converges to
// and colour the pixel according to the root and speed of convergence

const canvas = document.getElementById("newtonCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

// Animation states
let animationId = null;
let isPlaying = false;
let drawGrid = false;
// Recording states
let mediaRecorder;
let recordedChunks = [];

// UI elements
const coordDisplay = document.getElementById("mouse-coords");
const zoomEl = document.getElementById("zoom-indicator");
const kReadout = document.getElementById("kReadout");

const iterationsInput = document.getElementById("newtonIterations");
const resolutionInput = document.getElementById("newtonResolution");
const kRealInput = document.getElementById("kReal");
const kImagInput = document.getElementById("kImag");

const drawBtn = document.getElementById("drawNewton");
const clearBtn = document.getElementById("clearNewton");
const exportBtn = document.getElementById("exportNewton");
const resetViewBtn = document.getElementById("resetViewNewton");
const toggleGridBtn = document.getElementById("toggleGridNewton");
const toggleAnimBtn = document.getElementById("toggleAnimationNewton");
const startRecBtn = document.getElementById("startRecordingNewton");
const stopRecBtn = document.getElementById("stopRecordingNewton");
const applyRangeBtn = document.getElementById("applyRangeNewton");

// Dimension UI
const dimSourceEl = document.getElementById("dimSource");
const dimDownsampleEl = document.getElementById("dimDownsample");
const dimMinBoxEl = document.getElementById("dimMinBox");
const dimMaxBoxEl = document.getElementById("dimMaxBox");
const dimSamplesEl = document.getElementById("dimSamples");
const dimAutoAfterDrawEl = document.getElementById("dimAutoAfterDraw");
const dimRunBtn = document.getElementById("dimRunBtn");
const dimValueEl = document.getElementById("dimValue");
const dimMetaEl = document.getElementById("dimMeta");

let view = {
    xMin: -2,
    xMax: 2,
    yMin: -2,
    yMax: 2,
    zoomLevel: 1
};
// Initial iteration count and resolution from page inputs
let maxIter = parseInt(iterationsInput?.value || "50", 10);
let res = parseInt(resolutionInput?.value || "600", 10);

// k = re + im i.
let kVals = {
    re: parseFloat(kRealInput?.value || "-0.5"),
    im: parseFloat(kImagInput?.value || "0.5")
};

// Stores most recent basin classification
let lastClassIds = null;    // Used by dimension estimator to measure boundary between Newton basins
let lastWH = { w: 0, h: 0 };

// Complex arithmetic:
function cAdd(a, b) { return { r: a.r + b.r, i: a.i + b.i }; }
function cSub(a, b) { return { r: a.r - b.r, i: a.i - b.i }; }
function cMul(a, b) { return { r: a.r * b.r - a.i * b.i, i: a.r * b.i + a.i * b.r }; }

function cDiv(a, b) {
    const d = b.r * b.r + b.i * b.i;
    // Avoids dividing by zero!
    if (d === 0) {
        return { r: Infinity, i: Infinity };
    }

    return {
        r: (a.r * b.r + a.i * b.i) / d,
        i: (a.i * b.r - a.r * b.i) / d
    };
}
function cAbs(a) { return Math.hypot(a.r, a.i); }   // Modulus
function cScale(a, s) { return { r: a.r * s, i: a.i * s }; }
function cSqr(a) { return cMul(a, a); }
function cCube(a) { return cMul(cMul(a, a), a); }

// f(z) = z**3 + (k-1)z - k
function f(z, k) {
    const kMinus1 = { r: k.r - 1, i: k.i };

    return cSub(
        cAdd(cCube(z), cMul(kMinus1, z)),
        k
    );
}

// f'(z) = 3 z**2 + (k-1)
function derivF(z, k) {
    const threeZ2 = cScale(cSqr(z), 3);
    const kMinus1 = { r: k.r - 1, i: k.i };

    return cAdd(threeZ2, kMinus1);
}

// Pixel position -> complex number:
// px/py measured in CSS pixels from canvas
// rectW/rectH displayed canvas dimensions
function pixelToComplexCssPx(px, py, v, rectW, rectH) {
    const real = v.xMin + (px / rectW) * (v.xMax - v.xMin);
    const imag = v.yMin + (py / rectH) * (v.yMax - v.yMin);
    return { r: real, i: imag };
}

// Function converts HSL colour to RGB

// h,s,l in range [0,1]
function hslToRgb(h, s, l) {
    let r, g, b;
    // Saturation zero --> grey
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t-= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    // Returns RGB values in range [0, 255]
    return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
}

// Base hues for different roots/basins
const hues = [0, 120, 240];     // up to 3 roots

// Updates zoom display on the page
function updateZoomIndicator(v = view) {
    if (zoomEl) {
        zoomEl.textContent = `Zoom: ${v.zoomLevel.toFixed(2)}x`;
    }
}

// Updates display k value
function updateKReadout() {
    if (!kReadout) return;

    const a = kVals.re;
    const b = kVals.im;
    const sign = b >= 0 ? "+" : "-";
    const absb = Math.abs(b);

    kReadout.textContent = `k = ${a.toFixed(2)} ${sign} ${absb.toFixed(2)}i`;
}

// Function to decide which root a final Newton iterate belongs to
function classifyRoot(z, roots, tol = 1e-6) {
    for (let i = 0; i < roots.length; i++) {
        // If a point is close to existing root, return that root index
        if (cAbs(cSub(z, roots[i])) < tol) {
            return i;
        }
    }

    // Otherwise, add new root
    roots.push(z);
    return roots.length - 1;
}

// NEWTON'S METHOD: z_{n+1} = z_n - f(z_n) / f'(z_n)
function newtonConverge(z0, k, maxIter, tol, roots) {
    let z = { r: z0.r, i: z0.i };

    for (let iter = 0; iter < maxIter; iter++) {
        const fz = f(z, k);
        const dfz = derivF(z, k);
        const dfzAbs = cAbs(dfz);

        // Stops if derivative is invalid or zero; prevents dividing by zero
        if (!isFinite(dfzAbs) || dfzAbs === 0) {
            break;
        }

        const step = cDiv(fz, dfz);             // Newton step
        z = cSub(z, step);

        // If f(z) small enough, treat convergence to a root
        if (cAbs(fz) < tol) {
            const idx = classifyRoot(z, roots);
            return { hit: true, idx, iter };
        }
    }

    // Doesn't converge within maxIter
    return { hit: false, idx: -1, iter: maxIter };
}

// Function to zoom around centre point
function updateView(cx, cy, scaleFactor) {
    // scaleFactor > 1 zooms in
    // scaleFactor < 1 zooms out
    const width = (view.xMax - view.xMin) / scaleFactor;
    const height = (view.yMax - view.yMin) / scaleFactor;

    view.xMin = cx - width / 2;
    view.xMax = cx + width / 2;
    view.yMin = cy - height / 2;
    view.yMax = cy + height / 2;

    view.zoomLevel *= scaleFactor;
}

function drawNewton() {
    // Rereads current UI settings before drawing
    res = parseInt(resolutionInput?.value || String(res), 10);
    maxIter = parseInt(iterationsInput?.value || String(maxIter), 10);
    kVals.re = parseFloat(kRealInput?.value || String(kVals.re));
    kVals.im = parseFloat(kImagInput?.value || String(kVals.im));
    
    updateKReadout();
    const k = { r: kVals.re, i: kVals.im };

    canvas.width = res;
    canvas.height = res;

    const imgData = ctx.createImageData(res, res);
    const data = imgData.data;

    const tol = 1e-6;
    const roots = [];   // To store found roots during the render

    // Store basin class ids:
    // -1 means pixel did not converge
    // 0, 1, 2... correspond to root indices
    const classIds = new Int16Array(res * res);

    // Loops through every pixel in the canvas
    for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
            // Converts the current pixel to a starting complex number
            const z0 = {
                r: view.xMin + (x / (res - 1)) * (view.xMax - view.xMin),
                i: view.yMin + (y / (res - 1)) * (view.yMax - view.yMin),
            };
            // Runs Newton's method from this starting point
            const r = newtonConverge(z0, k, maxIter, tol, roots);

            let R = 0, G = 0, B = 0;
            let cid = -1;

            if (r.hit) {
                // Root basin index
                cid = r.idx;
                // Choose base hue depending on the root reached 
                const baseHue = hues[r.idx % hues.length];
                // t used for iteration count to shade the basin
                const t = r.iter / maxIter;
                const hue = baseHue / 360;
                const saturation = 1;
                const light = 0.6 - 0.4 * t;

                [R, G, B] = hslToRgb(hue, saturation, Math.max(0.15, light));
            } else {
                [R, G, B] = [0, 0, 0];  // Points that do not converge
            }

            // Stores basin class for boundary/dimension estimate
            classIds[y * res + x] = cid;

            // Calculation for RGB colours converted to ImageData array
            const i = 4 * (y * res + x);
            data[i] = R;
            data[i + 1] = G;
            data[i + 2] = B;
            data[i + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // Grid overlay
    if (drawGrid) {
        ctx.save();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.beginPath();

        for (let i = 0; i <= res; i += res / 10) {
            ctx.moveTo(i, 0); ctx.lineTo(i, res);
            ctx.moveTo(0, i); ctx.lineTo(res, i);
        }

        ctx.stroke();
        ctx.restore();
    }

    // Saves latest basin data for dimension tools
    lastClassIds = classIds;
    lastWH = { w: res, h: res };

    updateZoomIndicator();
}

// Local clamp helper; used for dimension-control values
function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}

// Function displays dimension result on page
function setDimReadout(result) {
    if (!result || !Number.isFinite(result.dimension)) {
        dimValueEl.textContent = "-";
        dimMetaEl.textContent = "Could not estimate (try different max box / samples).";
        
        return;
    }
    
    dimValueEl.textContent = result.dimension.toFixed(4);
    const r2 = result.fit?.r2;

    dimMetaEl.textContent = Number.isFinite(r2)
        ? `boxCountBitmap | \\(R^2 = ${r2.toFixed(3)}\\)`
        : `boxCountBitmap`;
    typesetMath(dimMetaEl);
}

function estimateDimension() {
    if (!dimValueEl || !dimMetaEl) return;

    const source = dimSourceEl?.value || "boundary";
    // Reads and clamps dimension settings from UI
    const downsampleTo = clamp(parseInt(dimDownsampleEl?.value || "768", 10), 128, 4096);
    const minBox = clamp(parseInt(dimMinBoxEl?.value || "2", 10), 1, 256);
    const maxBox = clamp(parseInt(dimMaxBoxEl?.value || "256", 10), 2, 4096);
    const samples = clamp(parseInt(dimSamplesEl?.value || "12", 10), 4, 32);

    try {
        let input;

        if (source === "boundary") {
            // Need a completed Newton rendering first
            if (!lastClassIds || !lastWH.w) {
                dimMetaEl.textContent = "Draw first (need basin classes).";
                return;
            }

            // Builds boundary mask from basin classes; pixels are marked as boundary pixels if their 
            // neighbours belong to a different Newton basin
            input = boundaryFromClasses(
                { width: lastWH.w, height: lastWH.h, classIds: lastClassIds },
                { eightConnected: true }
            );
        } else {
            // fallback: if using another source, it falls back to converting the canvas itself into a bitmap mask
            // reads current canvas as image mask
            input = canvasToMask(canvas, {
                downsampleTo, 
                threshold: null, 
                invert: false, 
                alphaMin: 1
            });
        }

        // Runs shared box-counting estimator
        const result = DimensionLab.run({
            estimator: "boxCountBitmap",
            input,
            options: { minBox, maxBox, samples },
        });

        setDimReadout(result);
    } catch (err) {
        console.error(err);

        dimValueEl.textContent = "-";
        dimMetaEl.textContent = `Dimension error: ${err.message}`;
    }
}

(function setupMouse() {
    if (!canvas) return;

    let down = null;
    const DRAG_PX = 6;  // functional: if mouse moves more than this, it is a drag and not a click

    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        down = {
            x: e.clientX, 
            y: e.clientY 
        };
    });

    // Clears click-tracking state when the mouse released
    window.addEventListener("mouseup", () => { down = null; });
    // Left-click zooms in
    canvas.addEventListener("click", (e) => {
        if (down) {
            const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
            down = null;

            if (moved > DRAG_PX) return;
        }

        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        // Converts clicked point to complex coordinates
        const c = pixelToComplexCssPx(px, py, view, rect.width, rect.height);

        // Zooms in around clicked point
        updateView(c.r, c.i, 2);
        drawNewton();

        if (dimAutoAfterDrawEl?.checked) {
            estimateDimension();
        }
    });

    // Right-click zooms out
    canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        // Convets right-clicked point to complex coordinates
        const c = pixelToComplexCssPx(px, py, view, rect.width, rect.height);
        
        // Zooms out around clicked point
        updateView(c.r, c.i, 0.5);
        drawNewton();
        
        if (dimAutoAfterDrawEl?.checked) {
            estimateDimension();
        }
    });

    // Updates mouse coordinate readouts when moving over the canvas
    canvas.addEventListener("mousemove", (e) => {
        if (!coordDisplay) return;

        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        // Converts pixels to complex
        const c = pixelToComplexCssPx(px, py, view, rect.width, rect.height);
        
        coordDisplay.textContent = `X: ${c.r.toFixed(5)}, Y: ${c.i.toFixed(5)}`;
    });
})();

// Drag to pan function
(function enableDragToPan() {
    if (!canvas) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    // Starts panning on left mouse down
    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;

        isDragging = true;
        const rect = canvas.getBoundingClientRect();

        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
    });

    // Stops panning when the mouse is released/leaves the canvas
    window.addEventListener("mouseup", () => { isDragging = false; });
    canvas.addEventListener("mouseleave", () => {isDragging = false; });

    // Moving view while dragging
    canvas.addEventListener("mousemove", (e) => {
        if (!isDragging) return;

        const rect = canvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        // Pixel movement since the last mousemove
        const dx = currentX - startX;
        const dy = currentY - startY;

        const w = rect.width || canvas.clientWidth || 1;
        const h = rect.height || canvas.clientHeight || 1;

        // Converts pixel movement into movement in complex plane
        const deltaRe = -dx * (view.xMax - view.xMin) / w;
        const deltaIm = -dy * (view.yMax - view.yMin) / h;
        // Shifts current view window
        view.xMin += deltaRe; view.xMax += deltaRe;
        view.yMin += deltaIm; view.yMax += deltaIm;

        // Stores position as the new drag reference
        startX = currentX;
        startY = currentY;

        drawNewton();
    });
})();

// Draws fractal using the current settings
drawBtn?.addEventListener("click", () => {
    drawNewton();

    if (dimAutoAfterDrawEl?.checked) {
        estimateDimension();
    }
});

clearBtn?.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

exportBtn?.addEventListener("click", () => {
    exportCanvasPNG(canvas, "newton.png");
});

// Resets view to the original coordinate window
resetViewBtn?.addEventListener("click", () => {
    view.xMin = -2; view.xMax = 2;
    view.yMin = -2; view.yMax = 2;
    view.zoomLevel = 1;
    
    updateZoomIndicator();
    drawNewton();

    if (dimAutoAfterDrawEl?.checked) {
        estimateDimension();
    }
});

// Toggles grid overlay
toggleGridBtn?.addEventListener("click", () => {
    drawGrid = !drawGrid;
    drawNewton();

    if (dimAutoAfterDrawEl?.checked) {
        estimateDimension();
    }
});

// Animation which zooms into centre of current view
function animateZoom() {
    if (!isPlaying) return;

    const cx = (view.xMin + view.xMax) / 2;
    const cy = (view.yMin + view.yMax) / 2;

    updateView(cx, cy, 1.05);
    drawNewton();

    // Animation tied to browser's refresh rate by requestAnimationFrame()
    animationId = requestAnimationFrame(animateZoom);
}

// Start/stop zoom animation
toggleAnimBtn?.addEventListener("click", () => {
    if (isPlaying) {
        cancelAnimationFrame(animationId);
        isPlaying = false;
    } else {
        isPlaying = true;
        animateZoom();
    }
});

startRecBtn?.addEventListener("click", () => {
    // Initialising to store recording chunks
    recordedChunks = [];
    const stream = canvas.captureStream(30);
    // Recorder for hte canvas stream
    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });

    // Stores available video data, which will be combined later into one Blob (when recording stops)
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    // When MediaRecorder stops, combine chunks into a Blob and download
    mediaRecorder.onstop = () => {
        // Builds final video file from recorded chunks
        const blob = new Blob(recordedChunks, {
            type: "video/webm"
        });

        const url = URL.createObjectURL(blob);      // temporary URL for the Blob
        const a = document.createElement("a");      // temporary download link
        a.href = url;
        a.download = "newton_animation.webm";

        // Starts download
        a.click();
        URL.revokeObjectURL(url);   // Cleans up temporary URL
    };

    mediaRecorder.start();
});

// Stop current recording
stopRecBtn?.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
});

// Manual range controls
applyRangeBtn?.addEventListener("click", () => {
    const xMin = parseFloat(document.getElementById("xMin")?.value);
    const xMax = parseFloat(document.getElementById("xMax")?.value);
    const yMin = parseFloat(document.getElementById("yMin")?.value);
    const yMax = parseFloat(document.getElementById("yMax")?.value);

    // Revents invalid ranges
    if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) return;
    if (xMax <= xMin || yMax <= yMin) return;

    view.xMin = xMin; view.xMax = xMax;
    view.yMin = yMin; view.yMax = yMax;
    view.zoomLevel = 1;

    updateZoomIndicator();
    drawNewton();
    if (dimAutoAfterDrawEl?.checked) estimateDimension();
});

dimRunBtn?.addEventListener("click", () => {
    estimateDimension();
});

// Initialises UI readouts
updateKReadout();
drawNewton();           // Draws first Newton fractal
updateZoomIndicator();

// Added for quick debugging, if needed
window.nView = view;
window.drawNewton = drawNewton;
window.estimateNewtonDimension = estimateDimension;