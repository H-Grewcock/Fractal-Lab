// js/shared/dimension/estimators/similarityDimension.js:

// Used for an IFS made from similarity maps.
// Similarity dimension s is defined by solving ∑_i r_i^s = 1.

// Fnuction to calculate sum ∑ r_i^s, for contraction ratios r_i and test value s
function fSum(ratios, s) {
    let sum = 0;
    for (const r of ratios) {
        sum += Math.pow(r, s);
    }
    
    return sum;
}

export const similarityDimension = {
    id: "similarityDimension",
    name: "Similarity dimension (IFS ratios)",
    // Makes estimator only works with similarity-ratio input
    supports: (kind) => kind === "similarities",

    run(input, options = {}) {
        // Filters out invaid ratios: only working with finite numbers, > 0 & < 1 since they are contractions
        const ratios = (input.data?.ratios || []).filter(r => Number.isFinite(r) && r > 0 && r < 1);
        if (!ratios.length) {
            return { estimator: this.id, dimension: NaN, data: { ratios }, meta: input.meta };
        }

        const sMax = Math.max(1, options.sMax ?? 10);
        // Bisection starts with [lo, hi]
        let lo = 0;
        let hi = sMax;

        // at s=0 => (#maps - 1)
        // Since at s = 0, every r_i^s = 1, so the sum is just the number of maps and we are solving: fSum(ratios, s) - 1 = 0
        const flo = fSum(ratios, lo) - 1;
        if (flo < 0) {
            // Weird case:
            return { estimator: this.id, dimension: 0, data: { ratios }, meta: input.meta };
        }

        // Ensuring f(hi) <= 0:
        // Making sure the upper end of the brackert is large enough
        while (fSum(ratios, hi) - 1 > 0 && hi < 200) {
            hi *= 2;
        }

        // Bisection, i.e. keep splitting interval in half and keeping the half containing the solution
        const iters = Math.max(30, options.iters ?? 60);
        for (let k = 0; k < iters; k++) {
            const mid = 0.5 * (lo + hi);
            const fm = fSum(ratios, mid) - 1;
            if (fm > 0) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        // Final estimate is the midpoint of the last remaining bracket
        const s = 0.5 * (lo + hi);
        return { estimator: this.id,
            dimension: s,
            data: { ratios, bracket: [0, hi] },
            meta: input.meta
        };
    }
};