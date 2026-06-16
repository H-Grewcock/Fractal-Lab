// Shared MathJax loader and re-typesetting helper for dynamic readouts.
const MATHJAX_SCRIPT_ID = "mathjax-script";
let mathJaxPromise = null;

function loadMathJax() {
    if (!mathJaxPromise) {
        window.MathJax = window.MathJax || {
            tex: {
                inlineMath: [["\\(", "\\)"]],
                displayMath: [["\\[", "\\]"]],
            },
            options: {
                skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"],
            },
        };

        mathJaxPromise = new Promise((resolve, reject) => {
            if (window.MathJax?.typesetPromise) {
                resolve(window.MathJax);
                return;
            }

            let script = document.getElementById(MATHJAX_SCRIPT_ID);
            if (!script) {
                script = document.createElement("script");
                script.id = MATHJAX_SCRIPT_ID;
                script.async = true;
                script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
                script.onerror = () => reject(new Error("Could not load MathJax."));
                document.head.appendChild(script);
            }

            script.addEventListener("load", () => resolve(window.MathJax), { once: true });
        });
    }

    return mathJaxPromise;
}

export function initMathJax(root = document.body) {
    loadMathJax();
    return typesetMath(root);
}

export async function typesetMath(root = document.body) {
    try {
        const mathJax = await loadMathJax();
        await mathJax.startup?.promise;
        mathJax.typesetClear?.([root]);
        await mathJax.typesetPromise?.([root]);
    } catch (err) {
        console.warn("[mathjax] Typesetting failed", err);
    }
}
