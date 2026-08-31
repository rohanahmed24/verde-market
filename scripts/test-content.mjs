import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const root = resolve(import.meta.dirname, "..");
const pages = {
    shop: "verde-market-shop-page.html",
    locations: "verde-market-locations.html",
    journal: "verde-market-blog-journal.html",
};
const localScripts = new Map([
    ["assets/js/verde-commerce.js", readFileSync(resolve(root, "assets/js/verde-commerce.js"), "utf8")],
    ["assets/js/verde-polish.js", readFileSync(resolve(root, "assets/js/verde-polish.js"), "utf8")],
]);

// Real page markup and controllers, without fetching assets or running a browser.
// Classic inline scripts execute before the local deferred application scripts.
async function boot(page, suffix = "", { cleanURL = false } = {}) {
    const errors = [];
    const scrollTargets = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => errors.push(error.message));
    const pathname = cleanURL ? page.replace(/\.html$/, "") : page;
    const dom = new JSDOM(readFileSync(resolve(root, page), "utf8"), {
        url: `https://verde.test/${pathname}${suffix}`,
        runScripts: "outside-only",
        pretendToBeVisual: true,
        virtualConsole,
    });
    const { window } = dom;
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = function () { scrollTargets.push(this.id); };
    window.HTMLElement.prototype.getClientRects = function () {
        return this.closest("[hidden], .verde-hidden") ? [] : [{ width: 44, height: 44 }];
    };

    const scripts = [...window.document.querySelectorAll("script")];
    for (const script of scripts) {
        if (!script.hasAttribute("src") && (!script.type || script.type === "text/javascript")) {
            window.eval(script.textContent);
        }
    }
    for (const script of scripts) {
        const source = localScripts.get(script.getAttribute("src"));
        if (source) window.eval(source);
    }
    if (window.document.readyState === "loading") {
        await new Promise((done) => window.document.addEventListener("DOMContentLoaded", done, { once: true }));
    }
    await tick(window);
    return { dom, window, document: window.document, errors, scrollTargets };
}

const tick = (window) => new Promise((done) => window.setTimeout(done, 0));
const visible = (element) => !element.hidden && !element.classList.contains("verde-hidden") && !element.classList.contains("shop-search-hidden");
const shown = (document, selector) => [...document.querySelectorAll(selector)].filter(visible);
const shopNames = (document) => shown(document, "#product-grid .product-card").map((card) => card.querySelector("h3").textContent);
const locationIDs = (document) => shown(document, "[data-location-card]").map((card) => card.id);
const journalIDs = (document) => shown(document, ".journal-card[data-topic]").map((card) => card.id);

function enter(window, selector, value) {
    const input = window.document.querySelector(selector);
    assert.ok(input, `Missing input: ${selector}`);
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    return input;
}

