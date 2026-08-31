(function (root, factory) {
    "use strict";
    const commerce = factory();
    if (typeof module === "object" && module.exports) module.exports = commerce;
    else root.VerdeCommerce = commerce;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const CAPACITY = 8;
    const MAX_QUANTITY = 99;
    const PLANS = Object.freeze([
        { id: "personal", name: "The Personal Box", price: 45 },
        { id: "family", name: "The Family Box", price: 85 },
        { id: "harvest", name: "The Harvest Feast", price: 120 },
    ]);
    const FREQUENCIES = ["Weekly", "Bi-weekly", "Monthly"];
    const PRODUCT_UNITS = Object.freeze({
        "hass-avocados": "each", "honeycrisp-apples": "lb", "free-range-eggs": "dozen",
        "sourdough-loaf": "loaf", "organic-carrots": "bunch", "baby-spinach": "5 oz",
        "pantry-trio": "set", "granola-clusters": "12 oz", "broccoli-crowns": "head",
        "orchard-fruit-mix": "lb",
    });
    const SALE_UNITS = new Set(Object.values(PRODUCT_UNITS));
    const BOX_PRODUCTS = [
        "Organic Carrots", "Baby Spinach", "Broccoli Crowns", "Vine Tomatoes",
        "Red Onions", "Russet Potatoes", "Hass Avocados", "Honeycrisp Apples",
        "Free Range Eggs", "Sourdough Loaf",
    ];
    const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const text = (value, limit = 120) => typeof value === "string" ? value.trim().slice(0, limit) : "";
    const quantity = (value, max = MAX_QUANTITY) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(0, Math.floor(number))) : 0;
    };

    function normalizePlan(raw) {
        const value = object(raw);
        const selected = PLANS.find((plan) => plan.id === value.id) || PLANS.find((plan) => plan.name === value.name) || PLANS[1];
        return { ...selected, frequency: FREQUENCIES.includes(value.frequency) ? value.frequency : "Weekly" };
    }

    function normalizeSaleUnit(raw) {
        const value = object(raw);
        const unit = text(value.unit, 24).toLowerCase().replace(/\s+/g, " ");
        if (SALE_UNITS.has(unit)) return unit;
        const id = text(value.id);
        const nameId = text(value.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        if (Object.hasOwn(PRODUCT_UNITS, id)) return PRODUCT_UNITS[id];
        return Object.hasOwn(PRODUCT_UNITS, nameId) ? PRODUCT_UNITS[nameId] : "each";
    }

    function normalizeCart(raw) {
        if (!Array.isArray(raw)) return [];
        const items = new Map();
        raw.slice(0, 100).forEach((candidate) => {
            const value = object(candidate);
            const name = text(value.name);
            const id = text(value.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const price = Number(value.price);
            const units = quantity(value.quantity);
            if (!name || !id || !Number.isFinite(price) || price <= 0 || price > 1000 || !units) return;
            const image = text(value.image, 2000);
            const safeImage = /^(https?:\/\/|\/?assets\/)/i.test(image) ? image : "";
            const unit = normalizeSaleUnit(value);
            const existing = items.get(id);
            if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + units);
            else items.set(id, { id, name, price: money(price), quantity: units, image: safeImage, ...(unit === "each" && text(value.unit).toLowerCase() !== "each" ? {} : { unit }) });
        });
        return Array.from(items.values());
    }

    function normalizeBox(raw) {
        const value = object(raw);
        const box = {};
        let remaining = CAPACITY;
        BOX_PRODUCTS.forEach((name) => {
            const units = Math.min(remaining, quantity(value[name], CAPACITY));
            if (units) {
                box[name] = units;
                remaining -= units;
            }
        });
        return box;
    }

    function boxCount(raw) {
        return Object.values(normalizeBox(raw)).reduce((total, units) => total + units, 0);
    }

    function cartTotal(raw) {
        return money(normalizeCart(raw).reduce((total, item) => total + item.price * item.quantity, 0));
    }

    function resolveCheckoutMode(requested, rawBox, rawCart) {
        if (requested === "basket" || requested === "box") return requested;
        if (normalizeCart(rawCart).length) return "basket";
        if (boxCount(rawBox)) return "box";
        return "basket";
    }

    function summarizeCheckout({ mode, plan, box, cart } = {}) {
        const selectedMode = mode === "box" ? "box" : "basket";
        const items = normalizeCart(cart);
        const preferences = selectedMode === "box" ? normalizeBox(box) : {};
        const selectedPlan = selectedMode === "box" ? normalizePlan(plan) : null;
        const merchandise = cartTotal(items);
        const planTotal = selectedPlan ? selectedPlan.price : 0;
        const empty = selectedMode === "box" ? boxCount(preferences) === 0 : items.length === 0;
        return {
            mode: selectedMode,
            plan: selectedPlan,
            box: preferences,
            items,
            slotCount: boxCount(preferences),
            itemCount: items.reduce((total, item) => total + item.quantity, 0),
            planTotal,
            merchandise,
            delivery: 0,
            total: empty ? 0 : money(planTotal + merchandise),
            empty,
        };
    }

    function nextDeliveryDate(now = new Date()) {
        const date = new Date(now);
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7 || 7));
        return date;
    }

    function advanceDeliveryDate(value, frequency) {
        const date = new Date(value);
        if (frequency === "Monthly") {
            const day = date.getDate();
            date.setDate(1);
            date.setMonth(date.getMonth() + 1);
            const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
            date.setDate(Math.min(day, lastDay));
        } else {
            date.setDate(date.getDate() + (frequency === "Bi-weekly" ? 14 : 7));
        }
        return date;
    }

    function normalizeSchedule(raw, frequency, now = new Date()) {
        const value = object(raw);
        let next = new Date(typeof value.nextDate === "string" && value.nextDate.trim() ? value.nextDate : NaN);
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        if (!Number.isFinite(next.getTime())) next = nextDeliveryDate(now);
        let iterations = 0;
        while (next < today && iterations < 1200) {
            next = advanceDeliveryDate(next, frequency);
            iterations += 1;
        }
        if (next < today) next = nextDeliveryDate(now);
        return { paused: value.paused === true, nextDate: next.toISOString() };
    }

    function createOrder(input, now = new Date(), reference) {
        const summary = summarizeCheckout(input);
        if (summary.empty) return null;
        const date = new Date(now);
        const number = text(reference, 60) || `VM-${date.getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        return {
            version: 2,
            number,
            placedAt: date.toISOString(),
            deliveryDate: nextDeliveryDate(date).toISOString(),
            mode: summary.mode,
            plan: summary.plan ? { ...summary.plan } : null,
            box: { ...summary.box },
            items: summary.items.map((item) => ({ ...item })),
            total: summary.total,
        };
    }

    function normalizeOrder(raw) {
        const value = object(raw);
        if (value.version !== 2 || !["basket", "box"].includes(value.mode) || !text(value.number, 60) || !text(value.placedAt) || !Number.isFinite(new Date(value.placedAt).getTime())) return null;
        const summary = summarizeCheckout({ mode: value.mode, plan: value.plan, box: value.box, cart: value.items });
        if (summary.empty) return null;
        return {
            version: 2,
            number: text(value.number, 60),
            placedAt: new Date(value.placedAt).toISOString(),
            deliveryDate: text(value.deliveryDate) && Number.isFinite(new Date(value.deliveryDate).getTime()) ? new Date(value.deliveryDate).toISOString() : nextDeliveryDate(value.placedAt).toISOString(),
            mode: summary.mode,
            plan: summary.plan,
            box: summary.box,
            items: summary.items,
            total: summary.total,
        };
    }

    return Object.freeze({ CAPACITY, MAX_QUANTITY, PLANS, BOX_PRODUCTS, normalizePlan, normalizeSaleUnit, normalizeCart, normalizeBox, boxCount, cartTotal, resolveCheckoutMode, summarizeCheckout, nextDeliveryDate, advanceDeliveryDate, normalizeSchedule, createOrder, normalizeOrder });
});
