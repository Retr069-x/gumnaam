globalThis.GUMNAAM_PRODUCTS = [
  {
    id: "obsidian",
    colour: "Black",
    category: "hoodies",
    number: "01",
    name: "Black Hoodie",
    shortName: "Black",
    price: 1999,
    stock: 6,
    description:
      "A heavyweight black pullover cut with a relaxed shoulder and finished with the Gumnaam mark at the chest.",
    images: [
      "assets/black-model.jpg",
      "assets/black-front.jpg",
      "assets/black-back.jpg",
      "assets/black-closeup.jpg",
      "assets/black-detail.jpg",
    ],
    sizes: ["S", "M", "L", "XL"],
    material: "420 GSM brushed cotton fleece. Ribbed cuff and hem. Metal-tipped drawcord.",
    care: "Cold wash inside out. Wash with like colours. Line dry. Do not iron the mark.",
  },
  {
    id: "camel",
    colour: "Camel",
    category: "hoodies",
    number: "02",
    name: "Camel Hoodie",
    shortName: "Camel",
    price: 1999,
    stock: 4,
    description:
      "A warm neutral heavyweight layer carrying an expressive script across the chest and a clean, oversized silhouette.",
    images: [
      "assets/camel-model.jpg",
      "assets/camel-front.jpg",
      "assets/camel-back.jpg",
      "assets/camel-closeup.jpg",
      "assets/camel-detail.jpg",
    ],
    sizes: ["S", "M", "L", "XL"],
    material: "420 GSM brushed cotton fleece. Double-layer hood. Tonal rib and flat drawcord.",
    care: "Cold wash inside out. Wash with like colours. Line dry. Do not iron the artwork.",
  },
  {
    id: "navy",
    colour: "Navy Blue",
    category: "hoodies",
    number: "03",
    name: "Navy Blue Hoodie",
    shortName: "Navy Blue",
    price: 1999,
    stock: 8,
    description:
      "A deep midnight essential with a quiet chest mark, generous hood and an easy everyday drape.",
    images: [
      "assets/navy-model.png",
      "assets/navy-front.jpg",
      "assets/navy-closeup.jpg",
      "assets/navy-detail.jpg",
    ],
    sizes: ["S", "M", "L", "XL"],
    material: "400 GSM cotton-rich fleece. Kangaroo pocket. Reinforced ribbed finishes.",
    care: "Cold wash inside out. Wash with like colours. Line dry. Do not tumble dry.",
  },
  {
    id: "olive",
    colour: "Olive Green",
    category: "hoodies",
    number: "04",
    name: "Olive Green Hoodie",
    shortName: "Olive Green",
    price: 1999,
    stock: 3,
    description:
      "A grounded, minimal pullover with the Gumnaam mark placed discreetly over the heart and a layered street fit.",
    images: [
      "assets/olive-model.png",
      "assets/olive-front.jpg",
      "assets/olive-closeup.jpg",
      "assets/olive-detail.jpg",
    ],
    sizes: ["S", "M", "L", "XL"],
    material: "400 GSM brushed cotton fleece. Double-layer hood. Ribbed cuff and hem.",
    care: "Cold wash inside out. Wash with like colours. Line dry. Do not bleach.",
  },
];

