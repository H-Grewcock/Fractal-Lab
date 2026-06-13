// js/shared/dom.js:

// Short-hand for document.querySelector(...)
export const qs = (sel, root = document) => root.querySelector(sel);
// Short hand for document.querySelectorAll(...)
// Converted to real array
export const qsa = (sel, root = document) => 
    Array.from(root.querySelectorAll(sel));

// Function to keep a number inside a given range
export function clamp(x, a, b) {
    const n = Number(x);
    const lo = Number(a);
    const hi = Number(b);

    // If x not a valid number, fall back to lower bound
    if (!Number.isFinite(n)) return lo;
    // x < a returns a
    if (n < lo) return lo;
    // x > b returns b
    if (n > hi) return hi;
    // Returns x
    return n;
}

// Parses number from an input value
export function parseNumber(value, fallback = 0) {
    const n = typeof value === "number" 
        ? value 
        : parseFloat(String(value));
    
    // Returns fallback if value cannot be parsed
    return Number.isFinite(n) ? n : fallback;
}

// Parsing "a,b" or "a, b" into [a,b]:
export function parseRangeText(text, fallback = [0,1]) {
    // Only strings can be split into range text
    if (typeof text !== "string") return fallback;
    // Splits on comma and removes extra spaces
    const parts = text.split(",").map((s) => s.trim());

    // Ensures range is exactly two elements
    if (parts.length !== 2) return fallback;

    const a = parseNumber(parts[0], NaN);
    const b = parseNumber(parts[1], NaN);
    
    // Ensures valid numbers and the upper bound > lower bound
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
        return fallback;
    }

    return [a, b];
}

// Function to set text content of an element
export function setText(idOrEl, text) {
    const el = typeof idOrEl === "string"
        ? document.getElementById(idOrEl)
        : idOrEl;
    
    if (el) {
        el.textContent = String(text);
    }
}

export function resizeCanvasToDisplaySize(canvas, { matchCSS = true } = {}) {
    if (!canvas) return false;

    // Device pixel ratio - handles high DPI screens
    const dpr = window.devicePixelRatio || 1;
    // Uses display CSS size by default
    const cssWidth = matchCSS ? canvas.clientWidth : canvas.width;
    const cssHeight = matchCSS ? canvas.clientHeight : canvas.height;
    
    // Do not resize if canvas hidden / has no size
    if (cssWidth <= 0 || cssHeight <= 0) return false;

    // Converts CSS pixels to drawing pixels
    const targetWidth = Math.round(cssWidth * dpr);
    const targetHeight = Math.round(cssHeight * dpr);
    // Only resize if needed
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        // Returns true if canvas changes size
        return true;
    }

    // Returns false if no resize required
    return false;
}