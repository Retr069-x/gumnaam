(function gumnaamStorefront() {
  "use strict";
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motion = window.GUMNAAM_CHECKOUT?.motion || { duration: .8, ease: "power4.out", stagger: .08 };
  let animationContext;
  let lastScroll = 0;
  let transitionTimer;
  let menuFocus;

  function setup() {
    const header = document.querySelector(".site-header");
    const menu = document.querySelector("#mobile-menu");
    const toggle = document.querySelector("[data-menu-toggle]");
    const setMenu = (open) => {
      if (open) {
        menuFocus = document.activeElement;
        menu.showModal();
        toggle.setAttribute("aria-expanded", "true");
        window.GumnaamLenis?.stop();
        if (!preference.matches && window.gsap) gsap.fromTo(menu.querySelectorAll("nav a"), { y: 30, opacity: 0 }, { y: 0, opacity: 1, ...motion, stagger: motion.stagger });
      } else menu.close();
    };
    toggle?.addEventListener("click", () => setMenu(true));
    menu?.querySelector("[data-menu-close]")?.addEventListener("click", () => setMenu(false));
    menu?.addEventListener("close", () => { toggle?.setAttribute("aria-expanded", "false"); window.GumnaamLenis?.start(); menuFocus?.focus(); });
    const path = window.location.pathname.split("/").pop().replace(".html", "") || "index";
    document.querySelectorAll(".desktop-nav a").forEach((link) => { if (link.getAttribute("href").replace(".html", "") === path || (path === "product" && link.getAttribute("href") === "shop.html")) link.setAttribute("aria-current", "page"); });
    window.addEventListener("scroll", () => {
      const y = window.scrollY;
      if (Math.abs(y - lastScroll) > 8) {
        header?.classList.toggle("is-hidden", y > lastScroll && y > 160 && !header.contains(document.activeElement) && !document.querySelector("dialog[open]"));
        lastScroll = y;
      }
    }, { passive: true });
    header?.addEventListener("focusin", () => header.classList.remove("is-hidden"));

    const loader = document.querySelector(".preloader");
    let firstVisit = false;
    try { firstVisit = !sessionStorage.getItem("gumnaam-visited"); sessionStorage.setItem("gumnaam-visited", "1"); } catch {}
    if (firstVisit && !preference.matches && loader) {
      loader.hidden = false;
      setTimeout(() => { loader.hidden = true; }, 1900);
    }
    if (window.gsap && window.ScrollTrigger && !preference.matches) {
      gsap.registerPlugin(ScrollTrigger);
      animationContext = gsap.context(() => {
        if (document.querySelector(".hero-line")) gsap.fromTo(".hero-line > span", { yPercent: 110 }, { yPercent: 0, ...motion, duration: 1.1, stagger: .13, delay: firstVisit ? 1.1 : .1 });
        if (document.querySelector(".hero-figure")) gsap.to(".hero-figure picture", { yPercent: 5, scale: 1.035, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
        gsap.utils.toArray(".study-frame img").forEach((image) => gsap.fromTo(image, { clipPath: "inset(10% 0% 10% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", ease: "none", scrollTrigger: { trigger: image, start: "top 95%", end: "top 30%", scrub: true } }));
      });
      if (window.Lenis && window.matchMedia("(pointer: fine)").matches && !document.querySelector("#checkout-form")) {
        window.GumnaamLenis = new Lenis({ autoRaf: true, anchors: true, duration: 1.05 });
        window.GumnaamLenis.on("scroll", ScrollTrigger.update);
      }
    }
    preference.addEventListener("change", () => {
      if (!preference.matches) return;
      animationContext?.revert();
      window.GumnaamLenis?.destroy();
      window.GumnaamLenis = null;
      if (loader) loader.hidden = true;
    });

    let observer;
    const observe = () => {
      const pending = document.querySelectorAll(".reveal:not(.is-visible)");
      if (preference.matches || !("IntersectionObserver" in window)) { pending.forEach((node) => node.classList.add("is-visible")); return; }
      observer ||= new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        if (window.gsap && !preference.matches) gsap.fromTo(entry.target, { y: 20, opacity: 0 }, { y: 0, opacity: 1, ...motion, clearProps: "transform,opacity" });
        observer.unobserve(entry.target);
      }), { threshold: .08 });
      pending.forEach((node) => observer.observe(node));
    };
    window.GumnaamReveal = { refresh: observe };
    observe();

    document.querySelectorAll(".marquee-pause").forEach((button) => button.addEventListener("click", () => {
      const paused = button.closest(".marquee").classList.toggle("is-paused");
      button.setAttribute("aria-pressed", String(paused));
      button.setAttribute("aria-label", paused ? "Resume moving text" : "Pause moving text");
      button.textContent = paused ? "Play" : "Pause";
    }));
    document.querySelectorAll("details").forEach((item) => item.addEventListener("toggle", () => {
      if (item.open && window.gsap && !preference.matches) gsap.fromTo(item.querySelector("div") || item.querySelector("p"), { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: .6, ease: motion.ease, clearProps: "transform,opacity" });
    }));
    document.querySelectorAll("[data-payment-title]").forEach((node) => { node.textContent = window.GUMNAAM_CHECKOUT.easypaisa.title; });
    document.querySelectorAll("[data-payment-account]").forEach((node) => { node.textContent = window.GUMNAAM_CHECKOUT.easypaisa.account; });
    document.querySelectorAll("[data-current-year]").forEach((node) => { node.textContent = new Date().getFullYear(); });

    document.querySelectorAll("[data-newsletter], [data-contact]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const newsletter = form.hasAttribute("data-newsletter");
      const email = form.elements.email.value.trim();
      const subject = newsletter ? "Gumnaam / Join the list" : "Gumnaam / A quiet conversation";
      const body = newsletter ? `Please add ${email} to the Gumnaam release list.\nI consent to release announcements and can request removal by email.` : `${form.elements.message.value.trim()}\n\nFrom: ${form.elements.name.value.trim()}\nReply to: ${email}`;
      window.location.href = `mailto:${window.GUMNAAM_CHECKOUT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      form.querySelector("[data-form-response]").textContent = "Your email draft is ready. Send it in your mail app to deliver it. If no app opened, use the email link or Instagram.";
    }));
    const confirmation = document.querySelector("[data-confirmation]");
    if (confirmation) {
      try {
        const receipt = JSON.parse(sessionStorage.getItem("gumnaam-confirmation") || "null");
        if (receipt && Date.now() - receipt.createdAt < 86400000 && /^GM-[A-F0-9]{16}$/.test(receipt.reference) && Number.isInteger(receipt.total)) {
          confirmation.replaceChildren();
          for (const text of [`Reference: ${receipt.reference}`, `Total: PKR ${receipt.total.toLocaleString("en-PK")}`, ...receipt.lines.map((line) => `${line.name} / ${line.size} / ${line.quantity}`), "Your order is a request, not yet confirmed. We’ll confirm availability and payment on WhatsApp."]) {
            const p = document.createElement("p"); p.textContent = text; confirmation.append(p);
          }
        }
      } catch {}
    }

    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank" || link.hasAttribute("download") || link.getAttribute("aria-disabled") === "true") return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol)) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (preference.matches) return;
      event.preventDefault();
      document.body.classList.add("page-leaving");
      clearTimeout(transitionTimer);
      transitionTimer = setTimeout(() => location.assign(url.href), 550);
    });
    window.addEventListener("pageshow", () => { document.body.classList.remove("page-leaving"); header?.classList.remove("is-hidden"); });
  }
  document.addEventListener("DOMContentLoaded", setup);
})();
