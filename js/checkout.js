(function checkout() {
  "use strict";

  const form = document.querySelector("#checkout-form");
  if (!form) return;
  const catalog = window.GUMNAAM_PRODUCTS;
  const config = window.GUMNAAM_CHECKOUT || {};
  const productSelect = form.elements.productId;
  const sizeSelect = form.elements.size;
  const submit = form.querySelector('[type="submit"]');
  const status = document.querySelector("#checkout-status");
  const money = (value) => `PKR ${value.toLocaleString("en-PK")}`;
  let ready = false;
  let busy = false;
  let completed = false;
  let captchaToken = "";
  let captchaId;
  let requestKey;
  let lastPayload;
  let endpoint;

  for (const product of catalog) {
    productSelect.add(new Option(product.name, product.id));
  }
  const params = new URLSearchParams(window.location.search);
  if (catalog.some((product) => product.id === params.get("id"))) productSelect.value = params.get("id");

  function piece() {
    return catalog.find((product) => product.id === productSelect.value);
  }

  function fillSizes(selected = "") {
    sizeSelect.replaceChildren(new Option("Choose size", ""));
    for (const size of piece().sizes) sizeSelect.add(new Option(size, size));
    if (piece().sizes.includes(selected)) sizeSelect.value = selected;
    form.elements.quantity.max = Math.min(10, piece().stock);
    if (Number(form.elements.quantity.value) > Number(form.elements.quantity.max)) form.elements.quantity.value = form.elements.quantity.max;
  }

  function update() {
    const product = piece();
    const quantity = Number(form.elements.quantity.value);
    const validQuantity = Number.isInteger(quantity) && quantity > 0 && quantity <= Math.min(10, product.stock);
    const prepaid = form.elements.paymentMethod.value === "easypaisa";
    const fee = prepaid ? 0 : 200;
    const subtotal = validQuantity ? quantity * product.price : null;
    document.querySelector("#summary-image").src = product.images[1] || product.images[0];
    document.querySelector("#summary-image").alt = product.name;
    document.querySelector("#summary-name").textContent = product.name;
    document.querySelector("#summary-size").textContent = sizeSelect.value ? `Size ${sizeSelect.value}` : "Choose your size";
    document.querySelector("#summary-quantity").textContent = validQuantity ? `/ ${quantity}` : "/ —";
    document.querySelector("#summary-subtotal").textContent = subtotal === null ? "—" : money(subtotal);
    document.querySelector("#summary-fee").textContent = money(fee);
    document.querySelector("#summary-total").textContent = subtotal === null ? "—" : money(subtotal + fee);
    document.querySelector("[data-payment-total]").textContent = subtotal === null ? "Choose a valid quantity" : money(subtotal);
    document.querySelector("#summary-payment").textContent = prepaid ? "Transfer the exact total. Your payment is checked manually before confirmation." : "Pay on delivery. PKR 200 COD charge is applied once per order.";
    document.querySelector("#easypaisa-panel").hidden = !prepaid;
    for (const field of [form.elements.transactionId, form.elements.receipt]) {
      field.disabled = !prepaid;
      field.required = prepaid;
    }
    submit.disabled = !ready || busy || completed || !captchaToken;
  }

  productSelect.addEventListener("change", () => { fillSizes(); update(); });
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  fillSizes(params.get("size"));
  update();

  function unavailable() {
    ready = false;
    status.textContent = "Online checkout is not open yet. Please message us on Instagram to order. Do not transfer money for this checkout until it is open.";
    update();
  }

  async function setup() {
    if (!config.endpoint || !config.turnstileSiteKey || !window.crypto?.randomUUID) return unavailable();
    try {
      endpoint = new URL(config.endpoint);
      if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") return unavailable();
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000), cache: "no-store" });
      const health = await response.json();
      if (!response.ok || !health.ready) return unavailable();
      ready = true;
      form.querySelector('[value="easypaisa"]').disabled = false;
      window.onGumnaamCaptchaReady = () => {
        captchaId = window.turnstile.render("#checkout-captcha", {
          sitekey: config.turnstileSiteKey,
          theme: "light",
          action: "checkout",
          callback: (token) => { captchaToken = token; status.textContent = "Review your total, then place your order."; update(); },
          "expired-callback": () => { captchaToken = ""; status.textContent = "Please complete the security check again."; update(); },
          "error-callback": () => { captchaToken = ""; status.textContent = "The security check could not load. Please retry or message us on Instagram."; update(); }
        });
      };
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onGumnaamCaptchaReady&render=explicit";
      script.async = true;
      script.onerror = unavailable;
      document.head.append(script);
      status.textContent = "Complete the security check to continue.";
    } catch { unavailable(); }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ready || busy || completed || !captchaToken || !form.reportValidity()) return;
    const phone = form.elements.phone.value.replace(/[\s()+-]/g, "");
    form.elements.phone.setCustomValidity(/^(?:03\d{9}|923\d{9})$/.test(phone) ? "" : "Enter a Pakistan mobile number, such as 03001234567.");
    if (!form.elements.phone.reportValidity()) return;
    const prepaid = form.elements.paymentMethod.value === "easypaisa";
    const receipt = prepaid ? form.elements.receipt.files[0] : null;
    if (prepaid && (!receipt || !["image/jpeg", "image/png", "image/webp"].includes(receipt.type) || receipt.size > 4194304 || receipt.size === 0)) {
      status.textContent = "Choose a JPG, PNG or WebP payment screenshot smaller than 4 MB.";
      return;
    }
    const order = {
      productId: productSelect.value,
      size: sizeSelect.value,
      quantity: Number(form.elements.quantity.value),
      customerName: form.elements.customerName.value.trim(),
      phone,
      city: form.elements.city.value.trim(),
      address: form.elements.address.value.trim(),
      email: form.elements.email.value.trim(),
      notes: form.elements.notes.value.trim(),
      paymentMethod: form.elements.paymentMethod.value,
      transactionId: prepaid ? form.elements.transactionId.value.trim() : "",
      consent: form.elements.consent.checked
    };
    const signature = JSON.stringify(order) + (receipt ? `${receipt.name}:${receipt.size}:${receipt.lastModified}` : "");
    if (!requestKey || signature !== lastPayload) requestKey = window.crypto.randomUUID();
    lastPayload = signature;
    order.requestKey = requestKey;
    const payload = new FormData();
    payload.set("order", JSON.stringify(order));
    payload.set("token", captchaToken);
    if (receipt) payload.set("receipt", receipt);
    busy = true;
    update();
    status.textContent = "Submitting your order. Please keep this page open.";
    const fields = [...form.querySelectorAll("input, select, textarea")];
    const disabled = fields.map((field) => field.disabled);
    fields.forEach((field) => { field.disabled = true; });
    try {
      const response = await fetch(endpoint, { method: "POST", body: payload, signal: AbortSignal.timeout(45000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your order could not be submitted. Please retry.");
      if (!/^GM-[A-F0-9]{16}$/.test(result.reference) || !Number.isInteger(result.total)) throw new Error("The server response could not be verified. Please retry using the same details.");
      completed = true;
      document.querySelector("[data-checkout-layout]").hidden = true;
      const panel = document.querySelector("#order-result");
      document.querySelector("#result-reference").textContent = result.reference;
      document.querySelector("#result-total").textContent = `Order total: ${money(result.total)}.`;
      document.querySelector("#result-message").textContent = prepaid ? "Your order and screenshot have been received. Payment is still pending verification. We’ll confirm on WhatsApp after checking the transfer." : "Your order request has been received. We’ll confirm availability and delivery on WhatsApp. Pay the total when your parcel arrives.";
      panel.hidden = false;
      panel.focus();
      panel.scrollIntoView({ behavior: "instant", block: "start" });
      form.reset();
    } catch (error) {
      status.textContent = error.name === "TimeoutError" || error.name === "TypeError" ? "We could not verify the response. Retry with the same details to avoid a duplicate order. Do not transfer again." : error.message;
    } finally {
      fields.forEach((field, index) => { field.disabled = disabled[index]; });
      busy = false;
      captchaToken = "";
      if (window.turnstile && captchaId !== undefined) window.turnstile.reset(captchaId);
      if (!completed) update();
    }
  });

  form.elements.phone.addEventListener("input", () => form.elements.phone.setCustomValidity(""));
  setup();
})();
