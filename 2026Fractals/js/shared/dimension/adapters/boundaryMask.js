// js/shared/dimension/adapters/boundaryMask.js:

// The functions take a grid classificaiton and turn it into a boundary binary mask.
// A pixel is a boundary  if at least one of its neighbouring pixels belongs to a different class.

// Used for dimension estimation since will want to measure the esge of a fractal rather than the filled-in image


function nbhOffsets(eightConnected) {
    // Returns list of neighbouring pixel offsets to check:
    // False = check only four direct neighbours: left, right, up, down
    // True = include the four diagonal neighbours.
    return eightConnected
        ? [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
        : [[1,0],[-1,0],[0,1],[0,-1]];
}

// Function builds boundary mask from class-id image
// classIds are flat arrays of length width * height
// Pixel becomes part of the boundary if any neighbouring pixel has a different class id.
export function boundaryFromClasses({ width, height, classIds }, {eightConnected = false } = {}) {
    if (!width || !height || !classIds) {
        throw new Error("boundaryFromClasses: invalid input");
    }
    // 1 = boundary pixel; 0 = not boundary
    const out = new Uint8Array(width * height);
    // Constant to see if we need to check 4 or 8 neighbours
    const nbh = nbhOffsets(eightConnected);

    // For loop: checks every pixel
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Converts 2D pixel coordinate to 1D array index
            const i = y * width + x;
            // Current pixel class
            const c = classIds[i];

            // Initialising isBoundary as pixel not in the boundary
            let isBoundary = 0;
            // Checking through all neighbours:
            for (const [dx, dy] of nbh) {
                const nx = x + dx, ny = y + dy;
                // Ignore neighbours outside the image
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                // Convert neighbour coordinate to 1D index
                const j = ny * width + nx;

                // If the neighbour has a different class, this pixel is on a boundary
                if (classIds[j] !== c) {
                    isBoundary = 1; break;
                }
            }

            // Stores boundary result for the pixel
            out[i] = isBoundary;
        }
    }

    // Returns in the shared bitmap format used by the dimension tools
    return {
        kind: "bitmap",
        data: { width, height, mask: out },
        meta: { source: "boundaryFromClasses" } 
    };
}

// Function builds boundary mask from the binray mask
// A mask is a flat array of length width * height
// 1 = true/non-zero: inside or active
// 0 = false: outside or inactive

// Pixel is a boundary if one of its neighbours has the opposite binary value.

export function boundaryFromBinaryMask({ width, height, mask }, { eightConnected = false } = {}) {
    if (!width || !height || !mask) {
        throw new Error("boundaryFromBinaryMask: invalid input");

    }

    const out = new Uint8Array(width * height);
    const nbh = nbhOffsets(eightConnected);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            // Normalises current pixel to exactly 0 or 1
            const v = mask[i] ? 1 : 0;

            let isBoundary = 0;
            for (const [dx, dy] of nbh) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const j = ny * width + nx;
                // Normalises neighbours and then compares
                if ((mask[j] ? 1 : 0) !== v) {
                    isBoundary = 1; break;
                }
            }

            out[i] = isBoundary;
        }
    }

    // Returns in the shared bitmap format used by the dimension tools
    return {
        kind: "bitmap",
        data: { width, height, mask: out },
        meta: { source: "boundaryFromBinaryMask" }
    };
}