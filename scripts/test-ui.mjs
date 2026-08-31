import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const root = resolve(import.meta.dirname, "..");
const model = readFileSync(resolve(root, "assets/js/verde-commerce.js"), "utf8");
const shared = readFileSync(resolve(root, "assets/js/verde-polish.js"), "utf8");
const fixture = `<!doctype html><html lang="en"><body>
  <header><nav><a href="index.html">Home</a><a href="verde-market-shop-page.html">Shop</a></nav>
    <button aria-label="Cart">Cart</button><button aria-label="Open menu">Menu</button>
  </header>
  <main><h1>Seasonal harvest</h1>
    <article class="product-card" data-product="avocado" data-price="1.99">
      <h2>Hass Avocados</h2><p>$1.99 each</p><button aria-label="Add to cart: Hass Avocados">Add</button>
    </article>
    <button data-story-dialog>Explore the harvest story</button>
    <form><label>Email<input required type="email"></label>
      <button type="submit" aria-label="Subscribe"><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>
    </form>
  </main>
</body></html>`;

async function boot(html = fixture, page = "index.html", storage = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(html, { url: `https://verde.test/${page}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.getClientRects = function () {
    return this.closest("[hidden]") ? [] : [{ width: 44, height: 44 }];
  };
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, JSON.stringify(value));
  if (window.document.readyState === "loading") await new Promise((done) => window.document.addEventListener("DOMContentLoaded", done, { once: true }));
  const timers = [];
  window.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  window.eval(model);
  window.eval(shared);
  return { dom, window, document: window.document, errors, timers };
}

test("closed drawers are inert; opening traps focus and Escape restores the trigger", async () => {
  const { dom, window, document } = await boot();
  try {
    const trigger = document.querySelector(".verde-menu-trigger");
    const overlay = document.querySelector('[data-overlay="menu"]');
    assert.equal(overlay.inert, true);
    assert.equal(overlay.getAttribute("aria-hidden"), "true");
    assert.equal(trigger.getAttribute("aria-controls"), overlay.id);
    trigger.focus();
    trigger.click();
    assert.equal(overlay.inert, false);
    assert.equal(overlay.hasAttribute("aria-hidden"), false);
    assert.equal(document.querySelector("main").inert, true);
    assert.equal(document.activeElement, overlay.querySelector("[data-close-overlay]"));
    const lastLink = [...overlay.querySelectorAll("a")].at(-1);
    document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, lastLink);
    lastLink.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(overlay.inert, true);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
    assert.equal(Boolean(document.querySelector("main").inert), false);
    assert.equal(document.body.style.overflow, "");
  } finally { dom.window.close(); }
});

test("basket updates preserve quantity-control focus and empty state has no checkout", async () => {
  const { dom, document } = await boot();
  try {
    document.querySelector('[aria-label="Add to cart: Hass Avocados"]').click();
    const trigger = document.querySelector(".verde-cart-trigger");
    trigger.focus();
    trigger.click();
    const overlay = document.querySelector('[data-overlay="cart"]');
    assert.equal(overlay.querySelector("[data-cart-total]").textContent, "$1.99");
    assert.match(overlay.querySelector("[data-cart-checkout]").getAttribute("href"), /checkout=basket/);
    const increase = overlay.querySelector("[data-cart-increase]");
    increase.focus();
    increase.click();
    assert.equal(document.activeElement.getAttribute("data-cart-increase"), "avocado");
    assert.equal(overlay.querySelector("[data-cart-total]").textContent, "$3.98");
    assert.match(overlay.querySelector("[data-cart-announcement]").textContent, /2 items/);
    for (let count = 0; count < 2; count += 1) {
      const decrease = overlay.querySelector("[data-cart-decrease]");
      decrease.focus();
      decrease.click();
    }
    assert.equal(overlay.querySelector(".verde-drawer__footer").hidden, true);
    assert.equal(document.activeElement.textContent, "Browse the harvest");
    assert.equal(trigger.querySelector(".verde-cart-count").hidden, true);
  } finally { dom.window.close(); }
});

test("clearing the basket moves focus out of its hidden footer", async () => {
  const { dom, document } = await boot();
  try {
    document.querySelector('[aria-label="Add to cart: Hass Avocados"]').click();
    document.querySelector(".verde-cart-trigger").click();
    const clear = document.querySelector("[data-cart-clear]");
    clear.focus();
    clear.click();
    assert.equal(document.activeElement.textContent, "Browse the harvest");
  } finally { dom.window.close(); }
});

test("newsletter icon buttons retain their icon and accessible name after feedback", async () => {
  const { dom, window, document, timers } = await boot();
  try {
    const form = document.querySelector("form");
    const button = form.querySelector("button");
    const original = button.innerHTML;
    form.querySelector("input").value = "reader@example.test";
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(button.disabled, true);
    assert.equal(button.querySelector(".material-symbols-outlined").textContent, "check");
    timers.find(({ delay }) => delay === 3000).callback();
    assert.equal(button.disabled, false);
    assert.equal(button.innerHTML, original);
    assert.equal(button.getAttribute("aria-label"), "Subscribe");
  } finally { dom.window.close(); }
});

test("story trigger opens a meaningfully labelled native dialog", async () => {
  const { dom, document } = await boot();
  try {
    const dialog = document.querySelector("#verde-story-dialog");
    let opened = false;
    dialog.showModal = () => { opened = true; };
    document.querySelector("[data-story-dialog]").click();
    assert.equal(opened, true);
    assert.equal(document.getElementById(dialog.getAttribute("aria-labelledby")).tagName, "H2");
  } finally { dom.window.close(); }
});

test("basket checkout uses actual merchandise instead of a saved subscription price", async () => {
  const page = "build-my-box-checkout-finalize.html";
  const { dom, document } = await boot(readFileSync(resolve(root, page), "utf8"), `${page}?checkout=basket`, {
    "verde-market-cart-v1": [{ id: "avocado", name: "Hass Avocados", price: 1.99, quantity: 1 }],
    "verde-market-plan-v1": { id: "personal", frequency: "Bi-weekly" },
    "verde-market-box-v1": { "Organic Carrots": 3 },
  });
  try {
    assert.equal(document.querySelector("#checkout-total").textContent, "$1.99");
    assert.match(document.querySelector("#checkout-line-items").textContent, /Hass Avocados/);
    assert.equal(document.querySelector("#checkout-progress").hidden, true);
    assert.equal(document.querySelector("#checkout-empty").hidden, true);
    document.querySelector(".verde-cart-trigger").click();
    document.querySelector("[data-cart-clear]").click();
    assert.equal(document.querySelector("#checkout-empty").hidden, false);
    assert.equal(document.querySelector('#checkout-form button[type="submit"]').disabled, true);
  } finally { dom.window.close(); }
});

test("confirmation uses the saved order without consuming a newly started basket", async () => {
  const page = "verde-market-order-confirmation.html";
  const freshBasket = [{ id: "apple", name: "Honeycrisp Apples", price: 3.49, quantity: 2 }];
  const savedOrder = {
    version: 2, number: "VM-REGRESSION", mode: "basket", placedAt: "2026-08-31T12:00:00.000Z", deliveryDate: "2026-09-04T12:00:00.000Z",
    plan: null, box: {}, items: [{ id: "avocado", name: "Hass Avocados", price: 1.99, quantity: 1 }], total: 1.99,
  };
  const { dom, window, document } = await boot(readFileSync(resolve(root, page), "utf8"), page, {
    "verde-market-cart-v1": freshBasket, "verde-market-order-v1": savedOrder,
  });
  try {
    assert.equal(document.querySelector("#confirmation-total").textContent, "$1.99");
    assert.match(document.querySelector("#confirmation-items").textContent, /Hass Avocados/);
    assert.deepEqual(JSON.parse(window.localStorage.getItem("verde-market-cart-v1")), freshBasket);
    assert.equal(document.querySelector(".verde-cart-trigger").getAttribute("aria-label"), "Shopping cart, 2 items");
  } finally { dom.window.close(); }
});

for (const page of readdirSync(root).filter((file) => file.endsWith(".html"))) {
  test(`${page}: shared layer initializes against real markup with malformed demo state`, async () => {
    const { dom, errors } = await boot(readFileSync(resolve(root, page), "utf8"), page, {
      "verde-market-cart-v1": { invalid: true },
      "verde-market-plan-v1": null,
      "verde-market-box-v1": ["invalid"],
      "verde-market-order-v1": { version: -1 },
    });
    try { assert.deepEqual(errors, []); } finally { dom.window.close(); }
  });
}
