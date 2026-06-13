// js/pages/basePage.js:
import { loadNavAndFooter } from "../shared/components.js";

// Function to highlight the current page in the navbar
function highlightActiveNavLink({ openParentDetails = true } = {}) {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    // Gets current file name from the URL
    const path = window.location.pathname.split("/").pop() || "index.html";
    const full = path + window.location.hash;
    // Clears any old active state first
    navLinks.querySelectorAll("a.nav-link, a.nav-item").forEach((a) => {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
    });

    // Gets all links in the navbar
    const candidates = Array.from(navLinks.querySelectorAll("a[href]"));
    // Finding active link
    // If doesn't find by exact file + hash match, then matches the file name
    const active =
        candidates.find((a) => (a.getAttribute("href") || "") === full) ||
        candidates.find((a) => (a.getAttribute("href") || "") === path);
    if (!active) return;

    active.classList.add("is-active");
    active.setAttribute("aria-current", "page");

    // If active link is inside a dropdown group, open the group
    if (openParentDetails) {
        const parentDetails = active.closest("details.nav-group");
        if (parentDetails) parentDetails.open = true;
    }
}

// Function to apply saved theme before the navbar is initialised fully
// Prevents flash of the wrong theme when the page first loads
function applyStoredThemeEarly() {
    const t = localStorage.getItem("fractalTheme");
    const theme = (t === "dark" || t === "light") ? t : "light";    // Two valid stored values; otehrwise, default to light mode

    const root = document.documentElement;
    // Removes existing theme class
    root.classList.remove("theme-light", "theme-dark");
    // Adds the selected theme class
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
}

export async function initBasePage({
    setTitleSuffix = true,
    titleSuffix = "Fractal Lab",
    highlightNav = true,
    openParentDetails = true,
    revealNavOnHome = true,
} = {}) {
    // Applies theme before loading components
    applyStoredThemeEarly();
    // Loads shared navbar and footer HTML
    await loadNavAndFooter({
        navUrl: "components/navbar.html",
        footerUrl: "components/footer.html",
    });

    // Checks if current page is the homepage
    const isHome = (window.location.pathname.split("/").pop() || "index.html") === "index.html";
    // Ensures navbar visible on homepage if wanted
    if (revealNavOnHome && isHome) {
        document.querySelector(".nav")?.classList.add("nav--revealed");
    }

    // Highlights current nav link after the navbar has loaded
    if (highlightNav) {
        highlightActiveNavLink({ openParentDetails });
    }

    // Adds share dtitle suffix
    if (setTitleSuffix) {
        const t = document.title || "";
        // Includes check to avoid adding the suffix twice
        if (!t.includes(titleSuffix)) {
            document.title = t ? `${t} - ${titleSuffix}` : titleSuffix;
        }
    }

}
