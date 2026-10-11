(function gumnaamStorefront() {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showToast(message) {
    let toast = document.querySelector(".site-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "site-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function setupHeader() {
    const header = document.querySelector(".site-header");
    if (!header) return;

    const syncHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
    syncHeader();
    window.addEventListener("scroll", syncHeader, { passive: true });

    const current = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    document.querySelectorAll(".desktop-nav a").forEach((link) => {
      const page = link.getAttribute("href")?.split("#")[0];
      const isShopSection = current === "product.html" && page === "shop.html";
      if (page === current || isShopSection) link.setAttribute("aria-current", "page");
    });
  }

  function setupMobileMenu() {
    const toggle = document.querySelector("[data-menu-toggle]");
    const menu = document.querySelector("[data-mobile-menu]");
    if (!toggle || !menu) return;

    const setMenu = (open) => {
      document.body.classList.toggle("menu-open", open);
      menu.classList.toggle("is-open", open);
      menu.setAttribute("aria-hidden", String(!open));
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };

    toggle.addEventListener("click", () => setMenu(!menu.classList.contains("is-open")));
    menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setMenu(false);
    });
  }

  function setupReveal() {
    let observer;

    const observe = () => {
      const pending = document.querySelectorAll(".reveal:not(.is-visible)");
      if (reducedMotion || !("IntersectionObserver" in window)) {
        pending.forEach((element) => element.classList.add("is-visible"));
        return;
      }

      if (!observer) {
        observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            });
          },
          { rootMargin: "0px 0px -8%", threshold: 0.12 }
        );
      }
      pending.forEach((element) => observer.observe(element));
    };

    window.GumnaamReveal = { refresh: observe };
    observe();
  }

  function setupParallax() {
    const hero = document.querySelector("[data-parallax]");
    if (!hero || reducedMotion || !window.matchMedia("(pointer: fine)").matches) return;
    const image = hero.querySelector("img");
    if (!image) return;

    hero.addEventListener("pointermove", (event) => {
      const bounds = hero.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      image.style.transform = `scale(1.035) translate(${x * -9}px, ${y * -9}px)`;
    });
    hero.addEventListener("pointerleave", () => {
      image.style.transform = "scale(1.035) translate(0, 0)";
    });
  }

  function setupPageTransitions() {
    window.requestAnimationFrame(() => document.body.classList.add("page-ready"));
    if (reducedMotion) return;

    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || link.target === "_blank" || link.hasAttribute("download")) return;

      const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
      if (samePage && url.hash) {
        const target = document.querySelector(url.hash);
        if (target) {
          event.preventDefault();
          target.scrollIntoView({ behavior: "smooth" });
        }
        return;
      }

      if (!/\.html$/i.test(url.pathname)) return;
      event.preventDefault();
      document.body.classList.add("page-leaving");
      window.setTimeout(() => {
        window.location.href = url.href;
      }, 320);
    });
  }

  function setupNewsletter() {
    document.querySelectorAll("[data-newsletter]").forEach((form) => {
      const input = form.querySelector("input[type='email']");
      const response = form.querySelector("[data-form-response]");

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
        response.classList.toggle("has-error", !valid);
        response.textContent = valid
          ? "You’re on the list. Stay unseen."
          : "Enter a valid email address.";

        if (valid) {
          form.classList.add("is-success");
          input.value = "";
          // Connect Mailchimp, Klaviyo or your own endpoint here.
        }
      });
    });
  }

  function setupUtilityActions() {
    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-size-guide]")) return;
      showToast("Relaxed fit · S–XL · Take your usual size");
    });

    document.querySelectorAll("[data-current-year]").forEach((node) => {
      node.textContent = new Date().getFullYear();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupHeader();
    setupMobileMenu();
    setupReveal();
    setupParallax();
    setupPageTransitions();
    setupNewsletter();
    setupUtilityActions();
  });
})();
