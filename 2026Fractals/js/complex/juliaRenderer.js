// js/complex/juliaRenderer.js:

function juliaEscape(zx0, zy0, cre, cim, maxIter) {
    // Current real and imaginary parts of z
    let x = zx0, y = zy0, iter = 0;
    // Escape radius = 2
    while (x * x + y * y <= 4 && iter < maxIter) {
        // Squaring the complex number: (x + iy)**2 = (x**2 - y**2) + i(2xy); then + c
        const xt = x * x - y * y + cre;
        y = 2 * x * y + cim;
        x = xt;

        iter++;
    }

    return iter;
}

// Function converts HSL colour to RGB
// h,s,l in range [0,1]
function hslToRgb(h, s, l) {
    let r, g, b;
    // Saturation zero --> grey colour
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 
            ? l * (1 + s) 
            : l + s - l * s;
        
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    // Returns RGB values in range [0, 255]
    return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
}

function getColour(iter, maxIter) {
    // Points that do not escape are part of the filled-in Julia set.
    if (iter >= maxIter) return [0, 0, 0];
    // Cycle hue from 0 to 360 depending on the escape speed
    const hue = (360 * iter) / maxIter;
    
    return hslToRgb(hue / 360, 1, 0.5);
}

function drawGridOverlay(ctx, w, h, steps = 10) {
    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    // Vertical and horizontal grid lines
    for (let k = 0; k <= steps; k++) {
        const x = (k / steps) * w;
        const y = (k / steps) * h;

        ctx.moveTo(x, 0); ctx.lineTo(x, h);
        ctx.moveTo(0, y); ctx.lineTo(w, y);
    }

    ctx.stroke();
    ctx.restore();
}

// Fucntion to prevent old render when changing the parameters
function isCancelled(cancelToken) {
    if (!cancelToken) return false;
    if (typeof cancelToken === "function") return !!cancelToken();

    return !!cancelToken.cancelled;
}

// Function which allows c in different formats: [re, im], { re, im }, { real, imag }
function normaliseC(c) {
    // Array format: [real, imaginary]
    if (Array.isArray(c) && c.length >= 2){
        return { re: +c[0], im: +c[1] };
    }

    if (c && typeof c === "object") {
        if ("re" in c || "im" in c) {
            return { re: +c.re || 0, im: +c.im || 0 };
        }
        if ("real" in c || "imag" in c) {
            return { re: +c.real || 0, im : +c.imag || 0 };
        }
    }

    // Returns the default value if c missing/invalid
    return { re: 0, im: 0 };
}

// Function to render the Julia set onto the canvas given
export async function renderJulia({
    ctx, canvas, view, maxIter, c, quality = 1,
    cancelToken = null, rowsPerChunk = 24, 
    drawGrid = false, crispPixels = true,
} = {}) {
    if (!ctx || !canvas) {
        throw new Error("renderJulia: ctx and canvas required");
    }
    if (!view) {
        throw new Error("renderJulia: view required");
    }

    const C = normaliseC(c);
    // Quality = 1 means render at canvas resolution
    // Quality < 1 renders fewer pixels (faster but softer)
    // Quality > 1 renders more pixels (sharper but slower)
    const q = Number.isFinite(quality) && quality > 0 ? quality : 1;
    const W = canvas.width, H = canvas.height;
    const w = Math.max(2, Math.floor(W * q));
    const h = Math.max(2, Math.floor(H * q));

    const img = ctx.createImageData(w, h);
    const xMin = view.xMin, xMax = view.xMax;
    const yMin = view.yMin, yMax = view.yMax;
    
    // Rendering to offscreen canvas first -- then able to scale it to visible canvas in one go
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    // Number of rows to calculate before updating the visible canvas
    const chunk = Math.max(1, rowsPerChunk | 0);
    
    // Renders horizontal chunks image
    for (let j0 = 0; j0 < h; j0 += chunk) {
        // Stopped if page requested cancellation
        if (isCancelled(cancelToken)) return;

        const j1 = Math.min(h, j0 + chunk);

        // Loops over rows:
        for (let j = j0; j < j1; j++) {
            const zy0 = yMax - (j / (h - 1)) * (yMax - yMin);

            // Loops over columns:
            for (let i = 0; i < w; i++) {
                // Converting pixel x-coord to mathematical x-coord
                const zx0 = xMin + (i / (w - 1)) * (xMax - xMin);
                // Calculates escape iteration count for this point
                const iter = juliaEscape(zx0, zy0, C.re, C.im, maxIter);
                // Converts escape time to RGB colour
                const [r, g, b] = getColour(iter, maxIter);

                const idx = 4 * (j * w + i);
                img.data[idx] = r;
                img.data[idx + 1] = g;
                img.data[idx + 2] = b;
                img.data[idx + 3] = 255;
            }
        }
        
        // Copies current image data to offscreen canvas, then scales onto visible canvas
        offCtx.putImageData(img, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = !crispPixels;
        ctx.drawImage(off, 0, 0, W, H);

        // Grid overlay option
        if (drawGrid) {
            drawGridOverlay(ctx, W, H, 10);
        }

        await new Promise((r) => requestAnimationFrame(r));
    }

    // Grid overlay option
    if (drawGrid) drawGridOverlay(ctx, W, H, 10);
}