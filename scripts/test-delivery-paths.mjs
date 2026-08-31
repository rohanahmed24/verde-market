import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveLocalFile, rewriteCssAssets, rewriteHtmlAssets } from "./delivery-paths.mjs";

const manifest = {
    "assets/fonts/verde.woff2": "assets/fonts/verde.123456789abc.woff2",
    "assets/js/verde.js": "assets/js/verde.123456789abc.js",
};

test("local link checks resolve real clean routes without accepting missing routes or traversal", () => {
    const root = resolve(import.meta.dirname, "..");
    const journal = resolve(root, "verde-market-blog-journal.html");
    assert.equal(resolveLocalFile(root, "verde-market-blog-journal?topic=recipes#journal-grid"), journal);
    assert.equal(resolveLocalFile(root, "/verde-market-blog-journal?topic=wellness"), journal);
    assert.equal(resolveLocalFile(root, "verde-market-blog-journal.html?topic=recipes"), journal);
    assert.equal(resolveLocalFile(root, "/?utm_source=portfolio"), resolve(root, "index.html"));
    assert.equal(resolveLocalFile(root, "no-such-verde-page?checkout=basket"), null);
    assert.equal(resolveLocalFile(root, "verde-market-blog-journal.missing?topic=recipes"), null);
    assert.equal(resolveLocalFile(root, "../package.json"), null);
    assert.equal(resolveLocalFile(root, "/%2e%2e%5cpackage.json"), null);
});

test("CSS asset rewriting handles root-relative URLs and preserves non-version queries and fragments", () => {
    assert.equal(
        rewriteCssAssets('src:url("/assets/fonts/verde.woff2?v=abcdef&display=swap#glyph")', "assets/css/verde.css", manifest),
        'src:url("/assets/fonts/verde.123456789abc.woff2?display=swap#glyph")',
    );
    assert.equal(
        rewriteCssAssets("src:url(../fonts/verde.woff2?v=abcdef#glyph)", "assets/css/verde.css", manifest),
        "src:url(../fonts/verde.123456789abc.woff2#glyph)",
    );
});

test("HTML asset rewriting only changes exact local references", () => {
    const html = '<script src="assets/js/verde.js?v=abcdef&amp;mode=demo#start"></script><script src="/assets/js/verde.js"></script>' +
        '<a href="https://cdn.example.test/assets/js/verde.js">External</a><a href="assets/js/verde.js.map">Map</a>';
    assert.equal(
        rewriteHtmlAssets(html, manifest),
        '<script src="assets/js/verde.123456789abc.js?mode=demo#start"></script><script src="/assets/js/verde.123456789abc.js"></script>' +
        '<a href="https://cdn.example.test/assets/js/verde.js">External</a><a href="assets/js/verde.js.map">Map</a>',
    );
});
