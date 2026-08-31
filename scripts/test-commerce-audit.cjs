const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const commerce = require("../assets/js/verde-commerce.js");
const root = resolve(__dirname, "..");
const keys = { cart: "verde-market-cart-v1", box: "verde-market-box-v1", plan: "verde-market-plan-v1", order: "verde-market-order-v1", subscription: "verde-market-subscription-v1", dashboard: "verde-market-dashboard-v1" };
const item = { id: "avocado", name: "Hass Avocados", price: 1.99, quantity: 2 };
const plan = { id: "personal", name: "The Personal Box", price: 45, frequency: "Bi-weekly" };
const order = () => commerce.createOrder({ mode: "box", plan, box: { "Organic Carrots": 4 }, cart: [item] }, new Date(), "VM-AUDIT");

async function boot(page, state = {}, before = () => {}, loadModel = true) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => errors.push(error));
    const dom = new JSDOM(readFileSync(resolve(root, page.split("?")[0]), "utf8"), { url: `https://verde.test/${page}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
    const { window } = dom;
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLElement.prototype.getClientRects = function () { return this.closest("[hidden]") ? [] : [{ width: 44, height: 44 }]; };
    Object.entries(state).forEach(([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)));
    window.document.querySelectorAll("script:not([src])").forEach((script) => window.eval(script.textContent));
    if (window.document.readyState === "loading") await new Promise((done) => window.document.addEventListener("DOMContentLoaded", done, { once: true }));
    const timers = [];
    window.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
    before(window);
    for (const file of ["verde-commerce.js", "verde-polish.js"]) {
        if (!loadModel && file === "verde-commerce.js") continue;
        window.eval(readFileSync(resolve(root, "assets/js", file), "utf8"));
    }
    const read = (key) => JSON.parse(window.localStorage.getItem(key));
    return { dom, window, document: window.document, read, errors, timers };
}

function submit(app) {
    app.document.querySelector("#checkout-form").dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
}

test("canonical plan id wins over an inconsistent saved plan name", () => {
    assert.equal(commerce.normalizePlan({ id: "family", name: "The Personal Box" }).id, "family");
});

test("a null delivery date is repaired to the next delivery, not the Unix epoch cadence", () => {
    const now = new Date(2026, 7, 31, 12);
    assert.equal(commerce.normalizeSchedule({ nextDate: null }, "Monthly", now).nextDate, commerce.nextDeliveryDate(now).toISOString());
});

test("dashboard never treats unpurchased plan or box drafts as the active subscription", async () => {
    const saved = order();
    const app = await boot("verde-market-subscriber-dashboard.html", { [keys.subscription]: saved, [keys.order]: saved, [keys.plan]: { id: "harvest", frequency: "Monthly" }, [keys.box]: { "Baby Spinach": 8 } });
    try {
        assert.equal(app.document.querySelector("#dashboard-plan-name").textContent, plan.name);
        assert.equal(app.document.querySelector("#dashboard-frequency").textContent, plan.frequency);
        assert.equal(app.document.querySelector("#dashboard-slot-count").textContent, "4");
        assert.match(app.document.querySelector('[data-edit-plan]').getAttribute("href"), /edit=subscription/);
    } finally { app.dom.window.close(); }
});

test("empty and basket-only dashboards show no scheduled subscription or enabled schedule tools", async () => {
    for (const state of [{}, { [keys.order]: commerce.createOrder({ mode: "basket", cart: [item] }), [keys.subscription]: commerce.createOrder({ mode: "basket", cart: [item] }) }]) {
        const app = await boot("verde-market-subscriber-dashboard.html", state);
        try {
            assert.equal(app.document.querySelector("#dashboard-subscription-empty").hidden, false);
            assert.equal(app.document.querySelector("#pause-plan").disabled, true);
            assert.equal(app.document.querySelector("#skip-delivery").disabled, true);
            assert.equal(app.read(keys.dashboard), null);
        } finally { app.dom.window.close(); }
    }
});

test("editing plan is explicit, cancel-safe, and saves without touching drafts, history, cart or schedule", async () => {
    const saved = order();
    const schedule = { paused: true, nextDate: saved.deliveryDate };
    const draft = { id: "family", frequency: "Weekly" };
    const app = await boot("build-my-box-select-plan.html?edit=subscription", { [keys.subscription]: saved, [keys.order]: saved, [keys.plan]: draft, [keys.cart]: [item], [keys.dashboard]: schedule });
    try {
        assert.equal(app.document.querySelector('[data-plan-card="personal"] button').getAttribute("aria-pressed"), "true");
        app.document.querySelector('[data-plan-card="harvest"] button').click();
        const frequency = app.document.querySelector('input[value="Monthly"]');
        frequency.checked = true;
        frequency.dispatchEvent(new app.window.Event("change", { bubbles: true }));
        assert.deepEqual(app.read(keys.subscription), saved);
        assert.deepEqual(app.read(keys.plan), draft);
        app.document.querySelector("#plan-continue").dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
        assert.equal(app.read(keys.subscription).plan.id, "harvest");
        assert.equal(app.read(keys.subscription).plan.frequency, "Monthly");
        assert.deepEqual(app.read(keys.order), saved);
        assert.deepEqual(app.read(keys.dashboard), schedule);
        assert.deepEqual(app.read(keys.cart), [item]);
        assert.deepEqual(app.read(keys.plan), draft);
    } finally { app.dom.window.close(); }
});

test("editing next box starts from subscription, saves directly, and preserves unrelated drafts", async () => {
    const saved = order();
    const draft = { "Baby Spinach": 8 };
    const app = await boot("build-my-box-customize-contents.html?edit=subscription", { [keys.subscription]: saved, [keys.order]: saved, [keys.box]: draft, [keys.cart]: [item] });
    try {
        assert.equal(app.document.querySelector("#box-progress-label").textContent, "4 / 8");
        app.document.querySelector('[data-box-product="Organic Carrots"] [data-quantity-action="add"]').click();
        assert.deepEqual(app.read(keys.subscription), saved);
        assert.deepEqual(app.read(keys.box), draft);
        const review = app.document.querySelector("#box-review");
        assert.match(review.textContent, /Save/);
        review.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
        assert.equal(app.read(keys.subscription).box["Organic Carrots"], 5);
        assert.deepEqual(app.read(keys.order), saved);
        assert.deepEqual(app.read(keys.box), draft);
        assert.deepEqual(app.read(keys.cart), [item]);
    } finally { app.dom.window.close(); }
});

test("stale checkout re-reads saved cart and requires review before submitting changed totals", async () => {
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.cart]: [item] });
    try {
        app.document.querySelector("#demo-fill").click();
        app.window.localStorage.setItem(keys.cart, JSON.stringify([{ ...item, quantity: 3 }]));
        submit(app);
        assert.equal(app.read(keys.order), null);
        assert.equal(app.document.querySelector("#checkout-total").textContent, "$5.97");
        assert.match(app.document.querySelector("#checkout-error-summary").textContent, /changed|updated/i);
        submit(app);
        assert.equal(app.read(keys.order).total, 5.97);
    } finally { app.dom.window.close(); }
});

test("checkout cannot duplicate an order after another tab consumed its basket", async () => {
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.cart]: [item] });
    try {
        app.document.querySelector("#demo-fill").click();
        app.window.localStorage.setItem(keys.cart, "[]");
        submit(app);
        assert.equal(app.read(keys.order), null);
        assert.equal(app.document.querySelector("#checkout-empty").hidden, false);
    } finally { app.dom.window.close(); }
});

for (const failingKey of [keys.order, keys.subscription, keys.dashboard, keys.box, keys.cart]) {
    test(`failed checkout write to ${failingKey} rolls back all state and permits retry`, async () => {
        const saved = order();
        const state = { [keys.subscription]: saved, [keys.order]: saved, [keys.cart]: [item], [keys.box]: { "Organic Carrots": 2 }, [keys.plan]: plan, [keys.dashboard]: { paused: true, nextDate: saved.deliveryDate } };
        const app = await boot("build-my-box-checkout-finalize.html?checkout=box", state);
        try {
            app.document.querySelector("#demo-fill").click();
            const original = app.window.Storage.prototype.setItem;
            app.window.Storage.prototype.setItem = function (key, value) {
                if (key === failingKey) throw new app.window.DOMException("Quota exceeded", "QuotaExceededError");
                return original.call(this, key, value);
            };
            submit(app);
            Object.entries(state).forEach(([key, value]) => assert.deepEqual(app.read(key), value));
            assert.equal(app.document.querySelector('#checkout-form button[type="submit"]').disabled, false);
            assert.equal(app.timers.filter(({ delay }) => delay === 450).length, 0);
            assert.match(app.document.querySelector("#checkout-error-summary").textContent, /could not save/i);
            app.window.Storage.prototype.setItem = original;
            submit(app);
            assert.notEqual(app.read(keys.order).number, saved.number);
        } finally { app.dom.window.close(); }
    });
}

test("failed schedule persistence reports failure without showing a successful pause", async () => {
    const saved = order();
    const app = await boot("verde-market-subscriber-dashboard.html", { [keys.subscription]: saved, [keys.order]: saved });
    try {
        const original = app.window.Storage.prototype.setItem;
        app.window.Storage.prototype.setItem = function (key, value) {
            if (key === keys.dashboard) throw new app.window.DOMException("Disabled", "SecurityError");
            return original.call(this, key, value);
        };
        app.document.querySelector("#pause-plan").click();
        assert.equal(app.document.querySelector("#pause-plan").getAttribute("aria-pressed"), "false");
        assert.match(app.document.querySelector("#dashboard-feedback-text").textContent, /could not save/i);
    } finally { app.dom.window.close(); }
});

test("resuming a long-open paused dashboard advances an overdue delivery before saving", async () => {
    const saved = order();
    let now = new Date(2026, 7, 31, 12).getTime();
    const schedule = { paused: true, nextDate: new Date(2026, 8, 4, 12).toISOString() };
    const app = await boot("verde-market-subscriber-dashboard.html", { [keys.subscription]: saved, [keys.dashboard]: schedule }, (window) => {
        const NativeDate = window.Date;
        window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return now; }
        };
    });
    try {
        now = new Date(2026, 9, 17, 12).getTime();
        app.document.querySelector("#pause-plan").click();
        assert.deepEqual(app.read(keys.dashboard), { ...commerce.normalizeSchedule(schedule, plan.frequency, new Date(now)), paused: false });
    } finally { app.dom.window.close(); }
});

test("box category filters retain all selections when switching views", async () => {
    const app = await boot("build-my-box-customize-contents.html", { [keys.box]: { "Organic Carrots": 2 } });
    try {
        app.document.querySelector('[data-box-filter="fruit"]').click();
        assert.equal(app.document.querySelector('[data-box-product="Organic Carrots"]').hidden, true);
        assert.equal(app.document.querySelector('[data-box-product="Hass Avocados"]').hidden, false);
        app.document.querySelector('[data-box-product="Hass Avocados"] [data-quantity-action="add"]').click();
        assert.equal(app.read(keys.box)["Organic Carrots"], 2);
        assert.equal(app.read(keys.box)["Hass Avocados"], 1);
        app.document.querySelector('[data-box-filter="all"]').click();
        assert.equal([...app.document.querySelectorAll("[data-box-product]")].every((product) => !product.hidden), true);
        assert.equal(app.document.querySelector("#box-progress-label").textContent, "3 / 8");
        assert.deepEqual(app.errors, []);
    } finally { app.dom.window.close(); }
});

test("back-forward restored builder does not resurrect an already checked-out box", async () => {
    const app = await boot("build-my-box-customize-contents.html", { [keys.box]: { "Organic Carrots": 4 } });
    try {
        app.window.localStorage.setItem(keys.box, "{}");
        app.window.dispatchEvent(new app.window.PageTransitionEvent("pageshow", { persisted: true }));
        assert.equal(app.document.querySelector("#box-progress-label").textContent, "0 / 8");
        assert.equal(app.document.querySelector("#box-review").getAttribute("aria-disabled"), "true");
        assert.deepEqual(app.read(keys.box), {});
    } finally { app.dom.window.close(); }
});

test("back-forward restored checkout can submit a newly filled basket", async () => {
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.cart]: [item] });
    try {
        app.document.querySelector("#demo-fill").click();
        submit(app);
        const first = app.read(keys.order);
        app.window.localStorage.setItem(keys.cart, JSON.stringify([{ ...item, quantity: 1 }]));
        app.window.dispatchEvent(new app.window.PageTransitionEvent("pageshow", { persisted: true }));
        assert.equal(app.document.querySelector('#checkout-form button[type="submit"]').disabled, false);
        assert.equal(app.document.querySelector("#checkout-total").textContent, "$1.99");
        submit(app);
        assert.notEqual(app.read(keys.order).number, first.number);
        assert.equal(app.read(keys.order).total, 1.99);
    } finally { app.dom.window.close(); }
});

test("confirmation refreshes the saved receipt after returning from browser history", async () => {
    const first = order();
    const second = commerce.createOrder({ mode: "basket", cart: [item] }, new Date(), "VM-SECOND");
    const app = await boot("verde-market-order-confirmation.html", { [keys.order]: first });
    try {
        app.window.localStorage.setItem(keys.order, JSON.stringify(second));
        app.window.dispatchEvent(new app.window.PageTransitionEvent("pageshow", { persisted: true }));
        assert.equal(app.document.querySelector("[data-order-number]").textContent, second.number);
        assert.equal(app.document.querySelector("#confirmation-total").textContent, "$3.98");
    } finally { app.dom.window.close(); }
});

test("direct edit links without a subscription offer a new build without inventing a subscription", async () => {
    for (const page of ["build-my-box-select-plan.html", "build-my-box-customize-contents.html"]) {
        const app = await boot(`${page}?edit=subscription`);
        try {
            assert.equal(app.read(keys.subscription), null);
            assert.equal(app.read(keys.order), null);
            assert.equal(app.read(keys.dashboard), null);
            const action = app.document.querySelector("#plan-continue, #box-review");
            assert.doesNotMatch(action.textContent, /Save/);
            assert.notEqual(action.getAttribute("href"), "verde-market-subscriber-dashboard.html");
            assert.deepEqual(app.errors, []);
        } finally { app.dom.window.close(); }
    }
});

test("failed subscription edit is retryable and a successful save survives reload", async () => {
    const saved = order();
    const app = await boot("build-my-box-select-plan.html?edit=subscription", { [keys.subscription]: saved, [keys.order]: saved });
    let updated;
    try {
        app.document.querySelector('[data-plan-card="harvest"] button').click();
        const original = app.window.Storage.prototype.setItem;
        app.window.Storage.prototype.setItem = function (key, value) {
            if (key === keys.subscription) throw new app.window.DOMException("Quota exceeded", "QuotaExceededError");
            return original.call(this, key, value);
        };
        app.document.querySelector("#plan-continue").click();
        assert.deepEqual(app.read(keys.subscription), saved);
        assert.equal(app.timers.filter(({ delay }) => delay === 450).length, 0);
        app.window.Storage.prototype.setItem = original;
        app.document.querySelector("#plan-continue").click();
        updated = app.read(keys.subscription);
        assert.equal(updated.plan.id, "harvest");
        app.document.querySelector("#plan-continue").click();
        assert.equal(app.timers.filter(({ delay }) => delay === 450).length, 1);
    } finally { app.dom.window.close(); }
    const reload = await boot("verde-market-subscriber-dashboard.html", { [keys.subscription]: updated, [keys.order]: saved });
    try {
        assert.equal(reload.document.querySelector("#dashboard-plan-name").textContent, "The Harvest Feast");
        assert.equal(reload.document.querySelector("#dashboard-order-plan").textContent, "The Personal Box");
        assert.equal(reload.document.querySelector("#dashboard-order-total").textContent, "$48.98");
    } finally { reload.dom.window.close(); }
});

test("subscription editor rejects a conflicting edit from another tab", async () => {
    const saved = order();
    const app = await boot("build-my-box-customize-contents.html?edit=subscription", { [keys.subscription]: saved });
    try {
        app.document.querySelector('[data-box-product="Organic Carrots"] [data-quantity-action="add"]').click();
        const other = { ...saved, box: { "Baby Spinach": 6 } };
        app.window.localStorage.setItem(keys.subscription, JSON.stringify(other));
        app.document.querySelector("#box-review").click();
        assert.deepEqual(app.read(keys.subscription), other);
        assert.equal(app.timers.filter(({ delay }) => delay === 450).length, 0);
    } finally { app.dom.window.close(); }
});

test("undo does not overwrite a newer schedule changed in another tab", async () => {
    const saved = order();
    const app = await boot("verde-market-subscriber-dashboard.html", { [keys.subscription]: saved });
    try {
        app.document.querySelector("#skip-delivery").click();
        const other = { paused: true, nextDate: commerce.advanceDeliveryDate(saved.deliveryDate, "Monthly").toISOString() };
        app.window.localStorage.setItem(keys.dashboard, JSON.stringify(other));
        app.document.querySelector("#dashboard-undo").click();
        assert.deepEqual(app.read(keys.dashboard), other);
        assert.equal(app.document.querySelector("#dashboard-undo").hidden, true);
        assert.match(app.document.querySelector("#dashboard-feedback-text").textContent, /changed/);
    } finally { app.dom.window.close(); }
});

for (const eventType of ["pageshow", "visibilitychange"]) {
    test(`dashboard ${eventType} refresh invalidates Undo before it can overwrite a newer schedule`, async () => {
        const saved = order();
        const app = await boot("verde-market-subscriber-dashboard.html", { [keys.subscription]: saved });
        try {
            app.document.querySelector("#skip-delivery").click();
            const undo = app.document.querySelector("#dashboard-undo");
            assert.equal(undo.hidden, false);
            const other = { paused: true, nextDate: commerce.advanceDeliveryDate(saved.deliveryDate, "Monthly").toISOString() };
            app.window.localStorage.setItem(keys.dashboard, JSON.stringify(other));
            if (eventType === "pageshow") app.window.dispatchEvent(new app.window.PageTransitionEvent("pageshow", { persisted: true }));
            else app.document.dispatchEvent(new app.window.Event("visibilitychange"));
            undo.click();
            assert.deepEqual(app.read(keys.dashboard), other);
            assert.equal(undo.hidden, true);
            assert.equal(app.document.querySelector("#pause-plan").getAttribute("aria-pressed"), "true");
            assert.match(app.document.querySelector("#dashboard-feedback-text").textContent, /another tab|changed/);
        } finally { app.dom.window.close(); }
    });

    test(`dashboard ${eventType} refresh keeps Undo when its applied subscription and schedule are unchanged`, async () => {
        const saved = order();
        const app = await boot("verde-market-subscriber-dashboard.html", { [keys.subscription]: saved });
        try {
            app.document.querySelector("#skip-delivery").click();
            if (eventType === "pageshow") app.window.dispatchEvent(new app.window.PageTransitionEvent("pageshow", { persisted: true }));
            else app.document.dispatchEvent(new app.window.Event("visibilitychange"));
            const undo = app.document.querySelector("#dashboard-undo");
            assert.equal(undo.hidden, false);
            undo.click();
            assert.deepEqual(app.read(keys.dashboard), { paused: false, nextDate: saved.deliveryDate });
            assert.equal(undo.hidden, true);
        } finally { app.dom.window.close(); }
    });
}

test("basket checkout preserves a legacy order-only subscription and its schedule", async () => {
    const legacy = order();
    const schedule = { paused: true, nextDate: commerce.advanceDeliveryDate(legacy.deliveryDate, "Monthly").toISOString() };
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.order]: legacy, [keys.dashboard]: schedule, [keys.cart]: [item] });
    let receipt;
    let subscription;
    try {
        app.document.querySelector("#demo-fill").click();
        submit(app);
        receipt = app.read(keys.order);
        subscription = app.read(keys.subscription);
        assert.equal(receipt.mode, "basket");
        assert.deepEqual(subscription, legacy);
        assert.deepEqual(app.read(keys.dashboard), schedule);
    } finally { app.dom.window.close(); }
    const dashboard = await boot("verde-market-subscriber-dashboard.html", { [keys.order]: receipt, [keys.subscription]: subscription, [keys.dashboard]: schedule });
    try {
        assert.equal(dashboard.document.querySelector("#dashboard-plan-name").textContent, plan.name);
        assert.equal(dashboard.document.querySelector("#dashboard-order-plan").textContent, "Market basket");
        assert.equal(dashboard.document.querySelector("#dashboard-order-total").textContent, "$3.98");
        assert.equal(dashboard.document.querySelector("#pause-plan").getAttribute("aria-pressed"), "true");
        assert.deepEqual(dashboard.read(keys.dashboard), schedule);
    } finally { dashboard.dom.window.close(); }
});

test("basket checkout rolls back when its legacy subscription migration cannot save", async () => {
    const legacy = order();
    const schedule = { paused: true, nextDate: legacy.deliveryDate };
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.order]: legacy, [keys.dashboard]: schedule, [keys.cart]: [item] });
    try {
        app.document.querySelector("#demo-fill").click();
        const original = app.window.Storage.prototype.setItem;
        app.window.Storage.prototype.setItem = function (key, value) {
            if (key === keys.subscription) throw new app.window.DOMException("Quota exceeded", "QuotaExceededError");
            return original.call(this, key, value);
        };
        submit(app);
        assert.deepEqual(app.read(keys.order), legacy);
        assert.equal(app.read(keys.subscription), null);
        assert.deepEqual(app.read(keys.dashboard), schedule);
        assert.deepEqual(app.read(keys.cart), [item]);
        assert.equal(app.timers.filter(({ delay }) => delay === 450).length, 0);
        assert.match(app.document.querySelector("#checkout-error-summary").textContent, /could not save/i);
        app.window.Storage.prototype.setItem = original;
        submit(app);
        assert.equal(app.read(keys.order).mode, "basket");
        assert.deepEqual(app.read(keys.subscription), legacy);
    } finally { app.dom.window.close(); }
});

test("basket checkout does not rewrite a dedicated modern subscription", async () => {
    const saved = order();
    const app = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.order]: saved, [keys.subscription]: saved, [keys.cart]: [item] });
    try {
        app.document.querySelector("#demo-fill").click();
        const original = app.window.Storage.prototype.setItem;
        app.window.Storage.prototype.setItem = function (key, value) {
            assert.notEqual(key, keys.subscription, "A basket order must not mutate a dedicated subscription");
            return original.call(this, key, value);
        };
        submit(app);
        assert.equal(app.read(keys.order).mode, "basket");
        assert.deepEqual(app.read(keys.subscription), saved);
    } finally { app.dom.window.close(); }
});

for (const page of ["build-my-box-select-plan.html", "build-my-box-customize-contents.html", "build-my-box-checkout-finalize.html", "verde-market-order-confirmation.html", "verde-market-subscriber-dashboard.html"]) {
    test(`${page}: missing commerce script disables dependent actions and keeps navigation alive`, async () => {
        const app = await boot(page, {}, () => {}, false);
        try {
            assert.equal(app.document.querySelectorAll("[data-commerce-unavailable]").length, 1);
            assert.match(app.document.querySelector("[data-commerce-unavailable]").textContent, /reload/i);
            for (const control of app.document.querySelectorAll('[data-plan-card] button, [data-box-product] button, #demo-fill, #checkout-form button, #pause-plan, #skip-delivery')) assert.equal(control.disabled, true);
            for (const link of app.document.querySelectorAll("#plan-continue, #box-review, [data-edit-plan]")) {
                assert.equal(link.getAttribute("aria-disabled"), "true");
                assert.equal(link.hasAttribute("href"), false);
            }
            assert.equal(app.read(keys.order), null);
            assert.deepEqual(app.errors, []);
            assert.ok(app.document.querySelector(".verde-menu-trigger"));
        } finally { app.dom.window.close(); }
    });
}

test("sale units survive normalization and order snapshots without changing quantity totals", () => {
    const apples = { id: "honeycrisp-apples", name: "Honeycrisp Apples", price: 3.49, quantity: 2 };
    const eggs = { id: "free-range-eggs", name: "Free Range Eggs", price: 5.49, quantity: 1 };
    assert.equal(commerce.normalizeCart([apples])[0].unit, "lb");
    assert.equal(commerce.normalizeCart([eggs])[0].unit, "dozen");
    assert.equal(commerce.cartTotal([apples]), 6.98);
    const saved = commerce.createOrder({ mode: "basket", cart: [apples, eggs] });
    assert.equal(saved.total, 12.47);
    assert.equal(saved.items[0].unit, "lb");
    assert.equal(saved.items[1].unit, "dozen");
    assert.deepEqual(commerce.normalizeOrder(saved), saved);
    const explicitEach = commerce.createOrder({ mode: "basket", cart: [{ ...apples, unit: "each" }] });
    assert.equal(commerce.normalizeOrder(explicitEach).items[0].unit, "each");
    assert.equal(commerce.normalizeSaleUnit({ id: "__proto__", name: "Unknown item" }), "each");
    // Old generic entries still mean one item; invalid unit text never reaches HTML.
    assert.equal(commerce.normalizeCart([{ ...item, name: "Generic item", unit: "<img onerror=alert(1)>" }])[0].unit || "each", "each");
});

test("shop basket, checkout and confirmation retain apple pounds and egg dozens", async () => {
    const shop = await boot("verde-market-shop-page.html");
    let cart;
    try {
        shop.document.querySelector('[data-product="honeycrisp-apples"] button').click();
        shop.document.querySelector('[data-product="honeycrisp-apples"] button').click();
        shop.document.querySelector('[data-product="free-range-eggs"] button').click();
        shop.document.querySelector(".verde-cart-trigger").click();
        const rows = [...shop.document.querySelectorAll(".verde-cart-item")];
        assert.match(rows.find((row) => /Honeycrisp Apples/.test(row.textContent)).querySelector(".verde-cart-item__price").textContent, /\$3\.49\s*\/\s*lb/);
        assert.match(rows.find((row) => /Free Range Eggs/.test(row.textContent)).querySelector(".verde-cart-item__price").textContent, /\$5\.49\s*\/\s*dozen/);
        cart = shop.read(keys.cart);
        assert.equal(cart[0].unit, "lb");
        assert.equal(cart[1].unit, "dozen");
    } finally { shop.dom.window.close(); }
    const checkout = await boot("build-my-box-checkout-finalize.html?checkout=basket", { [keys.cart]: cart });
    let receipt;
    try {
        assert.equal(checkout.document.querySelector("#checkout-total").textContent, "$12.47");
        assert.match(checkout.document.querySelector("#checkout-line-items").textContent, /2 × \$3\.49\s*\/\s*lb/);
        assert.match(checkout.document.querySelector("#checkout-line-items").textContent, /1 × \$5\.49\s*\/\s*dozen/);
        checkout.document.querySelector("#demo-fill").click();
        submit(checkout);
        receipt = checkout.read(keys.order);
    } finally { checkout.dom.window.close(); }
    const confirmation = await boot("verde-market-order-confirmation.html", { [keys.order]: receipt });
    try {
        assert.equal(confirmation.document.querySelector("#confirmation-total").textContent, "$12.47");
        assert.match(confirmation.document.querySelector("#confirmation-items").textContent, /2 × \$3\.49\s*\/\s*lb/);
        assert.match(confirmation.document.querySelector("#confirmation-items").textContent, /1 × \$5\.49\s*\/\s*dozen/);
    } finally { confirmation.dom.window.close(); }
});

test("homepage products keep head, pound, bunch and package sale units", async () => {
    const app = await boot("index.html");
    try {
        for (const id of ["broccoli-crowns", "orchard-fruit-mix", "organic-carrots", "hass-avocados", "granola-clusters"]) app.document.querySelector(`[data-product="${id}"] button`).click();
        assert.deepEqual(app.read(keys.cart).map(({ unit = "each" }) => unit), ["head", "lb", "bunch", "each", "12 oz"]);
        app.document.querySelector(".verde-cart-trigger").click();
        assert.match(app.document.querySelector('[data-overlay="cart"]').textContent, /\$1\.89\s*\/\s*bunch/);
        assert.match(app.document.querySelector('[data-overlay="cart"]').textContent, /\$6\.49\s*\/\s*12 oz/);
    } finally { app.dom.window.close(); }
});
