// js/shared/dimension/adapters/canvasMask.js:

export function canvasToMask(canvas, {
    downsampleTo = 512,     // resizing canvas to keep calculations quick
    threshold = null,
    invert = false,         // invert used if we are in dark mode
    alphaMin = 1,           // min alpha value allowed for a pixel to count
} = {}) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const srcW = canvas.width;
    const srcH = canvas.height;
    if (!srcW || !srcH) throw new Error("canvasToMask: canvas has zero size");

    // Calculating downsample scale:
    const scale = Math.min(downsampleTo / srcW, downsampleTo / srcH, 1);
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(canvas, 0, 0, w, h);

    const img = tctx.getImageData(0, 0, w, h);
    const data = img.data;
    // Binary mask: 1 = inside/active; 0 = outside/inactive
    const mask = new Uint8Array(w * h);

    // The threshold: high values = most non-white/dark pixels count as inside
    const thr = (threshold == null) ? 250 : threshold;

    // Loops through RGBA array
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

        if (a < alphaMin) {
            mask[p] = invert ? 1 : 0;
            continue;
        }
        // Constant lum role is to convert RGB to perceived brightness
        const lum = 0.216 * r + 0.7152 * g + 0.0722 * b;
        // Treating dark pixels as being inside the fractal
        const inside = lum < thr ? 1 : 0;

        // Can invert if the page needs the opposite convention, i.e. if we are in dark mode, invert the brightness
        mask[p] = invert ? (inside ? 0 : 1) : inside;
    }

    // Returns in the shared bitmap format used by the dimension tools
    return {
        kind: "bitmap",
        data: { width: w, height: h, mask },
        meta: { source: "canvas", downsampleScale: scale, threshold: thr, invert }
    };
}