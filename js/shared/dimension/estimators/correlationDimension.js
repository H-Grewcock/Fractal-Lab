// js/shared/dimension/estimators/correlationDimension.js:
import { fitLogLog } from "../utils/logFit.js";
import { mulberry32 } from "../utils/rng.js";

// Function to calculate Euclidean distance between 2D points:
function dist2(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];

    return dx * dx + dy * dy;
}

// Randomly samples points from a larger point cloud
function samplePoints(points, maxN, seed = 1234) {
    // Use entire point cloud if small enough
    if (points.length <= maxN) return points;
    // Otherwise, use RNG
    const rand = mulberry32(seed);
    const out = [];

    // Pick maxN random points from the original point cloud
    for (let i = 0; i < maxN; i++) {
        out.push(points[(rand() * points.length) | 0]);
    }

    return out;
}

function correlationIntegral(points, r) {
    const r2 = r * r;
    const n = points.length;
    let hits = 0;               // hits = number of close pairs
    let pairs = 0;              // pairs = total number of checked pairs

    // Checking all unordered pairs once 
    for (let i = 0; i < n; i++) {
        const pi = points[i];
        for (let j = i + 1; j < n; j++) {
            pairs++;
            if (dist2(pi, points[j]) < r2) hits++;
        }
    }
    
    // Normalise by total number of unordered pairs
    // n(n - 1) / 2 = number of pairs
    return pairs > 0 ? (2 * hits) / (n * (n - 1)) : 0;
}

// Rescales the point cloud into unit square [0,1] x [0,1]
function toUnitBox(points) {
    // Starts with the extreme values
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Finds bounding rectangle of the point cloud
    for (const [x, y] of points) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }

    // Setting min 1e-12 ensures we are not dividing by zero
    const dx = Math.max(1e-12, maxX - minX);
    const dy = Math.max(1e-12, maxY - minY);
    // Shifts and scales every point into the unit square
    return points.map(([x, y]) => [
        (x - minX) / dx,
        (y - minY) / dy
    ]);
}

export const correlationDimension = {
    id: "correlationDimension",
    name: "Correlation dimension (points)",
    // estimator only accepts point data
    supports: (kind) => kind === "points",

    run(input, options = {}) {
        let pts = input.data.points || [];
        // If there are too few points, the dimension estimate is unreliable
        if (pts.length < 50) {
            return {
                estimator: this.id,
                dimension: NaN,
                fit: { slope: NaN, intercept: NaN, r2: NaN },
                data: { raw: [] },
                meta: input.meta
            };
        }
        // Limiting maximum number of points as the more points the longer the calculation will take
        const maxPoints = Math.max(200, options.maxPoints ?? 2000);
        const seed = options.seed ?? 1234;

        // Downsample and then normalise into unit square 
        pts = samplePoints(pts, maxPoints, seed);
        pts = toUnitBox(pts);

        // Defining constants for minimum and maximum radii tested
        const rMin = Math.max(1e-6, options.rMin ?? 1 / 256);
        const rMax = Math.max(rMin * 1.01, options.rMax ?? 1 / 4);
        const samples = Math.max(6, options.samples ?? 12);             // Number of radii tested

        const rs = [];
        for (let i = 0; i < samples; i++) {
            const t = i / (samples - 1);
            rs.push(rMin * Math.pow(rMax / rMin, t));
        }

        // Calculates C(r) for each r
        // Removes zero values since log(0) is undefined
        const raw = rs.map(r => {
            const C = correlationIntegral(pts, r);
            return { r, C };
        }).filter(o => o.C > 0);

        // Converts to log-log points
        const logPoints = raw.map(o => ({
            x: Math.log(o.r),           // x = log(r)
            y: Math.log(o.C)            // y = log(C(r))
        }));
        // For correlation dimension, slope of log(C(r)) vs log(r) is D2
        const { slope, intercept, r2, used } = fitLogLog(logPoints, { fitRange: options.fitRange ?? null });

        // Returns dimension estimate and data used to calculate it
        return {
            estimator: this.id,
            dimension: slope,
            fit: { slope, intercept, r2 },
            data: { raw, logPoints, used },
            meta: { ...input.meta, sampled: pts.length }
        };
    }
};