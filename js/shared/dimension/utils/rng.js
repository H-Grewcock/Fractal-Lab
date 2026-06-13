// js/shared/dimension/utils/rng.js:

// Random number generator function:
// Using mulberry32 which is fast and gopd for visualisation
export function mulberry32(seed = 123456789) {
    let t = seed >>> 0;
    return function rand() {
        t += 0x6D2B79F5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}