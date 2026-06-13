// js/shared/dimension/estimators/boxCountBitmap.js:
import { fitLogLog } from "../utils/logFit.js";

function countBoxes(mask, w, h, box) {
    // Math.ceil used because image size may not be divided exactly by box
    const boxesX = Math.ceil(w / box);
    const boxesY = Math.ceil(h / box);
    // Initialising count; will add boxes with at least one active pixel
    let count = 0;

    for (let by = 0; by < boxesY; by++) {
        const y0 = by * box;
        const y1 = Math.min(h, y0 + box);

        for (let bx = 0; bx < boxesX; bx++) {
            const x0 = bx * box;
            const x1 = Math.min(w, x0 + box);

            // Initialising hit, which will show us if the box has an active pixel
            // Once we find an active pixel in the box, we move on because the box already counts
            let hit = 0;
            for (let y = y0; y < y1 && !hit; y++) {
                let idx = y * w + x0;

                for (let x = x0; x < x1; x++, idx++) {
                    if (mask[idx]) { hit = 1; break; }
                }
            }

            // If box touches the set, add to box count
            if (hit){
                count++;
            }
        }
    }

    return count;
}

export const boxCountBitmap = {
    id: "boxCountBitmap",
    name: "Box-counting (bitmap mask)",
    // Makes estimator only works with bitmap-style input
    supports: (kind) => kind === "bitmap",

    run(input, options = {}) {
        const { width: W, height: H, mask } = input.data;
        const minBox = Math.max(1, options.minBox ?? 2);
        const maxBox = Math.max(minBox, options.maxBox ?? Math.min(W, H));
        const samples = Math.max(4, options.samples ?? 10);

        // Choosing box sizes log-spaced between minBox and maxBox
        // samples controls how many different box sizes are tested
        const sizes = [];
        for (let i = 0; i < samples; i++) {
            const t = i / (samples - 1);
            const s = Math.round(minBox * Math.pow(maxBox / minBox, t));
            // Ensures no duplicate sizes caused after rounding
            if (!sizes.includes(s)) sizes.push(s);
        }

        // Sizes are in increasing order before counting
        sizes.sort((a, b) => a - b);

        const raw = sizes.map((box) => {
            const N = countBoxes(mask, W, H, box);
            const eps = box / Math.min(W, H); // i.e. scale
            return { box, eps, N };
        }).filter(r => r.N > 0);

        // Converts the raw count to log-log points
        const logPoints = raw.map(r => ({
            x: Math.log(1 / r.eps),     // x = log(1/ε)
            y: Math.log(r.N)            // y = log(N(ε))
        }));

        // Fits straight line to log-log data
        const { slope, intercept, r2, used } = fitLogLog(logPoints, {
            fitRange: options.fitRange ?? null
        });
        
        // Returns dimension estimate and data used to produce it
        return {
            estimator: this.id,
            dimension: slope,
            fit: { slope, intercept, r2 },
            data: { raw, logPoints, used },
            meta: { ...input.meta }
        };
    }
};