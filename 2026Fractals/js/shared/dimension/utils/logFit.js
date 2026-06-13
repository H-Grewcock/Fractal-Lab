// js/shared/dimension/utils/logFit.js:

// Helper functions to fit straight lines to log-log data:
// Example usage: in box-counting dimension, we often fit:
//      log(N(ε)) vs. log(1/ε)
// Then the slope of the line gives the estimated dimension

// Least-squares line fit for y = mx + b:
export function linearFit(xs, ys) {
    if (!xs?.length || xs.length !== ys.length) throw new Error("linearFit: bad inputs");
    const n = xs.length;

    // sx = sum of x; sy = sum of y; sxx = sum of x**2; sxy = sum of x*y
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
    }
    // Denominator in least squares slope formula:
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return {
        slope: NaN, intercept: NaN, r2: NaN
    };

    // Slope and intercept formula:
    const slope = (n * sxy - sx * sy) / den;
    const intercept = (sy - slope * sx) / n;    // Passes through mean point

    // R^2:
    let ssTot = 0, ssRes = 0;
    const yBar = sy / n;
    for (let i = 0; i < n; i++) {
        const y = ys[i];
        const yHat = slope * xs[i] + intercept;
        ssTot += (y - yBar) ** 2;
        ssRes += (y - yHat) ** 2;               // Leftover error after fitting line
    }

    const r2 = ssTot > 0 ? (1 - ssRes / ssTot) : NaN;
    return { slope, intercept, r2 };
}

// Picking middle window if user does not specify fitRange:
export function fitLogLog(points, { fitRange = null } = {}) {
    // Removing any points with NaN, Infinity or omissing values
    const clean = points.filter(p => 
        Number.isFinite(p.x) && Number.isFinite(p.y)
    );
    // Rquires two points to fit a line
    if (clean.length < 2) return { slope: NaN, intercept: NaN, r2: NaN, used: [] };
    
    let used = clean;

    if (fitRange && Number.isFinite(fitRange.minX) && Number.isFinite(fitRange.maxX)) {
        used = clean.filter(p => p.x >= fitRange.minX && p.x <= fitRange.maxX);
        if (used.length < 2) used = clean;
    } else if (clean.length >= 6) {
        // Uses middle 70& if no range supplied
        const a = Math.floor(clean.length * 0.15);
        const b = Math.ceil(clean.length * 0.85);
        used = clean.slice(a, b);
    }

    // Splitting chosen point back into x and y arrays
    const xs = used.map(p => p.x);
    const ys = used.map(p => p.y);
    const { slope, intercept, r2 } = linearFit(xs, ys);

    return { slope, intercept, r2, used };
}