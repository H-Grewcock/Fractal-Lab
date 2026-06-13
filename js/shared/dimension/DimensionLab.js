// js/shared/dimension/DimensionLab.js:
import { boxCountBitmap } from "./estimators/boxCountBitmap.js";
import { boxCountPoints } from "./estimators/boxCountPoints.js";
import { correlationDimension } from "./estimators/correlationDimension.js";
import { similarityDimension } from "./estimators/similarityDimension.js";

// Importing all types of estimators, and calling them by their id

export const DimensionLab = (() => {
    // Constant to store all available estimators by their id
    const registry = new Map();
    // Function to add new estimators to the registry
    function register(estimator) {
        if (!estimator?.id) throw new Error("DimensionLab.register: estimator missing id");
        registry.set(estimator.id, estimator);
    }

    // Registers built-in estimators
    register(boxCountBitmap);
    register(boxCountPoints);
    register(correlationDimension);
    register(similarityDimension);

    // Function which returns all the available estimators
    function list({ kind = null } = {}) {
        const all = Array.from(registry.values());
        // If kind provided, only returns estimators supporting that input type
        return kind ? all.filter((e) => e.supports?.(kind)) : all;
    }

    // Function to find an estimator by its id
    function get(id) {
        const est = registry.get(id);
        if (!est) throw new Error(`DimensionLab.get: unknown esitmator "${id}"`);
        return est;
    }

    // Function to run the chosen estimator on some input
    function run({ estimator, input, options = {} }) {
        if (!input?.kind) throw new Error("DimensionLab.run: input.kind is required");
        // Find estimator requestned by id
        const est = get(estimator);
        
        if (typeof est.supports === "function" && !est.supports(input.kind)) {
            throw new Error(`Estimator "${estimator}" does not support kind "${input.kind}"`);
        }

        // Runs estimator and returns the result
        return est.run(input, options);
    }

    return { register, list, get, run };
})();