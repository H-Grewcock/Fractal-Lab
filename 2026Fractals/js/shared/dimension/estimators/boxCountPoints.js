// js/shared/dimension/estimators/boxCountPoints.js:
import { fitLogLog } from "../utils/logFit.js";

function toUnitBox(points) {
    // Initialising with extreme values
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Finds bounding rectangle that contains all points
    for (const [x, y] of points) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    // The lower bound ensures we are not dividing by zero
    const dx = Math.max(1e-12, maxX - minX);
    const dy = Math.max(1e-12, maxY - minY);

    // Moves and scales each point into the unit square
    return points.map(([x, y]) => [(x - minX) / dx, (y - minY) / dy]);
}

function countBoxesPts(points01, bins) {
    // Bins = number of points along axis
    // 'seen' store visited boxes in a set; using a set to avoid double-counting boxes
    const seen = new Set();
    for (const [x, y] of points01) {
        // Converts the point coordinate into a grid index
        // The "| 0" truncates down to an integer
        const ix = Math.min(bins - 1, Math.max(0, (x * bins) | 0));
        const iy = Math.min(bins - 1, Math.max(0, (y * bins) | 0));
        // Marks grid square as occupied
        seen.add(ix + "," + iy);
    }
    // Returns number of occupied boxes
    return seen.size;
}

export const boxCountPoints = {
    id: "boxCountPoints",
    name: "Box-counting (points)",
    // Estimator only works on point data
    supports: (kind) => kind === "points",

    run(input, options = {}) {
        const pts = input.data.points || [];
        if (pts.length < 10) {
            return { estimator: this.id, dimension: NaN, fit: { slope: NaN, intercept: NaN, r2: NaN }, data: { raw: [] }, meta: input.meta };
        }

        const points01 = toUnitBox(pts);

        const minBins = Math.max(2, options.minBins ?? 4);
        const maxBins = Math.max(minBins, options.maxBins ?? 256);
        const samples = Math.max(4, options.samples ?? 10);
        
        // samples controls how many grid sizes are used between them
        const binsList = [];
        for (let i = 0; i < samples; i++) {
            const t = i / (samples - 1);
            const b = Math.round(minBins * Math.pow(maxBins / minBins, t));
            // Ensures no duplicate grid sizes caused after rounding
            if (!binsList.includes(b)) binsList.push(b);
        }
        // Grid sizes are in increasing order
        binsList.sort((a, b) => a - b);

        // Counts occupied boxes for each grid size
        const raw = binsList.map((bins) => {
            const N = countBoxesPts(points01, bins);
            const eps = 1 / bins;       // i.e. box width in unit-square coordinates
            return { bins, eps, N };
        }).filter(r => r.N > 0);

        // Converts the raw count to log-log points
        const logPoints = raw.map(r => ({
            x: Math.log(1 / r.eps),     // x = log(1/ε)
            y: Math.log(r.N)            // y = log(N(ε))
        }));
        // Fitting straight line to log-log data
        const { slope, intercept, r2, used } = fitLogLog(logPoints, {
            fitRange: options.fitRange ?? null
        });

        // Returns dimension estimate and data used to calculate it
        return {
            estimator: this.id,
            dimension: slope,
            fit: { slope, intercept, r2 },
            data: { raw, logPoints, used },
            meta: { ...input.meta }
        };
    }
};