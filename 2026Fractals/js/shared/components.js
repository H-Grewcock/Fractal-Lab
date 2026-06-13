// js/shared/components.js:

export async function loadComponent(containerId, url) {
    // Finds element where component should be inserted
    const container = document.getElementById(containerId);
    // If no conainer, skip
    if (!container) {
        console.warn(`[components] Missing container #${containerId}`);
        return;
    }

    try {
        // Resolves URL relative to current page
        const resolvedUrl = new URL(url, document.baseURI).href;
        const response = await fetch(resolvedUrl, { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`Failed to load ${resolvedUrl}: ${response.statusText}`);
        }

        container.innerHTML = await response.text();
        // Loads navbar behaviour
        if (containerId === "nav-container") {
            initNavToggle();
            initThemeToggle();
            initNavDetailsBehaviour();
            initHoverRevealNavbar();
        }
    } catch (err) {
        // Log error for debugging
        console.error(err);
        // Shows error message if failure is visible
        container.innerHTML = `<p style="color:red;">Could not load content.</p>`;
    }
}

// Function to load both navbar and footer
export async function loadNavAndFooter({
    navId = "nav-container",
    footerId = "footer-container",
    navUrl = "components/navbar.html",
    footerUrl = "components/footer.html",
} = {}) {
    await loadComponent(navId, navUrl);
    await loadComponent(footerId, footerUrl);
}

// Function to control hamburger menu
export function initNavToggle() {
    const nav = document.querySelector(".nav");
    const menuToggle = document.getElementById("menuToggle");
    const navLinks = document.getElementById("navLinks");
    const menuIcon = document.getElementById("menuIcon");

    // If navbar HTML is missing, stop
    if (!nav || !menuToggle || !navLinks || !menuIcon) return;
    // Prevents binding same click listener more than once
    if (menuToggle.dataset.bound === "1") return;
    menuToggle.dataset.bound = "1";

    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-controls", "navLinks");

    // Closes mobile menu and resets icon/button state
    const closeMenu = () => {
        navLinks.classList.remove("visible");
        menuIcon.classList.remove("is-open");

        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Open navigation");
    };

    // Opens/closes menu when hamburger button is clicked
    menuToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        
        const isVisible = navLinks.classList.toggle("visible");
        // Changes hamburger icon
        menuIcon.classList.toggle("is-open", isVisible);

        // Keeps accessibility labels in sync with menu state
        menuToggle.setAttribute("aria-expanded", String(isVisible));
        menuToggle.setAttribute(
            "aria-label",
            isVisible ? "Close navigation" : "Open navigation"
        );
    });

    // Closes menu when cilcking outside the navbar
    document.addEventListener("click", (e) => {
        if (!nav.contains(e.target)) closeMenu();
    });
    // Closes menu when pressing 'escape'
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeMenu();
    });
}

// Function to control behaviour of dropdown groups inside the navbar
export function initNavDetailsBehaviour() {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    // Getting dropdown groups in navbar
    const groups = Array.from(navLinks.querySelectorAll("details.nav-group"));
    if (!groups.length) return;

    // One dropdown opens --> all others close
    groups.forEach((d) => {
        d.addEventListener("toggle", () => {
            if (!d.open) return;

            groups.forEach((other) => {
                if (other !== d) other.open = false;
            });
        });
    });

    // When nav link clicked, close dropdowns and collapse the mobile menu
    navLinks.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => {
            // Close all the dropdown groups
            groups.forEach((d) => (d.open = false));
            // Closes mobile nav links
            navLinks.classList.remove("visible");

            // Resets hamburger icon and button accessibility state
            const menuIcon = document.getElementById("menuIcon");
            const menuToggle = document.getElementById("menuToggle");
            
            if (menuIcon) {
                menuIcon.classList.remove("is-open");
            }
            
            if (menuToggle) {
                menuToggle.setAttribute("aria-expanded", "false");
                menuToggle.setAttribute("aria-label", "Open navigation");
            }
        });
    });
}

const THEME_KEY = "fractalTheme";   // "light" | "dark"

function applyTheme(theme) {
    // Colours controlled in CSS using: .theme-light, .theme-dark
    const root = document.documentElement;

    // Removes old theme class and then adds new one
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");

    const icon = document.getElementById("themeIcon");
    // Updating theme icon: dark mode shows sun icon, light mode shows moon icon    
    if (icon) {
        icon.classList.toggle("is-sun", theme === "dark");
        icon.classList.toggle("is-moon", theme !== "dark");
    }
}

// Function reads saved theme from localStorage
function storedTheme() {
    const t = localStorage.getItem(THEME_KEY);
    // Returns null if nothing valid stored yet
    return t === "dark" || t === "light" ? t : null;
}

export function initThemeToggle() {
    // Applies saved theme, or default to light mode
    applyTheme(storedTheme() || "light");
    const btn = document.getElementById("themeToggle");
    if (!btn) return;

    // Prevents binding same listener more than once
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";

    // Toggles between light and dark mode when clicked
    btn.addEventListener("click", () => {
        const isDark = document.documentElement.classList.contains("theme-dark");
        const next = isDark ? "light" : "dark";

        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
    });
}

// Keep the navbar visible on every page.
export function initHoverRevealNavbar() {
    const nav = document.querySelector(".nav");
    if (!nav) return;
    document.getElementById("navHoverTab")?.remove();
    nav.classList.add("nav--revealed");
}
