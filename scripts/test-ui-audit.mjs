import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const root = resolve(import.meta.dirname, "..");
const model = readFileSync(resolve(root, "assets/js/verde-commerce.js"), "utf8");
const shared = readFileSync(resolve(root, "assets/js/verde-polish.js"), "utf8");
const CART = "verde-market-cart-v1";
const avocado = { id: "avocado", name: "Hass Avocados", price: 1.99, quantity: 1 };
const fixture = `<!doctype html><html lang="en"><body>
<header><nav><a href="verde-market-shop-page.html">Shop</a><a href="verde-market-our-story.html">Our Story</a></nav><button aria-label="Cart">Basket</button><button aria-label="Open menu">Menu</button></header>
<main><h1>Market</h1><article class="product-card" data-product="avocado" data-price="1.99"><h2>Hass Avocados</h2><p>$1.99</p><button aria-label="Add to cart: Hass Avocados">Add</button></article>
<form><label>Email<input type="email" required></label><button type="submit">Subscribe</button></form></main>
</body></html>`;

async function boot({ cart = [], storageFails = false, commerceMissing = false, secondaryCart = false } = {}) {
  const dom = new JSDOM(fixture, { url: "https://verde.test/index.html", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const { window } = dom;
  const { document } = window;
  if (secondaryCart) document.querySelector("header").insertAdjacentHTML("beforeend", '<button aria-label="Shopping cart">Second basket</button>');
  window.matchMedia = () => ({ matches: false });
  window.HTMLElement.prototype.getClientRects = function () { return this.closest("[hidden]") ? [] : [{ width: 44, height: 44 }]; };
  window.localStorage.setItem(CART, JSON.stringify(cart));
  if (storageFails) window.Storage.prototype.setItem = () => { throw new window.DOMException("Storage unavailable", "QuotaExceededError"); };
  if (document.readyState === "loading") await new Promise(done => document.addEventListener("DOMContentLoaded", done, { once: true }));
  window.setTimeout = () => 1;
  if (!commerceMissing) window.eval(model);
  window.eval(shared);
  return { dom, window, document };
}

test("mobile menu includes every primary destination even when desktop navigation is compact", async () => {
  const { dom, document } = await boot();
  try {
    const hrefs = Array.from(document.querySelectorAll(".verde-menu-list a"), item => item.getAttribute("href"));
    for (const destination of ["verde-market-shop-page.html", "build-my-box-select-plan.html", "verde-market-our-story.html", "verde-market-sustainability.html", "verde-market-blog-journal.html", "verde-market-locations.html"]) assert(hrefs.includes(destination), destination);
  } finally { dom.window.close(); }
});

test("another tab's basket change refreshes badge and an already open drawer", async () => {
  const { dom, window, document } = await boot();
  try {
    document.querySelector(".verde-cart-trigger").click();
    const saved = JSON.stringify([{ ...avocado, quantity: 3 }]);
    window.localStorage.setItem(CART, saved);
    window.dispatchEvent(new window.StorageEvent("storage", { key: CART, newValue: saved, storageArea: window.localStorage }));
    assert.equal(document.querySelector(".verde-cart-trigger").getAttribute("aria-label"), "Shopping cart, 3 items");
    assert.equal(document.querySelector("[data-cart-total]").textContent, "$5.97");
  } finally { dom.window.close(); }
});

test("adding from a stale page preserves quantities saved by another page", async () => {
  const { dom, window, document } = await boot();
  try {
    window.localStorage.setItem(CART, JSON.stringify([{ ...avocado, quantity: 3 }]));
    document.querySelector('[aria-label="Add to cart: Hass Avocados"]').click();
    assert.equal(JSON.parse(window.localStorage.getItem(CART))[0].quantity, 4);
  } finally { dom.window.close(); }
});

test("returning through browser history closes stale drawers and rehydrates the basket", async () => {
  const { dom, window, document } = await boot();
  try {
    document.querySelector(".verde-menu-trigger").click();
    window.dispatchEvent(new window.PageTransitionEvent("pagehide", { persisted: true }));
    window.localStorage.setItem(CART, JSON.stringify([avocado]));
    window.dispatchEvent(new window.PageTransitionEvent("pageshow", { persisted: true }));
    assert.equal(document.querySelector('[data-overlay="menu"]').dataset.open, "false");
    assert.equal(Boolean(document.querySelector("main").inert), false);
    assert.equal(document.body.style.overflow, "");
    assert.equal(document.querySelector(".verde-cart-trigger").getAttribute("aria-label"), "Shopping cart, 1 item");
  } finally { dom.window.close(); }
});

test("clear basket provides an undo action that restores its saved quantities", async () => {
  const { dom, window, document } = await boot({ cart: [{ ...avocado, quantity: 2 }] });
  try {
    document.querySelector(".verde-cart-trigger").click();
    document.querySelector("[data-cart-clear]").click();
    const undo = document.querySelector("[data-cart-undo]");
    assert(undo, "the empty basket should offer Undo clear");
    undo.click();
    assert.equal(JSON.parse(window.localStorage.getItem(CART))[0].quantity, 2);
    assert.equal(document.querySelector("[data-cart-total]").textContent, "$3.98");
  } finally { dom.window.close(); }
});

test("a stale Undo cannot overwrite a newer basket from another page", async () => {
  const { dom, window, document } = await boot({ cart: [avocado] });
  try {
    document.querySelector(".verde-cart-trigger").click();
    document.querySelector("[data-cart-clear]").click();
    const undo = document.querySelector("[data-cart-undo]");
    assert(undo);
    window.localStorage.setItem(CART, JSON.stringify([{ ...avocado, quantity: 5 }]));
    undo.click();
    assert.equal(JSON.parse(window.localStorage.getItem(CART))[0].quantity, 5);
    assert.equal(document.querySelector("[data-cart-total]").textContent, "$9.95");
  } finally { dom.window.close(); }
});

test("newsletter storage failure keeps the email and reports failure instead of success", async () => {
  const { dom, window, document } = await boot({ storageFails: true });
  try {
    const input = document.querySelector('input[type="email"]');
    input.value = "reader@example.test";
    document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(input.value, "reader@example.test");
    assert.equal(document.querySelector('button[type="submit"]').disabled, false);
    assert.doesNotMatch(document.querySelector(".verde-toast-region").textContent, /subscription has been saved/);
    assert.match(document.querySelector(".verde-toast-region").textContent, /could not save|couldn't save/i);
  } finally { dom.window.close(); }
});

test("Undo restores keyboard focus into the rebuilt basket", async () => {
  const { dom, document } = await boot({ cart: [avocado] });
  try {
    document.querySelector(".verde-cart-trigger").click();
    document.querySelector("[data-cart-clear]").click();
    const undo = document.querySelector("[data-cart-undo]");
    undo.focus();
    undo.click();
    assert(document.querySelector(".verde-cart-item").contains(document.activeElement));
  } finally { dom.window.close(); }
});

test("all cart launchers expose the same expanded state", async () => {
  const { dom, document } = await boot({ secondaryCart: true });
  try {
    const triggers = [...document.querySelectorAll(".verde-cart-trigger")];
    triggers[1].click();
    for (const trigger of triggers) assert.equal(trigger.getAttribute("aria-expanded"), "true");
    document.querySelector('#verde-cart-overlay [data-close-overlay]').click();
    for (const trigger of triggers) assert.equal(trigger.getAttribute("aria-expanded"), "false");
  } finally { dom.window.close(); }
});

test("a failed basket save rolls back the count and never claims checkout success", async () => {
  const { dom, window, document } = await boot({ cart: [avocado], storageFails: true });
  try {
    document.querySelector('[aria-label="Add to cart: Hass Avocados"]').click();
    assert.equal(JSON.parse(window.localStorage.getItem(CART))[0].quantity, 1);
    assert.equal(document.querySelector(".verde-cart-trigger").getAttribute("aria-label"), "Shopping cart, 1 item");
    assert.match(document.querySelector(".verde-toast-region").textContent, /could not save/i);
    assert.doesNotMatch(document.querySelector(".verde-toast-region").textContent, /is saved for checkout/i);
  } finally { dom.window.close(); }
});

test("basket quantity cannot be increased past the limit", async () => {
  const { dom, document } = await boot({ cart: [{ ...avocado, quantity: 99 }] });
  try {
    document.querySelector(".verde-cart-trigger").click();
    assert.equal(document.querySelector("[data-cart-increase]").disabled, true);
    assert.equal(document.querySelector("[data-cart-decrease]").disabled, false);
  } finally { dom.window.close(); }
});

test("reaching the quantity limit keeps keyboard focus on an enabled control", async () => {
  const { dom, document } = await boot({ cart: [{ ...avocado, quantity: 98 }] });
  try {
    document.querySelector(".verde-cart-trigger").click();
    const increase = document.querySelector("[data-cart-increase]");
    increase.focus();
    increase.click();
    assert.equal(document.querySelector("[data-cart-increase]").disabled, true);
    assert.equal(document.activeElement, document.querySelector("[data-cart-decrease]"));
  } finally { dom.window.close(); }
});

test("another tab clearing the basket moves focus off the now-hidden checkout", async () => {
  const { dom, window, document } = await boot({ cart: [avocado] });
  try {
    document.querySelector(".verde-cart-trigger").click();
    document.querySelector("[data-cart-checkout]").focus();
    window.localStorage.setItem(CART, "[]");
    window.dispatchEvent(new window.StorageEvent("storage", { key: CART }));
    assert.equal(document.activeElement, document.querySelector(".verde-cart-empty a"));
  } finally { dom.window.close(); }
});

test("an unavailable commerce script does not break navigation or newsletter signup", async () => {
  const { dom, window, document } = await boot({ commerceMissing: true });
  try {
    document.querySelector(".verde-menu-trigger").click();
    assert.equal(document.querySelector('[data-overlay="menu"]').dataset.open, "true");
    document.querySelector('#verde-menu-overlay [data-close-overlay]').click();
    assert.equal(document.querySelector('[aria-label="Add to cart: Hass Avocados"]').disabled, true);
    assert.match(document.querySelector("[data-commerce-unavailable]").textContent, /unavailable|could not load/i);
    document.querySelector('input[type="email"]').value = "reader@example.test";
    document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(JSON.parse(window.localStorage.getItem("verde-market-newsletter-v1")).email, "reader@example.test");
  } finally { dom.window.close(); }
});
