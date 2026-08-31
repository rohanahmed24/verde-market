import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { once } from "node:events";
import { Agent, request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { createPreviewServer } from "./preview-site.mjs";

const root = resolve(import.meta.dirname, "..");
const client = new Agent({ keepAlive: true, maxSockets: 1 });
const queryLinks = [...readdirSync(root).filter((file) => file.endsWith(".html")), "assets/js/verde-polish.js"]
    .flatMap((file) => [...readFileSync(resolve(root, file), "utf8").matchAll(/["']((?:build-my-box-|verde-market-)[^"'\s<>]*\?[^"'\s<>]+)["']/g)]
        .map((match) => ({ file, href: match[1] })));

async function request(url, options = {}, remainingRedirects = 5) {
    const result = await new Promise((done, reject) => {
        const req = httpRequest(url, { method: options.method || "GET", agent: client }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("error", (error) => reject(new Error(`${options.method || "GET"} ${url}: ${error.message}`, { cause: error })));
            response.on("end", () => {
                const body = Buffer.concat(chunks);
                done({
                    url,
                    status: response.statusCode,
                    headers: new Headers(response.headers),
                    text: async () => body.toString("utf8"),
                    arrayBuffer: async () => body,
                });
            });
        });
        req.on("error", (error) => reject(new Error(`${options.method || "GET"} ${url}: ${error.message}`, { cause: error })));
        req.setTimeout(10000, () => req.destroy(new Error(`Preview request timed out: ${url}`)));
        req.end();
    });
    if (options.redirect !== "manual" && [301, 302, 307, 308].includes(result.status)) {
        assert.ok(remainingRedirects > 0, `Redirect loop: ${url}`);
        return request(new URL(result.headers.get("location"), url).href, options, remainingRedirects - 1);
    }
    return result;
}

async function withPreview(exercise) {
    const server = createPreviewServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
        await exercise(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.closeAllConnections();
        await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
}

test("preview: clean-URL redirects preserve checkout, search, topic, and encoded query values", async () => {
    await withPreview(async (base) => {
        for (const [path, canonical] of [
            ["/build-my-box-checkout-finalize.html?checkout=basket", "/build-my-box-checkout-finalize?checkout=basket"],
            ["/build-my-box-checkout-finalize.html?checkout=box", "/build-my-box-checkout-finalize?checkout=box"],
            ["/verde-market-shop-page.html?q=Baby+Spinach&sort=price-asc", "/verde-market-shop-page?q=Baby+Spinach&sort=price-asc"],
            ["/verde-market-blog-journal.html?topic=wellness&q=farm%26table", "/verde-market-blog-journal?topic=wellness&q=farm%26table"],
            ["/verde-market-locations/?q=brooklyn", "/verde-market-locations?q=brooklyn"],
        ]) {
            const redirect = await request(base + path, { redirect: "manual" });
            assert.equal(redirect.status, 301, path);
            assert.equal(redirect.headers.get("location"), canonical, path);
            const page = await request(base + path);
            assert.equal(page.status, 200, path);
            assert.equal(page.url, base + canonical, path);
            assert.match(await page.text(), /<main\b/);
        }
        const home = await request(`${base}/index.html?utm_source=portfolio`);
        assert.equal(home.status, 200);
        assert.equal(home.url, `${base}/?utm_source=portfolio`);
    });
});

test("query-bearing navigation bypasses cached .html redirects and loads directly", async () => {
    const required = [
        "build-my-box-checkout-finalize?checkout=basket",
        "build-my-box-checkout-finalize?checkout=box",
        "build-my-box-select-plan?edit=subscription",
        "build-my-box-customize-contents?edit=subscription",
    ];
    for (const { file, href } of queryLinks) {
        assert.equal(new URL(href, "https://verde.test/").pathname.endsWith(".html"), false, `${file}: ${href} must bypass cached redirects`);
    }
    for (const href of required) assert(queryLinks.some((link) => link.href === href), `Missing direct navigation: ${href}`);
    await withPreview(async (base) => {
        for (const href of new Set(queryLinks.map((link) => link.href))) {
            const response = await request(`${base}/${href}`, { redirect: "manual" });
            assert.equal(response.status, 200, href);
            assert.equal(response.headers.has("location"), false, href);
        }
    });
});

test("preview: every clean page route resolves; missing pages and private files stay unavailable", async () => {
    await withPreview(async (base) => {
        for (const page of readdirSync(root).filter((file) => file.endsWith(".html"))) {
            const path = page === "index.html" ? "/" : `/${page.replace(/\.html$/, "")}`;
            const response = await request(base + path);
            assert.equal(response.status, 200, path);
            assert.match(response.headers.get("content-type"), /^text\/html/);
            assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        }
        for (const path of ["/missing-page", "/package.json", "/package-lock.json", "/README.md", "/scripts/check-site.mjs", "/vercel.json", "/assets/"]) {
            const response = await request(base + path);
            assert.equal(response.status, 404, path);
        }
    });
});

test("preview: production CSS, JavaScript, fonts, and persisted basket photos load without HTML fallbacks", async () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "dist/asset-manifest.json"), "utf8"));
    const photos = JSON.parse(readFileSync(resolve(root, "assets/images/manifest.json"), "utf8"));
    await withPreview(async (base) => {
        const cases = [
            [manifest["assets/css/verde-fonts.css"], /^text\/css/],
            [manifest["assets/js/verde-polish.js"], /javascript/],
            [manifest["assets/fonts/material-symbols-subset.woff2"], /woff2/],
            [photos[0].path, /^image\/webp/],
            ["site.webmanifest", /manifest\+json/],
        ];
        for (const [path, mime] of cases) {
            assert.ok(path);
            const response = await request(`${base}/${path}`);
            assert.equal(response.status, 200, path);
            assert.match(response.headers.get("content-type"), mime, path);
            assert.ok((await response.arrayBuffer()).byteLength > 0, path);
            const head = await request(`${base}/${path}`, { method: "HEAD" });
            assert.equal(head.status, 200, path);
            assert.equal((await head.arrayBuffer()).byteLength, 0, path);
        }
    });
});