function chooseSort(window, value) {
    const select = window.document.getElementById("shop-sort");
    select.value = value;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

async function eventAfter(window, event, action) {
    const observed = new Promise((done) => window.addEventListener(event, done, { once: true }));
    action();
    await observed;
    await tick(window);
}

async function withPage(page, suffix, exercise, options) {
    const context = await boot(page, suffix, options);
    try {
        await exercise(context);
        assert.deepEqual(context.errors, [], "Page controllers should not emit DOM/runtime errors");
    } finally {
        context.dom.window.close();
    }
}

test("shop: ingredient search and category intersect, expose empty state, and reset together", async () => {
    await withPage(pages.shop, "?utm_source=portfolio", async ({ window, document }) => {
        const initial = shopNames(document);
        assert.equal(initial.length, 8);
        assert.equal(document.body.dataset.shopFiltersManaged, "true");
        enter(window, "#shop-search", "spinach");
        assert.deepEqual(shopNames(document), ["Baby Spinach"]);
        assert.match(document.getElementById("shop-results-count").textContent, /^1 of 8/);
        assert.equal(new URL(window.location.href).searchParams.get("q"), "spinach");

        document.querySelector('[data-shop-filter="fruits"]').click();
        assert.deepEqual(shopNames(document), []);
        assert.equal(document.getElementById("shop-search-empty").hidden, false);
        assert.equal(window.location.hash, "#fruits");
        document.querySelector("#shop-search-empty [data-shop-reset]").click();
        assert.deepEqual(shopNames(document), initial);
        assert.equal(document.getElementById("shop-search-empty").hidden, true);
        assert.equal(document.getElementById("shop-search").value, "");
        assert.equal(document.getElementById("shop-sort").value, "featured");
        assert.equal(document.activeElement.id, "shop-search");
        const url = new URL(window.location.href);
        assert.equal(url.searchParams.has("q"), false);
        assert.equal(url.searchParams.get("utm_source"), "portfolio");
        assert.equal(url.hash, "");
    });
});

test("shop: sort controls reorder real cards, including a filtered aisle", async () => {
    await withPage(pages.shop, "", async ({ window, document }) => {
        chooseSort(window, "price-asc");
        const prices = shown(document, "#product-grid .product-card").map((card) => Number(card.dataset.price));
        assert.deepEqual(prices, prices.slice().sort((a, b) => a - b));
        chooseSort(window, "name");
        const names = shopNames(document);
        assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
        document.querySelector('[data-shop-filter="pantry"]').click();
        chooseSort(window, "price-desc");
        assert.deepEqual(shopNames(document), ["Pantry Trio", "Granola Clusters"]);
        assert.equal(new URL(window.location.href).searchParams.get("sort"), "price-desc");
        assert.equal(window.location.hash, "#pantry");
        assert.equal(document.querySelectorAll('[data-shop-filter][aria-pressed="true"]').length, 1);
    });
});

test("shop: direct query/hash state initializes on a clean production-style route", async () => {
    await withPage(pages.shop, "?q=apple&sort=price-asc#fruits", async ({ window, document }) => {
        assert.deepEqual(shopNames(document), ["Honeycrisp Apples"]);
        assert.equal(document.getElementById("shop-search").value, "apple");
        assert.equal(document.getElementById("shop-sort").value, "price-asc");
        assert.equal(document.querySelector('[data-shop-filter="fruits"]').getAttribute("aria-pressed"), "true");
        enter(window, "#shop-search", "avocado");
        assert.equal(window.location.pathname.endsWith(".html"), false);
        assert.deepEqual(shopNames(document), ["Hass Avocados"]);
    }, { cleanURL: true });
});

for (const hash of ["products", "unknown-aisle"]) {
    test(`shop: #${hash} is not mistaken for an empty product category`, async () => {
        await withPage(pages.shop, `#${hash}`, async ({ document }) => {
            assert.equal(shopNames(document).length, 8);
            assert.equal(document.querySelector('[data-shop-filter="all"]').getAttribute("aria-pressed"), "true");
            assert.equal(document.getElementById("shop-search-empty").hidden, true);
            assert.equal(document.querySelectorAll("#product-grid > .verde-empty-state").length, 0);
        });
    });
}

test("shop: back and forward restore search, category, sort, and product visibility", { timeout: 5000 }, async () => {
    await withPage(pages.shop, "?q=apple&sort=price-asc#fruits", async ({ window, document }) => {
        document.querySelector('[data-shop-filter="dairy"]').click();
        chooseSort(window, "price-desc");
        await eventAfter(window, "popstate", () => window.history.back());
        assert.equal(document.getElementById("shop-sort").value, "price-asc");
        assert.equal(document.querySelector('[data-shop-filter="dairy"]').getAttribute("aria-pressed"), "true");
        await eventAfter(window, "popstate", () => window.history.back());
        assert.equal(document.getElementById("shop-search").value, "apple");
        assert.deepEqual(shopNames(document), ["Honeycrisp Apples"]);
        assert.equal(document.querySelector('[data-shop-filter="fruits"]').getAttribute("aria-pressed"), "true");
        await eventAfter(window, "popstate", () => window.history.forward());
        assert.equal(window.location.hash, "#dairy");
        assert.deepEqual(shopNames(document), []);
        assert.equal(document.getElementById("shop-search-empty").hidden, false);
    });
});

test("shop: search feedback treats input as text, never as injected markup", async () => {
    await withPage(pages.shop, "", async ({ window, document }) => {
        const query = '<img src=x onerror="alert(1)">';
        enter(window, "#shop-search", query);
        assert.equal(document.getElementById("shop-results-count").textContent.includes(query), true);
        assert.equal(document.getElementById("shop-results-count").querySelector("img"), null);
        assert.equal(document.getElementById("shop-search-empty").hidden, false);
    });
});

test("locations: query initialization, no-result feedback, and reset use real location cards", async () => {
    await withPage(pages.locations, "?q=brooklyn", async ({ window, document }) => {
        assert.equal(document.body.dataset.locationSearchManaged, "true");
        assert.deepEqual(locationIDs(document), ["location-brooklyn"]);
        assert.match(document.getElementById("location-results-count").textContent, /^1 of 3/);
        enter(window, "#location-search-input", "no-such-neighborhood");
        assert.deepEqual(locationIDs(document), []);
        assert.equal(document.getElementById("location-empty").hidden, false);
        assert.match(document.getElementById("location-results-count").textContent, /^0 of 3/);
        document.querySelector("#location-empty [data-location-reset]").click();
        assert.equal(locationIDs(document).length, 3);
        assert.equal(document.getElementById("location-empty").hidden, true);
        assert.equal(document.activeElement.id, "location-search-input");
        assert.equal(new URL(window.location.href).searchParams.has("q"), false);
    });
});

test("locations: a map pin clears the filter before navigating to its hidden card", { timeout: 5000 }, async () => {
    await withPage(pages.locations, "?q=brooklyn", async ({ window, document }) => {
        assert.equal(visible(document.getElementById("location-downtown")), false);
        await eventAfter(window, "hashchange", () => document.querySelector(".locations-pin--downtown").click());
        assert.equal(window.location.hash, "#location-downtown");
        assert.equal(document.getElementById("location-search-input").value, "");
        assert.equal(visible(document.getElementById("location-downtown")), true);
        assert.equal(locationIDs(document).length, 3);
        assert.equal(new URL(window.location.href).searchParams.has("q"), false);
    });
});

test("locations: native store disclosures expand and map actions remain real, safely labelled links", async () => {
    await withPage(pages.locations, "", async ({ window, document }) => {
        const card = document.getElementById("location-brooklyn");
        const details = card.querySelector("details");
        details.querySelector("summary").click();
        await tick(window);
        assert.equal(details.open, true);
        assert.match(details.textContent, /Portfolio preview only/);
        details.querySelector("summary").click();
        assert.equal(details.open, false);
        const map = card.querySelector('a[href^="https://www.google.com/maps/"]');
        assert.match(map.getAttribute("aria-label"), /Brooklyn.*opens a new tab/);
        assert.equal(map.target, "_blank");
        assert.match(map.rel, /noopener/);
        assert.match(new URL(map.href).searchParams.get("query"), /Brooklyn/);
        assert.equal(document.querySelector('a[href^="tel:"]'), null);
    });
});

const homepage = new JSDOM(readFileSync(resolve(root, "index.html"), "utf8"));
const journalLinks = [...homepage.window.document.querySelectorAll(".home-article a")].map((link) => ({
    title: link.closest("article").querySelector("h3").textContent,
    url: new URL(link.getAttribute("href"), "https://verde.test/"),
}));
homepage.window.close();

test("homepage: all four editorial cards keep distinct, concrete journal deep links", () => {
    assert.equal(journalLinks.length, 4);
    assert.equal(new Set(journalLinks.map(({ url }) => url.hash)).size, 4);
});

for (const { title, url } of journalLinks) {
    test(`journal: homepage deep link opens the exact note — ${title}`, async () => {
        assert.equal(url.pathname, `/${pages.journal.replace(/\.html$/, "")}`);
        assert.ok(url.hash, "Every homepage article must target a concrete field note");
        await withPage(pages.journal, url.search + url.hash, async ({ document }) => {
            const note = document.getElementById(url.hash.slice(1));
            assert.ok(note?.matches(".journal-card"));
            assert.equal(visible(note), true);
            assert.equal(note.querySelector("details").open, true);
            assert.match(note.querySelector("summary").getAttribute("aria-label"), /^Close field note: /);
            const selected = document.querySelector('[data-topic-filter][aria-pressed="true"]');
            assert.equal(selected.dataset.topicFilter, url.searchParams.get("topic"));
        });
    });
}

test("journal: topic/search empty state resets every note and returns focus to search", async () => {
    await withPage(pages.journal, "?topic=wellness", async ({ window, document }) => {
        assert.equal(journalIDs(document).length, 2);
        enter(window, "#journal-search-input", "no-matching-note");
        assert.deepEqual(journalIDs(document), []);
        assert.equal(visible(document.getElementById("journal-empty")), true);
        document.querySelector("[data-journal-reset]").click();
        assert.equal(journalIDs(document).length, 4);
        assert.equal(visible(document.getElementById("journal-empty")), false);
        assert.equal(document.getElementById("journal-search-input").value, "");
        assert.equal(document.activeElement.id, "journal-search-input");
        assert.equal(new URL(window.location.href).searchParams.has("topic"), false);
        assert.equal(document.querySelector('[data-topic-filter="all"]').getAttribute("aria-pressed"), "true");
        document.querySelector('[data-topic-filter="recipes"]').click();
        enter(window, "#journal-search-input", "weeknight");
        assert.deepEqual(journalIDs(document), ["organic-weeknight-dinners"]);
    });
});

test("journal: disclosure label/icon track the native open state and Latest is chronological", async () => {
    await withPage(pages.journal, "", async ({ window, document }) => {
        const dates = [...document.querySelectorAll(".journal-card time")].map((time) => time.dateTime);
        assert.deepEqual(dates, dates.slice().sort().reverse());
        const details = document.querySelector(".journal-card details");
        const summary = details.querySelector("summary");
        summary.click();
        await tick(window);
        assert.equal(details.open, true);
        assert.equal(summary.querySelector("[data-note-label]").textContent, "Close field note");
        assert.equal(summary.querySelector(".material-symbols-outlined").textContent, "remove");
        summary.click();
        await tick(window);
        assert.equal(details.open, false);
        assert.equal(summary.querySelector("[data-note-label]").textContent, "Read field note");
        assert.equal(summary.querySelector(".material-symbols-outlined").textContent, "add");
        for (const filter of document.querySelectorAll("[data-topic-filter]")) {
            assert.equal(filter.tagName, "BUTTON");
            assert.equal(filter.getAttribute("aria-controls"), "journal-grid");
        }
    });
});

test("journal: copied search initializes results and topic changes preserve clean routes and unrelated parameters", async () => {
    await withPage(pages.journal, "?q=honey&utm_source=portfolio", async ({ window, document }) => {
        assert.equal(document.getElementById("journal-search-input").value, "honey");
        assert.deepEqual(journalIDs(document), ["raw-honey-benefits"]);
        document.querySelector('[data-topic-filter="wellness"]').click();
        const url = new URL(window.location.href);
        assert.equal(url.pathname, "/verde-market-blog-journal");
        assert.equal(url.searchParams.get("q"), "honey");
        assert.equal(url.searchParams.get("utm_source"), "portfolio");
        assert.equal(url.searchParams.get("topic"), "wellness");
        assert.match(document.getElementById("journal-results-count").textContent, /^1 of 4/);
    }, { cleanURL: true });
});

test("journal: unrecognized topics fall back to Latest with a selected control", async () => {
    await withPage(pages.journal, "?topic=unknown", async ({ document }) => {
        assert.equal(journalIDs(document).length, 4);
        assert.equal(document.querySelector('[data-topic-filter="all"]').getAttribute("aria-pressed"), "true");
    });
});

test("journal: back and forward restore topic, query, and visible notes", { timeout: 5000 }, async () => {
    await withPage(pages.journal, "?topic=wellness&q=honey", async ({ window, document }) => {
        document.querySelector('[data-topic-filter="recipes"]').click();
        enter(window, "#journal-search-input", "weeknight");
        assert.equal(new URL(window.location.href).searchParams.get("q"), "weeknight");
        assert.deepEqual(journalIDs(document), ["organic-weeknight-dinners"]);
        await eventAfter(window, "popstate", () => window.history.back());
        assert.equal(document.getElementById("journal-search-input").value, "honey");
        assert.deepEqual(journalIDs(document), ["raw-honey-benefits"]);
        assert.equal(document.querySelector('[data-topic-filter="wellness"]').getAttribute("aria-pressed"), "true");
        await eventAfter(window, "popstate", () => window.history.forward());
        assert.equal(document.getElementById("journal-search-input").value, "weeknight");
        assert.deepEqual(journalIDs(document), ["organic-weeknight-dinners"]);
    });
});

test("journal: an exact note deep link reveals and scrolls its target despite conflicting filters", async () => {
    await withPage(pages.journal, "?topic=recipes&q=weeknight#raw-honey-benefits", async ({ window, document, scrollTargets }) => {
        const note = document.getElementById("raw-honey-benefits");
        assert.equal(visible(note), true);
        assert.equal(note.querySelector("details").open, true);
        assert.equal(document.getElementById("journal-search-input").value, "");
        assert.equal(document.querySelector('[data-topic-filter="wellness"]').getAttribute("aria-pressed"), "true");
        assert.equal(new URL(window.location.href).searchParams.get("topic"), "wellness");
        assert.ok(scrollTargets.includes(note.id));
    });
});

test("journal: same-page article navigation reveals a filtered note and preserves earlier history", { timeout: 5000 }, async () => {
    await withPage(pages.journal, "?topic=recipes&q=weeknight", async ({ window, document, scrollTargets }) => {
        await eventAfter(window, "hashchange", () => { window.location.hash = "#smith-family-farm"; });
        assert.deepEqual(journalIDs(document), ["smith-family-farm"]);
        assert.equal(document.getElementById("smith-family-farm").querySelector("details").open, true);
        assert.ok(scrollTargets.includes("smith-family-farm"));
        await eventAfter(window, "popstate", () => window.history.back());
        assert.deepEqual(journalIDs(document), ["organic-weeknight-dinners"]);
        assert.equal(document.getElementById("journal-search-input").value, "weeknight");
    });
});

test("journal: filtering after a deep link removes its stale note hash", async () => {
    await withPage(pages.journal, "?topic=wellness#raw-honey-benefits", async ({ window, document }) => {
        enter(window, "#journal-search-input", "kimchi");
        assert.deepEqual(journalIDs(document), ["fermented-foods-guide"]);
        assert.equal(window.location.hash, "");
        assert.equal(new URL(window.location.href).searchParams.get("q"), "kimchi");
    });
});

test("journal: featured-note deep links expand the native disclosure", async () => {
    await withPage(pages.journal, "#spring-harvest-notes", async ({ document, scrollTargets }) => {
        assert.equal(document.getElementById("spring-harvest-notes").open, true);
        assert.ok(scrollTargets.includes("spring-harvest-notes"));
    });
});

test("journal: header Subscribe hands keyboard focus to the newsletter email", async () => {
    await withPage(pages.journal, "", async ({ document, scrollTargets }) => {
        document.querySelector(".journal-subscribe-button").click();
        assert.equal(document.activeElement.id, "journal-email");
        assert.ok(scrollTargets.includes("journal-email"));
    });
});

test("locations: a copied link cannot leave its target neighborhood hidden", async () => {
    await withPage(pages.locations, "?q=brooklyn&utm_source=portfolio#location-queens", async ({ window, document, scrollTargets }) => {
        assert.equal(visible(document.getElementById("location-queens")), true);
        assert.equal(document.getElementById("location-search-input").value, "");
        assert.equal(new URL(window.location.href).searchParams.has("q"), false);
        assert.equal(new URL(window.location.href).searchParams.get("utm_source"), "portfolio");
        assert.ok(scrollTargets.includes("location-queens"));
    });
});

test("locations: map navigation retains the prior search for Back", { timeout: 5000 }, async () => {
    await withPage(pages.locations, "?q=brooklyn", async ({ window, document }) => {
        await eventAfter(window, "hashchange", () => document.querySelector(".locations-pin--downtown").click());
        assert.equal(window.location.hash, "#location-downtown");
        assert.equal(document.getElementById("location-search-input").value, "");
        await eventAfter(window, "popstate", () => window.history.back());
        assert.equal(document.getElementById("location-search-input").value, "brooklyn");
        assert.deepEqual(locationIDs(document), ["location-brooklyn"]);
    });
});

test("locations: hash navigation reveals its target, and new searches discard stale card hashes", { timeout: 5000 }, async () => {
    await withPage(pages.locations, "?q=brooklyn", async ({ window, document, scrollTargets }) => {
        await eventAfter(window, "hashchange", () => { window.location.hash = "#location-queens"; });
        assert.equal(visible(document.getElementById("location-queens")), true);
        assert.ok(scrollTargets.includes("location-queens"));
        enter(window, "#location-search-input", "brooklyn");
        assert.deepEqual(locationIDs(document), ["location-brooklyn"]);
        assert.equal(window.location.hash, "");
    });
});

test("locations: Back undoes a deliberate search reset", { timeout: 5000 }, async () => {
    await withPage(pages.locations, "?q=brooklyn", async ({ window, document }) => {
        const previousLength = window.history.length;
        document.querySelector(".locations-reset").click();
        assert.equal(window.history.length, previousLength + 1);
        assert.equal(locationIDs(document).length, 3);
        await eventAfter(window, "popstate", () => window.history.back());
        assert.equal(document.getElementById("location-search-input").value, "brooklyn");
        assert.deepEqual(locationIDs(document), ["location-brooklyn"]);
    });
});

test("journal: search indexes article content, not disclosure control labels", async () => {
    await withPage(pages.journal, "", async ({ window, document }) => {
        enter(window, "#journal-search-input", "Read field note");
        assert.deepEqual(journalIDs(document), []);
        const query = '<img src=x onerror="alert(1)">';
        enter(window, "#journal-search-input", query);
        assert.equal(document.getElementById("journal-results-count").textContent.includes(query), true);
        assert.equal(document.getElementById("journal-results-count").querySelector("img"), null);
    });
});

test("journal: reset is one history entry and preserves a clean route and attribution", { timeout: 5000 }, async () => {
    await withPage(pages.journal, "?topic=recipes&q=no-match&utm_source=portfolio", async ({ window, document }) => {
        const previousLength = window.history.length;
        document.querySelector("[data-journal-reset]").click();
        const url = new URL(window.location.href);
        assert.equal(window.history.length, previousLength + 1);
        assert.equal(url.pathname, "/verde-market-blog-journal");
        assert.equal(url.searchParams.get("utm_source"), "portfolio");
        assert.equal(url.searchParams.has("topic"), false);
        assert.equal(url.searchParams.has("q"), false);
        await eventAfter(window, "popstate", () => window.history.back());
        assert.equal(document.getElementById("journal-search-input").value, "no-match");
        assert.deepEqual(journalIDs(document), []);
    }, { cleanURL: true });
});

for (const page of [pages.journal, pages.locations]) {
    test(`${page}: malformed fragment does not crash search controllers`, async () => {
        await withPage(page, "#%E0%A4%A", async ({ window, document }) => {
            if (page === pages.journal) {
                enter(window, "#journal-search-input", "honey");
                assert.deepEqual(journalIDs(document), ["raw-honey-benefits"]);
            } else {
                enter(window, "#location-search-input", "brooklyn");
                assert.deepEqual(locationIDs(document), ["location-brooklyn"]);
            }
        });
    });
}
