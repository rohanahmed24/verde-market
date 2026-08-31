const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const commerce = require("../assets/js/verde-commerce.js");

const root = resolve(__dirname, "..");
const modelSource = readFileSync(resolve(root, "assets/js/verde-commerce.js"), "utf8");
const sharedSource = readFileSync(resolve(root, "assets/js/verde-polish.js"), "utf8");
const keys = { cart: "verde-market-cart-v1", box: "verde-market-box-v1", plan: "verde-market-plan-v1", order: "verde-market-order-v1", subscription: "verde-market-subscription-v1", dashboard: "verde-market-dashboard-v1" };
const avocado = { id: "hass-avocados", name: "Hass Avocados", price: 1.99, quantity: 2, image: "assets/images/avocado.webp" };
const personal = { id: "personal", name: "The Personal Box", price: 45, frequency: "Bi-weekly" };

async function boot(page, state = {}) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => errors.push(error));
    const file = page.split("?")[0];
    const dom = new JSDOM(readFileSync(resolve(root, file), "utf8"), { url: `https://verde.test/${page}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
    const { window } = dom;
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLElement.prototype.getClientRects = function () { return this.closest("[hidden]") ? [] : [{ width: 44, height: 44 }]; };
    Object.entries(state).forEach(([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)));
    if (window.document.readyState === "loading") await new Promise((done) => window.document.addEventListener("DOMContentLoaded", done, { once: true }));
    const timers = [];
    window.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
    window.eval(modelSource);
    window.eval(sharedSource);
    const read = (key) => JSON.parse(window.localStorage.getItem(key));
    const snapshot = () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).map((key) => [key, read(key)]));
    return { dom, window, document: window.document, timers, errors, read, snapshot };
}

test("cart normalization rejects malformed data and caps merged quantities", () => {
    assert.deepEqual(commerce.normalizeCart(null), []);
    assert.deepEqual(commerce.normalizeCart({ invalid: true }), []);
    const cart = commerce.normalizeCart([avocado, { ...avocado, quantity: 1000 }, { ...avocado, id: "bad", price: -2 }, { ...avocado, id: "bad2", quantity: Infinity }]);
    assert.equal(cart.length, 1);
    assert.equal(cart[0].quantity, 99);
    assert.equal(commerce.normalizeCart([{ ...avocado, image: "javascript:alert(1)" }])[0].image, "");
});

test("plan normalization uses catalog prices, valid cadence, and safe defaults", () => {
    assert.deepEqual(commerce.normalizePlan({ name: "The Personal Box", price: 0.01, frequency: "Bi-weekly" }), personal);
    assert.equal(commerce.normalizePlan({ name: "Invalid", frequency: "Daily" }).price, 85);
    assert.equal(commerce.normalizePlan(null).frequency, "Weekly");
});

test("box normalization ignores unknown products and enforces eight aggregate slots", () => {
    const box = commerce.normalizeBox({ "Organic Carrots": 7.8, "Baby Spinach": 4, "Unknown Produce": 100, "Hass Avocados": -2 });
    assert.deepEqual(box, { "Organic Carrots": 7, "Baby Spinach": 1 });
    assert.equal(commerce.boxCount({}), 0);
    assert.equal(commerce.boxCount(box), 8);
});

test("basket checkout charges only its items, never a default subscription", () => {
    const summary = commerce.summarizeCheckout({ mode: "basket", cart: [avocado], plan: personal, box: { "Organic Carrots": 8 } });
    assert.equal(summary.total, 3.98);
    assert.equal(summary.plan, null);
    assert.equal(summary.slotCount, 0);
    assert.equal(summary.itemCount, 2);
});

test("box checkout separates recurring plan price from one-time add-ons", () => {
    const summary = commerce.summarizeCheckout({ mode: "box", cart: [avocado], plan: personal, box: { "Organic Carrots": 2 } });
    assert.equal(summary.planTotal, 45);
    assert.equal(summary.merchandise, 3.98);
    assert.equal(summary.total, 48.98);
    assert.equal(summary.slotCount, 2);
});

test("empty basket and empty box cannot create an order", () => {
    assert.equal(commerce.createOrder({ mode: "basket", cart: [] }), null);
    assert.equal(commerce.createOrder({ mode: "box", plan: personal, box: {}, cart: [avocado] }), null);
    assert.equal(commerce.summarizeCheckout({ mode: "box", box: {} }).total, 0);
});

test("confirmed order snapshots do not change with later drafts or card fields", () => {
    const input = { mode: "box", plan: { ...personal }, box: { "Organic Carrots": 2 }, cart: [{ ...avocado }], cardNumber: "4242424242424242" };
    const order = commerce.createOrder(input, new Date("2026-08-31T12:00:00Z"), "VM-TEST-IMMUTABLE");
    input.plan.name = "The Harvest Feast";
    input.box["Organic Carrots"] = 8;
    input.cart[0].quantity = 99;
    assert.equal(order.plan.name, "The Personal Box");
    assert.equal(order.box["Organic Carrots"], 2);
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.total, 48.98);
    assert.equal(JSON.stringify(order).includes("4242"), false);
    assert.deepEqual(commerce.normalizeOrder(JSON.parse(JSON.stringify(order))), order);
});

test("old reference-only orders are not presented as completed snapshots", () => {
    assert.equal(commerce.normalizeOrder({ number: "VM-OLD", placedAt: "2026-08-26T12:00:00Z" }), null);
    assert.equal(commerce.normalizeOrder({ version: 2, number: "BAD", placedAt: "invalid" }), null);
});

test("calendar-month cadence clamps short months and stale schedules advance", () => {
    const january = new Date(2027, 0, 31, 12);
    const february = commerce.advanceDeliveryDate(january, "Monthly");
    assert.equal(february.getMonth(), 1);
    assert.equal(february.getDate(), 28);
    const schedule = commerce.normalizeSchedule({ paused: true, nextDate: new Date(2026, 7, 28, 12).toISOString() }, "Weekly", new Date(2026, 7, 31, 12));
    assert.equal(new Date(schedule.nextDate).getDate(), 4);
    assert.equal(new Date(schedule.nextDate).getMonth(), 8);
    assert.equal(schedule.paused, true);
});

test("checkout mode remains explicit and falls back to real saved contents", () => {
    assert.equal(commerce.resolveCheckoutMode("basket", { "Organic Carrots": 2 }, []), "basket");
    assert.equal(commerce.resolveCheckoutMode("box", {}, [avocado]), "box");
    assert.equal(commerce.resolveCheckoutMode(null, { "Organic Carrots": 2 }, []), "box");
    assert.equal(commerce.resolveCheckoutMode(null, {}, [avocado]), "basket");
});

test("empty checkout renders a recovery path and disables form submission", async () => {
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket");
    try {
        assert.equal(app.document.querySelector("#checkout-empty").hidden, false);
        assert.equal(app.document.querySelector("#checkout-form-details").hidden, true);
        assert.equal(app.document.querySelector('#checkout-form button[type="submit"]').disabled, true);
        assert.equal(app.document.querySelector("#demo-fill").disabled, true);
        assert.equal(app.errors.length, 0);
    } finally { app.dom.window.close(); }
});

test("basket checkout validates fields, saves once, and preserves a separate box draft", async () => {
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.cart]: [avocado], [keys.plan]: personal, [keys.box]: { "Organic Carrots": 3 } });
    try {
        const form = app.document.querySelector("#checkout-form");
        const submit = () => form.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
        assert.equal(app.document.querySelector("#checkout-total").textContent, "$3.98");
        assert.equal(app.document.querySelector("#checkout-progress").hidden, true);
        assert.match(app.document.querySelector("#checkout-line-items").textContent, /Hass Avocados/);
        submit();
        assert.equal(app.document.activeElement.id, "first-name");
        assert.equal(app.document.querySelector("#checkout-error-summary").hidden, false);
        assert.equal(app.read(keys.order), null);
        app.document.querySelector("#demo-fill").click();
        submit();
        const first = app.read(keys.order);
        submit();
        assert.deepEqual(app.read(keys.order), first);
        assert.equal(first.total, 3.98);
        assert.equal(first.mode, "basket");
        assert.equal(app.timers.filter(({ delay }) => delay === 450).length, 1);
        assert.deepEqual(app.read(keys.cart), []);
        assert.deepEqual(app.read(keys.box), { "Organic Carrots": 3 });
        assert.equal(app.document.querySelector('button[type="submit"]').disabled, true);
        assert.equal(JSON.stringify(first).includes("cardNumber"), false);
        assert.equal(app.errors.length, 0);
    } finally { app.dom.window.close(); }
});

test("changing the open checkout basket refreshes totals and its empty state", async () => {
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.cart]: [avocado] });
    try {
        app.document.querySelector(".verde-cart-trigger").click();
        app.document.querySelector("[data-cart-increase]").click();
        assert.equal(app.document.querySelector("#checkout-total").textContent, "$5.97");
        app.document.querySelector("[data-cart-clear]").click();
        assert.equal(app.document.querySelector("#checkout-empty").hidden, false);
        assert.equal(app.document.querySelector('#checkout-form button[type="submit"]').disabled, true);
    } finally { app.dom.window.close(); }
});

test("box controls enforce aggregate capacity and empty recovery", async () => {
    const app = await boot("build-my-box-customize-contents.html");
    try {
        assert.equal(app.document.querySelector("#box-progress-label").textContent, "0 / 8");
        assert.equal(app.document.querySelector("#box-review").getAttribute("aria-disabled"), "true");
        const first = app.document.querySelector('[data-quantity-action="add"]');
        for (let count = 0; count < 10; count += 1) first.click();
        assert.equal(commerce.boxCount(app.read(keys.box)), 8);
        assert.equal([...app.document.querySelectorAll('[data-quantity-action="add"]')].every((button) => button.disabled), true);
        app.document.querySelector('[data-quantity-action="remove"]').click();
        assert.equal(commerce.boxCount(app.read(keys.box)), 7);
        assert.equal(first.disabled, false);
        assert.match(app.document.querySelector("#box-review").getAttribute("href"), /checkout=box/);
    } finally { app.dom.window.close(); }
});

test("plan selection updates the visual button state, catalog price, and cadence together", async () => {
    const app = await boot("build-my-box-select-plan.html");
    try {
        const personalCard = app.document.querySelector('[data-plan-card="personal"]');
        const familyCard = app.document.querySelector('[data-plan-card="family"]');
        personalCard.querySelector("button").click();
        assert.equal(personalCard.querySelector("button").getAttribute("aria-pressed"), "true");
        assert.equal(personalCard.querySelector("button").classList.contains("bg-primary"), true);
        assert.equal(familyCard.querySelector("button").classList.contains("bg-primary"), false);
        assert.equal(familyCard.classList.contains("border-primary"), false);
        const monthly = app.document.querySelector('input[value="Monthly"]');
        monthly.checked = true;
        monthly.dispatchEvent(new app.window.Event("change", { bubbles: true }));
        assert.equal(app.read(keys.plan).price, 45);
        assert.equal(app.read(keys.plan).frequency, "Monthly");
        assert.match(app.document.querySelector("#selected-plan-summary").textContent, /\$45.00/);
    } finally { app.dom.window.close(); }
});

test("box order survives confirmation reload and never clears a new basket", async () => {
    const checkout = await boot("build-my-box-checkout-finalize.html?checkout=box", { [keys.plan]: personal, [keys.box]: { "Organic Carrots": 5, "Baby Spinach": 3 }, [keys.cart]: [avocado] });
    let saved;
    try {
        checkout.document.querySelector("#demo-fill").click();
        checkout.document.querySelector("#checkout-form").dispatchEvent(new checkout.window.Event("submit", { bubbles: true, cancelable: true }));
        saved = checkout.snapshot();
        assert.equal(saved[keys.order].total, 48.98);
        assert.deepEqual(saved[keys.box], {});
        assert.deepEqual(saved[keys.subscription], saved[keys.order]);
    } finally { checkout.dom.window.close(); }
    saved[keys.cart] = [{ ...avocado, quantity: 1 }];
    saved[keys.plan] = { name: "The Harvest Feast", frequency: "Monthly" };
    for (let reload = 0; reload < 2; reload += 1) {
        const confirmation = await boot("verde-market-order-confirmation.html", saved);
        try {
            assert.equal(confirmation.document.querySelector("#confirmation-content").hidden, false);
            assert.equal(confirmation.document.querySelector("#confirmation-plan").textContent, "The Personal Box");
            assert.equal(confirmation.document.querySelector("#confirmation-total").textContent, "$48.98");
            assert.match(confirmation.document.querySelector("#confirmation-box-summary").textContent, /8 preference slots/);
            assert.deepEqual(confirmation.read(keys.cart), saved[keys.cart]);
            assert.equal(confirmation.errors.length, 0);
        } finally { confirmation.dom.window.close(); }
    }
});

test("confirmation without a completed order does not mutate current drafts", async () => {
    const state = { [keys.cart]: [avocado], [keys.box]: { "Organic Carrots": 2 } };
    const app = await boot("verde-market-order-confirmation.html", state);
    try {
        assert.equal(app.document.querySelector("#confirmation-empty").hidden, false);
        assert.equal(app.document.querySelector("#confirmation-content").hidden, true);
        assert.deepEqual(app.read(keys.cart), state[keys.cart]);
        assert.deepEqual(app.read(keys.box), state[keys.box]);
    } finally { app.dom.window.close(); }
});

test("dashboard keeps order history immutable and paused schedules cannot be skipped", async () => {
    const order = commerce.createOrder({ mode: "box", plan: personal, box: { "Organic Carrots": 8 }, cart: [] }, new Date(), "VM-TEST-HISTORY");
    const app = await boot("verde-market-subscriber-dashboard.html", { [keys.order]: order, [keys.subscription]: order, [keys.plan]: { name: "The Harvest Feast", frequency: "Monthly" }, [keys.box]: {} });
    try {
        assert.equal(app.document.querySelector("#dashboard-plan-name").textContent, "The Personal Box");
        assert.equal(app.document.querySelector("#dashboard-order-plan").textContent, "The Personal Box");
        assert.equal(app.document.querySelector("#dashboard-order-total").textContent, "$45.00");
        assert.equal(app.document.querySelector("#dashboard-slot-count").textContent, "8");
        app.document.querySelector("#pause-plan").click();
        const paused = app.read(keys.dashboard);
        assert.equal(paused.paused, true);
        assert.equal(app.document.querySelector("#skip-delivery").disabled, true);
        app.document.querySelector("#skip-delivery").click();
        assert.deepEqual(app.read(keys.dashboard), paused);
        app.document.querySelector("#dashboard-undo").click();
        assert.equal(app.read(keys.dashboard).paused, false);
        assert.equal(app.document.querySelector("#skip-delivery").disabled, false);
        assert.equal(app.errors.length, 0);
    } finally { app.dom.window.close(); }
});
