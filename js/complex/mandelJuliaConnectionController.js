// js/complex.mandelJuliaConnectionController.js:
import { renderMandelbrot } from "./mandelbrotRenderer.js";
import { renderJulia } from "./juliaRenderer.js";

// Concept: Mandelbrot set is drawn on the LHS; user clicks a point c in the Mandelbrot plane;
// then that c value is used to render the associated Julia canvas

// Function to convert mouse position from browser coordinates into mathematical world coordinates
function clientToWorld(view2d, clientX, clientY) {
    const canvas = view2d.canvas;
    const rect = canvas.getBoundingClientRect();
    // Converts CSS pixels to canvas pixels
    const cx = (clientX - rect.left) * (canvas.width / rect.width);
    const cy = (clientY - rect.top) * (canvas.height / rect.height);

    // Returns converted canvas pixels into mathematical coordinates
    return view2d.canvasPxToWorld(cx, cy);
}

// Fucntion to prevent old render when changing the parameters
function isCancelled(cancelToken) {
    if (!cancelToken) return false;
    if (typeof cancelToken === "function") return !!cancelToken();

    return !!cancelToken.cancelled;
}

function drawCMarker(view2d, ctx, c, { radius = 6 } = {}) {
    if (!view2d || !ctx ||!c) return;

    // Converts c value to canvas pixel coordinates
    const p = view2d.worldToCanvasPx(c.re, c.im);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;

    ctx.save();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";

    // Circle marker around selected point:
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Cross-hair marker drawing:
    ctx.beginPath();
    ctx.moveTo(p.x - radius - 5, p.y);
    ctx.lineTo(p.x + radius + 5, p.y);
    ctx.moveTo(p.x, p.y - radius - 5);
    ctx.lineTo(p.x, p.y + radius + 5);
    ctx.stroke();

    ctx.restore();
}

export function createMandelJuliaConnection({
    mandelCanvas, juliaCanvas, mandelView, juliaView, getMaxIter,
    getQuality, getDrawGrid = () => false, setCReadout = () => {},
} = {}) {
    const mandelCtx = mandelCanvas.getContext("2d", { willReadFrequently: true });
    const juliaCtx = juliaCanvas.getContext("2d", { willReadFrequently: true });
    
    // Default Mandelbrot set c value
    let c = { re: -0.8, im: 0.156 };
    
    let mandelCancel = { cancelled: false };
    let juliaCancel = { cancelled: false };
    // Used to track whether user clicked to choose c value
    let hasSelectedC = false;

    // Cancels old render and returns new one
    function resetCancel(old) {
        if (old) old.cancelled = true;
        return { cancelled: false };
    }

    // Updates current c
    // syncInputs updates UI input boxes to match new value
    function setC(newC, { syncInputs = true } = {}) {
        c = {
            re: Number.isFinite(newC.re) ? newC.re : 0,
            im: Number.isFinite(newC.im) ? newC.im : 0,
        };

        // Updates displau c value
        setCReadout(c, { syncInputs });
    }

    async function drawMandel() {
        // Cancels previous Mandelbrot render
        mandelCancel = resetCancel(mandelCancel);
        mandelView.resizeToDisplay?.({ trigger: false });

        await renderMandelbrot({
            ctx: mandelCtx,
            canvas: mandelCanvas,
            view: mandelView.view,
            maxIter: getMaxIter(),
            quality: getQuality(),
            drawGrid: !!getDrawGrid(),
            cancelToken: mandelCancel,
        });

        // Only draws marker if the render was not cancelled
        if (!isCancelled(mandelCancel) && hasSelectedC) {
            drawCMarker(mandelView, mandelCtx, c);
        }
    }

    async function drawJulia() {
        // Cancels previous Julia render
        juliaCancel = resetCancel(juliaCancel);
        // Resizes display to matcah current canvas display size
        juliaView.resizeToDisplay?.({ trigger: false });

        await renderJulia({
            ctx: juliaCtx,
            canvas: juliaCanvas,
            view: juliaView.view,
            maxIter: getMaxIter(),
            quality: getQuality(),
            c,
            drawGrid: !!getDrawGrid(),
            cancelToken: juliaCancel,
        });
    }

    // Redraws both canvases
    async function drawBoth() {
        await drawMandel();
        await drawJulia();
    }

    // Constants to ensure normal click used to select c; if user drags, do not treat as choosing new c
    let down = null;
    const DRAG_PX = 6;

    // Function to store mouse-down position -- will allow me tocheck whether user clicked or dragged
    function onDown(e) {
        // Responds to left mouse button
        if (e.button !== 0) return;

        down = {
            x: e.clientX,
            y: e.clientY
        };
    }

    function onUp(e) {
        if (!down) return;

        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        const moved = Math.hypot(dx, dy);

        // Clears stored mouse-down state
        down = null;

        // Ignore event if dragging rather than clicking
        if (moved > DRAG_PX) return;
        // Converts clicked canvas position into Mandelbrot world coordinates
        const w = clientToWorld(mandelView, e.clientX, e.clientY);
        // Shows marker on the Mandelbrot canvas
        hasSelectedC = true;

        // Sets clicked point as new Julia parameter c
        setC({ re: w.x, im: w.y }, { syncInputs: true });
        drawCMarker(mandelView, mandelCtx, c);
        drawJulia();
    }

    // Selects c by clicking the Mandelbrot canvas
    mandelCanvas.addEventListener("mousedown", onDown);
    mandelCanvas.addEventListener("mouseup", onUp);
    mandelCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

    return {
        drawBoth, drawMandel, drawJulia, setC,
        getC: () => ({ ...c }),
        // Removes event listeners and cancels ongoing renders
        destroy() {
            mandelCanvas.removeEventListener("mousedown", onDown);
            mandelCanvas.removeEventListener("mouseup", onUp);
            mandelCancel.cancelled = true;
            juliaCancel.cancelled = true;
        },
    };
}