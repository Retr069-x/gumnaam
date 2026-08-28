/**
 * GUMNAAM PRODUCT CATALOG
 * --------------------------------------------------------------------------
 * Edit this array to change product names, prices, copy, stock, sizes or photos.
 * Prices are stored as numbers in PKR. Replace the sample values before launch.
 * Every image path points to the supplied photography copied into /assets.
 */
window.GUMNAAM_PRODUCTS = [
  {
    id: "obsidian",
    number: "01",
    name: "Obsidian Mark Hoodie",
    shortName: "Obsidian",
    price: 2499,
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
    number: "02",
    name: "Dune Script Hoodie",
    shortName: "Dune",
    price: 2499,
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
    number: "03",
    name: "Midnight Mark Hoodie",
    shortName: "Midnight",
    price: 2499,
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
    number: "04",
    name: "Field Mark Hoodie",
    shortName: "Field",
    price: 2499,
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

  const products = window.GUMNAAM_PRODUCTS;
  const money = (value) => `PKR ${value.toLocaleString("en-PK")}`;

  function productCard(product, index = 0) {
    const alternate = product.images[1] || product.images[0];

    return `
      <article class="product-card reveal" style="--reveal-delay: ${index * 70}ms">
        <a class="product-card__link" href="product.html?id=${product.id}" aria-label="View ${product.name}">
          <div class="product-card__media">
            <img class="product-card__image product-card__image--primary"
              src="${product.images[0]}" alt="${product.name}, styled view" loading="lazy">
            <img class="product-card__image product-card__image--alternate"
              src="${alternate}" alt="${product.name}, alternate view" loading="lazy">
            <span class="product-card__index">${product.number} / 04</span>
            <span class="product-card__view">View piece</span>
          </div>
          <div class="product-card__meta">
            <h3>${product.name}</h3>
            <p>${money(product.price)}</p>
          </div>
          <p class="product-card__sizes">Available sizes&nbsp; ${product.sizes.join(" / ")}</p>
        </a>
      </article>`;
  }

  function renderGrids() {
    document.querySelectorAll("[data-product-grid]").forEach((grid) => {
      const limit = Number(grid.dataset.limit) || products.length;
      grid.innerHTML = products.slice(0, limit).map(productCard).join("");
    });
  }

  function renderProductPage() {
    const shell = document.querySelector("[data-product-detail]");
    if (!shell) return;

    const params = new URLSearchParams(window.location.search);
    const product = products.find((item) => item.id === params.get("id")) || products[0];
    const mainImage = product.images[0];

    document.title = `${product.name} — Gumnaam`;

    shell.innerHTML = `
      <section class="product-view" aria-labelledby="product-title">
        <div class="product-gallery reveal">
          <div class="product-gallery__stage">
            <img data-gallery-main src="${mainImage}" alt="${product.name}" fetchpriority="high">
            <span class="product-gallery__count">01 / ${String(product.images.length).padStart(2, "0")}</span>
          </div>
          <div class="product-gallery__thumbs" aria-label="Product images">
            ${product.images
              .map(
                (image, index) => `
                  <button class="product-gallery__thumb${index === 0 ? " is-active" : ""}"
                    type="button" data-gallery-image="${image}" data-gallery-index="${index}"
                    aria-label="Show image ${index + 1}">
                    <img src="${image}" alt="" loading="lazy">
                  </button>`
              )
              .join("")}
          </div>
        </div>

        <div class="product-info reveal" style="--reveal-delay: 120ms">
          <p class="eyebrow">Drop 001 / Piece ${product.number}</p>
          <h1 id="product-title">${product.name}</h1>
          <p class="product-info__price">${money(product.price)}</p>
          <p class="product-info__description">${product.description}</p>

          <fieldset class="size-picker">
            <legend><span>Select size</span><button type="button" data-size-guide>Size guide</button></legend>
            <div class="size-picker__options">
              ${product.sizes
                .map(
                  (size) => `<button type="button" data-size="${size}" aria-pressed="false">${size}</button>`
                )
                .join("")}
            </div>
            <p class="size-picker__message" data-size-message aria-live="polite">Choose a size to continue.</p>
          </fieldset>

          <button class="button button--dark add-to-cart" type="button" data-add-product="${product.id}">
            <span>Add to bag</span><span>${money(product.price)}</span>
          </button>
          <p class="stock-note"><span class="stock-note__dot"></span>Only ${product.stock} left in this drop</p>

          <div class="product-accordions">
            <details>
              <summary>Details &amp; material <span>+</span></summary>
              <p>${product.material}</p>
            </details>
            <details>
              <summary>Fit <span>+</span></summary>
              <p>Relaxed unisex fit with a dropped shoulder. Take your usual size for an oversized silhouette.</p>
            </details>
            <details>
              <summary>Care <span>+</span></summary>
              <p>${product.care}</p>
            </details>
            <details>
              <summary>Delivery <span>+</span></summary>
              <p>Complimentary delivery across Pakistan. Orders are dispatched within 2–3 working days.</p>
            </details>
          </div>
        </div>
      </section>`;

    const relatedGrid = document.querySelector("[data-related-grid]");
    if (relatedGrid) {
      relatedGrid.innerHTML = products
        .filter((item) => item.id !== product.id)
        .slice(0, 3)
        .map(productCard)
        .join("");
    }

    bindProductPage(product);
  }

  function bindProductPage(product) {
    const main = document.querySelector("[data-gallery-main]");
    const count = document.querySelector(".product-gallery__count");

    document.querySelectorAll("[data-gallery-image]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.classList.contains("is-active")) return;

        document.querySelector(".product-gallery__thumb.is-active")?.classList.remove("is-active");
        button.classList.add("is-active");
        main.classList.add("is-changing");

        window.setTimeout(() => {
          main.src = button.dataset.galleryImage;
          main.alt = `${product.name}, view ${Number(button.dataset.galleryIndex) + 1}`;
          count.textContent = `${String(Number(button.dataset.galleryIndex) + 1).padStart(2, "0")} / ${String(product.images.length).padStart(2, "0")}`;
          main.classList.remove("is-changing");
        }, 140);
      });
    });

    const sizeButtons = document.querySelectorAll("[data-size]");
    const message = document.querySelector("[data-size-message]");

    sizeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        sizeButtons.forEach((option) => {
          option.classList.remove("is-selected");
          option.setAttribute("aria-pressed", "false");
        });
        button.classList.add("is-selected");
        button.setAttribute("aria-pressed", "true");
        message.textContent = `Size ${button.dataset.size} selected.`;
      });
    });

    document.querySelector("[data-add-product]")?.addEventListener("click", (event) => {
      const selected = document.querySelector("[data-size].is-selected");
      if (!selected) {
        message.textContent = "Please select a size first.";
        message.classList.add("has-error");
        document.querySelector(".size-picker")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      message.classList.remove("has-error");
      window.GumnaamCart?.add({ id: product.id, size: selected.dataset.size });

      const button = event.currentTarget;
      const original = button.innerHTML;
      button.classList.add("is-added");
      button.innerHTML = "<span>Added to bag</span><span>✓</span>";
      window.setTimeout(() => {
        button.classList.remove("is-added");
        button.innerHTML = original;
      }, 1600);
    });
  }

  function bindSort() {
    const select = document.querySelector("[data-product-sort]");
    const grid = document.querySelector("[data-shop-grid]");
    if (!select || !grid) return;

    select.addEventListener("change", () => {
      const sorted = [...products];
      if (select.value === "price-low") sorted.sort((a, b) => a.price - b.price);
      if (select.value === "price-high") sorted.sort((a, b) => b.price - a.price);
      if (select.value === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
      grid.innerHTML = sorted.map(productCard).join("");
      window.GumnaamReveal?.refresh();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderGrids();
    renderProductPage();
    bindSort();
  });
})();