(function productCatalog() {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const products = window.GUMNAAM_PRODUCTS;
  const money = (value) => `PKR ${value.toLocaleString("en-PK")}`;
  const media = (src, alt, classes = "", eager = false) => `<picture><source srcset="${src.replace(/\.(jpg|png)$/, ".webp")}" type="image/webp"><img class="${classes}" src="${src}" alt="${alt}" width="812" height="1024" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}></picture>`;

  function productCard(product) {
    return `<article class="product-card reveal" data-product-id="${product.id}"><a class="product-card__link" href="product.html?id=${product.id}" aria-label="View ${product.name}"><div class="product-card__media">${media(product.images[1] || product.images[0], product.name + ", front view", "product-card__image product-card__image--primary")}${media(product.images[0], product.name + ", worn view", "product-card__image product-card__image--alternate")}<span class="product-card__index">${product.number} / 04</span></div><div class="product-card__meta"><h3>${product.name}</h3><p>${money(product.price)}</p></div><p class="product-card__sizes">Heavyweight fleece / S–XL</p></a><div class="product-quick"><select aria-label="Quick add size for ${product.name}" data-quick-size><option value="">Size</option>${product.sizes.map((size) => `<option>${size}</option>`).join("")}</select><button type="button" data-quick-add="${product.id}">Quick add +</button></div></article>`;
  }
  function renderGrids() {
    document.querySelectorAll("[data-product-grid]").forEach((grid) => { grid.innerHTML = products.slice(0, Number(grid.dataset.limit) || products.length).map(productCard).join(""); });
  }
  function renderProductPage() {
    const shell = document.querySelector("[data-product-detail]");
    if (!shell) return;
    const params = new URLSearchParams(location.search);
    const product = products.find((item) => item.id === params.get("id"));
    if (!product) {
      shell.innerHTML = '<section class="editorial-heading"><p class="eyebrow">Piece / Not found</p><h1>This form is unknown.</h1><a class="text-link" href="shop.html">Return to the first four ↗</a></section>';
      document.title = "Piece not found — Gumnaam"; return;
    }
    document.title = `${product.name} — Gumnaam`;
    document.querySelector('meta[name="description"]').content = product.description;
    document.querySelector('meta[property="og:title"]').content = document.title;
    document.querySelector('meta[property="og:description"]').content = product.description;
    document.querySelector('meta[property="og:image"]').content = new URL(product.images[0], location.href).href;
    document.querySelector('link[rel="canonical"]').href = `https://www.gumnaamofficial.com/product?id=${product.id}`;
    shell.innerHTML = `<section class="product-view" aria-labelledby="product-title"><div class="product-gallery reveal"><div class="product-gallery__stage">${media(product.images[1] || product.images[0], product.name, "", true)}<span class="product-gallery__count">02 / ${String(product.images.length).padStart(2, "0")}</span></div><div class="product-gallery__thumbs" aria-label="Product images">${product.images.map((image, index) => `<button class="product-gallery__thumb${index === 1 ? " is-active" : ""}" type="button" data-gallery-image="${image}" data-gallery-index="${index}" aria-pressed="${index === 1}" aria-label="Show image ${index + 1}">${media(image, "")}</button>`).join("")}</div></div><div class="product-info reveal"><p class="eyebrow">Drop 001 / Piece ${product.number}</p><h1 id="product-title">${product.colour}<br>Hoodie.</h1><p class="product-info__price">${money(product.price)} <span>/ PKR 200 delivery per order</span></p><p class="product-info__description">${product.description}</p><fieldset class="size-picker"><legend><span>Select your size</span><a href="size-guide.html">Size guide ↗</a></legend><div class="size-picker__options">${product.sizes.map((size) => `<button type="button" data-size="${size}" aria-pressed="false">${size}</button>`).join("")}</div><p class="size-picker__message" data-size-message role="status">Choose a size to continue.</p></fieldset><label class="product-quantity">Quantity<input data-product-quantity type="number" value="1" min="1" max="${Math.min(10, product.stock)}" step="1" inputmode="numeric" aria-label="Quantity"></label><button class="button button--dark" type="button" data-add-product="${product.id}"><span>Add to bag</span><span>+</span></button><button class="button button--light buy-now" type="button" data-buy-product="${product.id}"><span>Buy now</span><span>↗</span></button><p class="stock-note">Small run / Availability confirmed before dispatch.</p><div class="product-accordions"><details><summary>Details &amp; fabric<span>+</span></summary><p>${product.material}</p></details><details><summary>The fit<span>+</span></summary><p>Relaxed unisex fit with a dropped shoulder. Take your usual size for an oversized silhouette. <a href="size-guide.html">Ask us for garment measurements.</a></p></details><details><summary>Care<span>+</span></summary><p>${product.care}</p></details><details><summary>Shipping &amp; returns<span>+</span></summary><p>Delivery across Pakistan. PKR 200 once per order, for COD or Easypaisa. We confirm stock before dispatch. <a href="shipping.html">Read the details.</a></p></details></div></div></section>`;
    const gallery = shell.querySelector(".product-gallery__stage");
    shell.querySelectorAll("[data-gallery-image]").forEach((button) => button.addEventListener("click", () => {
      shell.querySelectorAll("[data-gallery-image]").forEach((node) => { node.classList.toggle("is-active", node === button); node.setAttribute("aria-pressed", String(node === button)); });
      const image = gallery.querySelector("img");
      image.src = button.dataset.galleryImage;
      gallery.querySelector("source").srcset = button.dataset.galleryImage.replace(/\.(jpg|png)$/, ".webp");
      gallery.querySelector(".product-gallery__count").textContent = `${String(Number(button.dataset.galleryIndex) + 1).padStart(2, "0")} / ${String(product.images.length).padStart(2, "0")}`;
    }));
    let size = "";
    const message = shell.querySelector("[data-size-message]");
    shell.querySelectorAll("[data-size]").forEach((button) => button.addEventListener("click", () => {
      size = button.dataset.size;
      shell.querySelectorAll("[data-size]").forEach((option) => { option.classList.toggle("is-selected", option === button); option.setAttribute("aria-pressed", String(option === button)); });
      message.textContent = `Size ${size} selected.`;
    }));
    const selection = () => {
      const quantity = Number(shell.querySelector("[data-product-quantity]").value);
      if (!size) throw new Error("Choose your size first.");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(10, product.stock)) throw new Error("Choose an available quantity.");
      return { productId: product.id, size, quantity };
    };
    shell.querySelector("[data-add-product]").addEventListener("click", () => { try { window.GumnaamCart.add(selection()); } catch (error) { message.textContent = error.message; } });
    shell.querySelector("[data-buy-product]").addEventListener("click", () => { try { location.href = `checkout.html?${new URLSearchParams({ id: product.id, size: selection().size, quantity: selection().quantity })}`; } catch (error) { message.textContent = error.message; } });
    const related = document.querySelector("[data-related-grid]");
    if (related) related.innerHTML = products.filter((item) => item.id !== product.id).map(productCard).join("");
  }
  function filters() {
    const grid = document.querySelector("[data-shop-grid]");
    if (!grid) return;
    const sort = document.querySelector("[data-product-sort]");
    const size = document.querySelector("[data-product-size]");
    const category = document.querySelector("[data-product-category]");
    const update = () => {
      const previous = new Map([...grid.children].map((node) => [node.dataset.productId, node.getBoundingClientRect()]));
      const result = products.filter((p) => (!size.value || p.sizes.includes(size.value)) && (category.value === "all" || p.category === category.value));
      if (sort.value === "price-low") result.sort((a, b) => a.price - b.price);
      if (sort.value === "price-high") result.sort((a, b) => b.price - a.price);
      if (sort.value === "name") result.sort((a, b) => a.name.localeCompare(b.name));
      grid.innerHTML = result.map(productCard).join("");
      const count = document.querySelector("[data-product-count]");
      count.textContent = String(result.length).padStart(2, "0");
      document.querySelector("[data-catalog-empty]").hidden = result.length > 0;
      if (window.gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        for (const node of grid.children) {
          const before = previous.get(node.dataset.productId);
          if (!before) continue;
          const after = node.getBoundingClientRect();
          gsap.fromTo(node, { x: before.left - after.left, y: before.top - after.top }, { x: 0, y: 0, duration: .7, ease: "power4.out", clearProps: "transform" });
        }
        gsap.fromTo(count, { opacity: .3 }, { opacity: 1, duration: .6 });
      }
      window.GumnaamReveal?.refresh();
    };
    [sort, size, category].forEach((node) => node.addEventListener("change", update));
    update();
  }
  document.addEventListener("DOMContentLoaded", () => {
    renderGrids(); renderProductPage(); filters();
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-quick-add]");
      if (!button) return;
      const size = button.closest(".product-card").querySelector("[data-quick-size]");
      if (!size.value) { size.focus(); return; }
      try { window.GumnaamCart.add({ productId: button.dataset.quickAdd, size: size.value, quantity: 1 }); }
      catch (error) { const toast = document.querySelector("[data-toast]"); toast.textContent = error.message; toast.classList.add("is-visible"); setTimeout(() => toast.classList.remove("is-visible"), 3000); }
    });
  });
})();
