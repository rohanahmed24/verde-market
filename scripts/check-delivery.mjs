import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Script } from "node:vm";
import { excludedAssets, resolveLocalFile, rewriteCssAssets, rewriteHtmlAssets } from "./delivery-paths.mjs";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "dist");
const pages = readdirSync(root).filter((file) => file.endsWith(".html"));
const manifest = JSON.parse(readFileSync(join(output, "asset-manifest.json"), "utf8"));
const fonts = JSON.parse(readFileSync(join(root, "assets/fonts/manifest.json"), "utf8"));
const compiledCss = readFileSync(join(root, "assets/css/verde-tailwind.css"), "utf8");
const stylesheetOnlyPages = new Set(["index.html", "verde-market-shop-page.html"]);
const usedSymbols = new Set();
let inlineScripts = 0;

function checkLocalReferences(source, file, baseDirectory) {
    const references = [...source.matchAll(/(?:\b(?:href|src)=["']|url\(["']?)([^"'\s)<>]+)/g)].map((match) => match[1]);
    for (const match of source.matchAll(/\bsrcset=["']([^"']+)["']/g)) {
        if (!match[1].trim().startsWith("data:")) references.push(...match[1].split(",").map((candidate) => candidate.trim().split(/\s+/)[0]));
    }
    for (const reference of references) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) continue;
        const clean = decodeURIComponent(reference.split(/[?#]/)[0]);
        if (!clean) continue;
        const destination = clean.startsWith("/") ? resolve(output, clean.slice(1)) : resolve(baseDirectory, clean);
        const localPath = relative(output, destination);
        assert(localPath !== ".." && !localPath.startsWith(`..\\`) && !localPath.startsWith("../"), `${file}: reference leaves the published site: ${reference}`);
        assert(resolveLocalFile(output, reference, baseDirectory), `${file}: missing built asset/page ${reference}`);
    }
}

for (const file of pages) {
    const source = readFileSync(join(root, file), "utf8");
    const built = readFileSync(join(output, file), "utf8");
    assert(built === rewriteHtmlAssets(source, manifest), `${file}: production HTML is stale; rebuild`);
    assert(!/tailwindcss-browser|tailwind\.config|cdn\.tailwindcss/.test(source), `${file}: browser Tailwind compiler returned`);
    assert(!/fonts\.(?:googleapis|gstatic)\.com/.test(source), `${file}: third-party font request returned`);
    assert(!/lh3\.googleusercontent\.com/.test(source), `${file}: original external photography returned`);
    assert(!/src=["']assets\/vendor\/(?:lenis-|ScrollToPlugin-|CustomEase-)/.test(source), `${file}: unused motion library returned`);
    assert(/href="assets\/css\/verde-fonts\.css(?:\?v=[a-f\d]+)?"/.test(source), `${file}: self-hosted fonts missing`);
    if (!stylesheetOnlyPages.has(file)) assert(source.includes('href="assets/css/verde-tailwind.css"'), `${file}: compiled utilities missing`);
    const modelIndex = source.indexOf('src="assets/js/verde-commerce.js"');
    const uiIndex = source.indexOf('src="assets/js/verde-polish.js"');
    assert(modelIndex !== -1 && modelIndex < uiIndex, `${file}: commerce model must precede shared UI`);
    for (const [original, hashed] of Object.entries(manifest)) {
        if (source.includes(original)) {
            assert(built.includes(hashed), `${file}: fingerprint missing for ${original}`);
            assert(!built.includes(original), `${file}: unhashed asset URL survived build`);
        }
    }
    checkLocalReferences(built, file, output);
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc=/.test(match[1])) continue;
        if (/application\/ld\+json/.test(match[1])) JSON.parse(match[2]);
        else new Script(match[2], { filename: file });
        inlineScripts++;
    }
    for (const match of source.matchAll(/class=["'][^"']*material-symbols-outlined[^"']*["'][^>]*>\s*([a-z][a-z0-9_]+)\s*</g)) usedSymbols.add(match[1]);
}

for (const file of readdirSync(join(root, "assets/js")).filter((file) => file.endsWith(".js"))) {
    const absolute = join(root, "assets/js", file);
    const result = spawnSync(process.execPath, ["--check", absolute], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    for (const match of readFileSync(absolute, "utf8").matchAll(/materialIcon\(["']([a-z][a-z0-9_]+)["']/g)) usedSymbols.add(match[1]);
}
for (const name of usedSymbols) assert(fonts.symbols.includes(name), `Icon ${name} is missing from the font subset; run npm run assets:sync`);
for (const font of fonts.fonts) {
    const path = join(root, "assets/fonts", font.filename);
    assert(statSync(path).size > 1000, `Font ${font.filename} is empty`);
    assert.equal(readFileSync(path).subarray(0, 4).toString(), "wOF2", `${font.filename}: invalid WOFF2 file`);
}
assert(fonts.fonts.reduce((total, font) => total + font.bytes, 0) < 160000, "The self-hosted font payload exceeded its 160 KB budget");
assert(!/@import\s+url\(["']?https?:/.test(readFileSync(join(root, "assets/css/verde-polish.css"), "utf8")), "Render-blocking remote font import returned");

assert(compiledCss.length > 5000 && compiledCss.length < 80000, "Unexpected generated CSS size");
for (const selector of [".bg-primary", ".text-primary", ".text-slate-400", ".text-white", ".sr-only", ".bg-white\\/8", ".text-white\\/72"]) {
    assert(compiledCss.includes(selector), `Runtime utility ${selector} was purged from compiled CSS`);
}
for (const [source, hashed] of Object.entries(manifest)) {
    const original = readFileSync(join(root, source));
    const bytes = source.endsWith(".css") ? Buffer.from(rewriteCssAssets(original.toString("utf8"), source, manifest)) : original;
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    assert(hashed.includes(`.${hash}.`), `${source}: stale asset fingerprint; rebuild`);
    assert(readFileSync(join(output, hashed)).equals(bytes), `${source}: stale build output`);
    if (hashed.endsWith(".css")) checkLocalReferences(bytes.toString("utf8"), hashed, dirname(join(output, hashed)));
}

// Stable photo/icon URLs are intentionally not fingerprinted: saved baskets can
// keep those URLs across releases. They and the metadata still need freshness
// checks, just like hashed scripts and stylesheets.
const expectedFiles = new Set([".verde-generated", "asset-manifest.json", ...pages]);
function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    });
}
for (const file of walk(join(root, "assets"))) {
    const source = relative(root, file).replaceAll("\\", "/");
    if (excludedAssets.has(source)) continue;
    const target = manifest[source] || source;
    expectedFiles.add(target);
    assert(existsSync(join(output, target)), `${source}: missing from production output; rebuild`);
    if ([".css", ".js", ".woff2"].includes(extname(source))) {
        assert(manifest[source], `${source}: cache-sensitive asset is not fingerprinted`);
    } else {
        assert(readFileSync(join(output, target)).equals(readFileSync(file)), `${source}: copied production asset is stale; rebuild`);
    }
}
for (const file of ["robots.txt", "sitemap.xml", "site.webmanifest"]) {
    expectedFiles.add(file);
    assert(readFileSync(join(output, file)).equals(readFileSync(join(root, file))), `${file}: production metadata is stale; rebuild`);
}
for (const file of walk(output)) {
    const path = relative(output, file).replaceAll("\\", "/");
    assert(expectedFiles.has(path), `${path}: unexpected file in the published directory; rebuild`);
}
const webmanifest = JSON.parse(readFileSync(join(output, "site.webmanifest"), "utf8"));
for (const icon of webmanifest.icons || []) checkLocalReferences(`src="${icon.src}"`, "site.webmanifest", output);
const images = JSON.parse(readFileSync(join(root, "assets/images/manifest.json"), "utf8"));
for (const photo of images) {
    for (const path of [photo.path, photo.small?.path].filter(Boolean)) {
        assert(!manifest[path], `${path}: photo URLs stored in baskets must remain stable across builds`);
        assert(existsSync(join(output, path)), `${path}: photo manifest references a missing published image`);
    }
}

const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
assert.equal(config.outputDirectory, "dist");
assert.equal(config.buildCommand, "npm run build");
for (const rule of config.headers || []) {
    if (rule.source === "/assets/(.*)") {
        const cache = rule.headers.find((header) => header.key.toLowerCase() === "cache-control")?.value || "";
        assert(!cache.includes("immutable"), "Unversioned assets must not be cached immutably");
        assert(cache.includes("must-revalidate"), "Unversioned assets must revalidate across deployments");
    }
}
console.log(`Delivery checks passed: ${pages.length} built pages, ${inlineScripts} inline scripts, ${Object.keys(manifest).length} asset fingerprints, ${usedSymbols.size} used icons.`);
