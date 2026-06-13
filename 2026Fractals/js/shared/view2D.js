// js/shared/view2D.js:
import { clamp, parseNumber, resizeCanvasToDisplaySize } from "./dom.js";

export class View2D {
    constructor({
        canvas,
        zoomIndicatorEl = document.getElementById("zoom-indicator"),
        mouseCoordsEl = document.getElementById("mouse-coords"),
        initial = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }, // Initial mathematical coordinate window
        zoomLimits = { min: 1e-6, max: 1e6 },               // zoom factor relative to initial width
        wheelZoomFactor = 1.15,
        enableRightClickZoom = true,
        enableDragPan = true,
        enableWheelZoom = true,
        enableClickZoom = false,
        clickZoomFactor = 1.5,
        onChange = null,
    }) {
        if (!canvas) {
            throw new Error("View2D requires canvas");
        }

        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");

        this.zoomIndicatorEl = zoomIndicatorEl;
        this.mouseCoordsEl = mouseCoordsEl;

        // Stores original view and current live view
        this.initial = { ...initial };
        this.view = { ...initial };

        // Stores zoom settings
        this.zoomLimits = { ...zoomLimits };
        this.wheelZoomFactor = wheelZoomFactor;
        this.clickZoomFactor = clickZoomFactor;

        this.enableRightClickZoom = enableRightClickZoom;
        this.enableDragPan = enableDragPan;
        this.enableWheelZoom = enableWheelZoom;
        this.enableClickZoom = enableClickZoom;
        
        this.onChange = typeof onChange === "function" ? onChange : null;

        this._isPanning = false;
        // Stores mouse position & view window at the start of a pan
        this._panStart = {
            clientX: 0,
            clientY: 0,
            xMin: 0,
            xMax: 0,
            yMin: 0,
            yMax: 0,
        };

        this._bind();       // Attaches mouse event listeners
        this.updateHUD();   // Shows initial zoom value
    }

    // Dimensions:
    getWidthPx() { return this.canvas.width; }
    getHeightPx() { return this.canvas.height; }

    worldWidth() { return this.view.xMax - this.view.xMin; }
    worldHeight() { return this.view.yMax - this.view.yMin; }

    _clientToCanvasPx(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        // Converts browser mouse coordinates to canvas pixel coordinates
        // Mouse events give clientX and clientY in CSS pixels
        const x = (clientX - rect.left) * (this.canvas.width / rect.width);
        const y = (clientY - rect.top) * (this.canvas.height / rect.height);

        return { x, y };
    }

    // World coords: x increases right, y increases up
    // Canvas coords: x increases right, y increases down
    canvasPxToWorld(canvasX, canvasY) {
        // Converts pixel coordinates to mathematical world coordinates
        const x = this.view.xMin + (canvasX / this.getWidthPx()) * this.worldWidth();
        const y = this.view.yMax - (canvasY / this.getHeightPx()) * this.worldHeight();

        return { x, y };
    }

    worldToCanvasPx(worldX, worldY) {
        const W = this.getWidthPx();
        const H = this.getHeightPx();
        // Converts mathematical world coordinates to canvas pixel coordinates
        const x = ((worldX - this.view.xMin) / this.worldWidth()) * W;
        const y = ((this.view.yMax - worldY) / this.worldHeight()) * H;

        return { x, y };
    }

    // HUD
    updateHUD(mouseWorld = null) {
        if (this.zoomIndicatorEl) {
            const initW = this.initial.xMax - this.initial.xMin;
            // Zoom measured as initial width divided by current width
            const z = initW / this.worldWidth();
            this.zoomIndicatorEl.textContent = `Zoom: ${z.toFixed(2)}x`;
        }

        if (this.mouseCoordsEl && mouseWorld) {
            this.mouseCoordsEl.textContent = `X: ${mouseWorld.x.toFixed(2)}, Y: ${mouseWorld.y.toFixed(2)}`;
        }
    }

    // View Controls:
    setView({ xMin, xMax, yMin, yMax }, { trigger = true } = {}) {
        this.view.xMin = parseNumber(xMin, this.view.xMin);
        this.view.xMax = parseNumber(xMax, this.view.xMax);
        this.view.yMin = parseNumber(yMin, this.view.yMin);
        this.view.yMax = parseNumber(yMax, this.view.yMax);

        // Keeps the view valid
        if (this.view.xMax <= this.view.xMin) this.view.xMax = this.view.xMin + 1;
        if (this.view.yMax <= this.view.yMin) this.view.yMax = this.view.yMin + 1;

        // Refreshes the zoom display
        this.updateHUD();
        if (trigger) {
            this._triggerChange();
        }
    }

    // Resets view back to initial coordinate window
    reset({ trigger = true } = {}) {
        this.setView(this.initial, { trigger });
    }

    zoomAtWorldPoint(worldX, worldY, factor, { trigger = true } = {}) {
        const f = parseNumber(factor, 1);
        if (!Number.isFinite(f) || f <= 0) return;  // Ignores invalid/negative zoom factors

        const w = this.worldWidth();
        const h = this.worldHeight();

        // Proposed new width/height (keep aspect ratio)
        const newW = w / f;
        const initW = this.initial.xMax - this.initial.xMin;

        // Clamps zoom factor relative to initial width
        // z = 1 means original zoom
        // z > 1 means zoomed in
        // z < 1 means zoomed out
        const z = initW / newW;
        const clampedZ = clamp(z, this.zoomLimits.min, this.zoomLimits.max);
        const finalW = initW / clampedZ;

        // Preserves current aspect ratio (h/w)
        const aspect = h / w;
        const finalH = finalW * aspect;

        // Keep the point (worldX, worldY) stationary in the canvas.
        // Compute its relative position within the current view:
        const tx = (worldX - this.view.xMin) / w;
        const ty = (this.view.yMax - worldY) / h;

        // Chooses new bounds s.t. worldX and worldY stay at the same relative canvas position post-zooming
        const xMin = worldX - tx * finalW;
        const xMax = xMin + finalW;

        const yMax = worldY + ty * finalH;
        const yMin = yMax - finalH;

        this.setView({ xMin, xMax, yMin, yMax }, { trigger });
    }

    // Moves view by a given amount in world coordinates
    panByWorld(dx, dy, { trigger = true } = {}) {
        this.setView(
        {
            xMin: this.view.xMin + dx,
            xMax: this.view.xMax + dx,
            yMin: this.view.yMin + dy,
            yMax: this.view.yMax + dy,
        },
        { trigger }
        );
    }

    resizeToDisplay({ trigger = true } = {}) {
        // Resizes canvas to match displayed size
        const changed = resizeCanvasToDisplaySize(this.canvas, { matchCSS: true });
        if (changed) {
            this.updateHUD();
            if (trigger) this._triggerChange();
        }

        // Returns true if canvas size changed
        return changed;
    }

    // Attaches mouse event listeners for panninga and zooming
    _bind() {
        // Prevents browser context meny on right click if right-click zoom
        if (this.enableRightClickZoom) {
            this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        }

        this.canvas.addEventListener("mousemove", (e) => {
            const { x: cx, y: cy } = this._clientToCanvasPx(e.clientX, e.clientY);
            const world = this.canvasPxToWorld(cx, cy);
            // Shows current mouse coordinates
            this.updateHUD(world);

            // If dragging, pans the coordinate window
            if (this.enableDragPan && this._isPanning) {
                const { x: sx, y: sy } = this._clientToCanvasPx(
                    this._panStart.clientX, 
                    this._panStart.clientY
                );

                // Mouse movement incanvas pixels
                const dxCanvas = cx - sx;
                const dyCanvas = cy - sy;

                // Converts canvas movement to world-coordinate movement
                // Dragging right moves view left, hence minus sign
                // Canvas y increases downwards, so dyWorld has opposite interpretation from normal y
                const dxWorld = -(dxCanvas / this.getWidthPx()) * this.worldWidth();
                const dyWorld = (dyCanvas / this.getHeightPx()) * this.worldHeight();

                // Applies pan relative to the view at the start of the drag
                this.setView(
                {
                    xMin: this._panStart.xMin + dxWorld,
                    xMax: this._panStart.xMax + dxWorld,
                    yMin: this._panStart.yMin + dyWorld,
                    yMax: this._panStart.yMax + dyWorld,
                },
                { trigger: true }
                );
            }
        });

        // Drag-to-pan behaviour:
        if (this.enableDragPan) {
            this.canvas.addEventListener("mousedown", (e) => {
                if (e.button !== 0) return;         // Only left mouse button starts panning
                if (this.enableClickZoom) return;   // Disabled when click zoom enabled

                this._isPanning = true;
                // Stores mouse and view state at the start of pan
                this._panStart = {
                    clientX: e.clientX,
                    clientY: e.clientY,
                    xMin: this.view.xMin,
                    xMax: this.view.xMax,
                    yMin: this.view.yMin,
                    yMax: this.view.yMax,
                };
            });

            // Stops panning when the mouse is released anywhere in the window
            window.addEventListener("mouseup", () => {
                this._isPanning = false;
            });
        }

        // Mouse-wheel mode: zoom centred on the mouse position
        if (this.enableWheelZoom) {
            this.canvas.addEventListener(
                "wheel",
                (e) => {
                    // Prevents page from scrolling while zooming on the canvas
                    e.preventDefault();

                    const { x: cx, y: cy } = this._clientToCanvasPx(e.clientX, e.clientY);
                    const world = this.canvasPxToWorld(cx, cy);
                    const zoomIn = e.deltaY < 0;    // Negative deltaY --> zoom in/wheel up
                    const factor = zoomIn 
                        ? this.wheelZoomFactor 
                        : 1 / this.wheelZoomFactor;
                    
                    this.zoomAtWorldPoint(world.x, world.y, factor, {
                        trigger: true
                    });
                },
                { passive: false }
            );
        }

        // Click-to-zoom mode:
        if (this.enableClickZoom) {
            this.canvas.addEventListener("mousedown", (e) => {
                const { x: cx, y: cy } = this._clientToCanvasPx(e.clientX, e.clientY);
                const world = this.canvasPxToWorld(cx, cy);

                if (e.button === 0) {
                    // Left click to zoom in
                    this.zoomAtWorldPoint(
                        world.x, 
                        world.y, 
                        this.clickZoomFactor, 
                        { trigger: true }
                    );
                } else if (this.enableRightClickZoom && e.button === 2) {
                    // Right click to zoom out
                    this.zoomAtWorldPoint(
                        world.x, 
                        world.y, 
                        1 / this.clickZoomFactor, 
                        { trigger: true }
                    );
                }
            });
        }
    }

    // Called when the view changes
    // Updates HUD and lets the page redraw the fractal using the new coordinate window
    _triggerChange() {
        this.updateHUD();
        if (this.onChange) this.onChange(this.view);
    }
}