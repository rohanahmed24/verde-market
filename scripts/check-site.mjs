import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { resolveLocalFile } from "./delivery-paths.mjs";

const root = resolve(import.meta.dirname, "..");
const htmlFiles = readdirSync(root)
    .filter((file) => extname(file).toLowerCase() === ".html")
    .sort();

const errors = [];
const warnings = [];
const documents = new Map(
    htmlFiles.map((file) => [file, readFileSync(resolve(root, file), "utf8")]),
);

function report(collection, file, message) {
    collection.push(`${file}: ${message}`);
}

function localPart(value) {
    return value.split("?")[0].split("#")[0];
}

function isExternal(value) {
    return /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(value);
}

function idsFor(file) {
    const source = documents.get(file);
    if (!source) return new Set();
    return new Set(Array.from(source.matchAll(/\sid=["']([^"']+)["']/gi), (match) => match[1]));
}

for (const [file, source] of documents) {
    const descriptionTag = Array.from(source.matchAll(/<meta\b[^>]*>/gi), (match) => match[0])
        .find((tag) => /\bname=["']description["']/i.test(tag));
    const description = descriptionTag?.match(/\bcontent=(["'])(.*?)\1/i)?.[2].trim() || "";

    if (!/<title>\s*[^<]{8,}\s*<\/title>/i.test(source)) {
        report(errors, file, "missing a descriptive <title>.");
    }
    if (description.length < 40) {
        report(errors, file, "missing a useful meta description (40+ characters).");
    }
    if (!/assets\/css\/verde-polish\.css/i.test(source)) {
        report(errors, file, "does not load the shared Verde design system.");
    }
    if (!/assets\/js\/verde-polish\.js/i.test(source)) {
        report(errors, file, "does not load the shared interaction layer.");
    }
    if (!/site\.webmanifest/i.test(source)) {
        report(errors, file, "does not link the web manifest.");
    }
    if (!/rel=["'](?:shortcut\s+)?icon["']/i.test(source)) {
        report(errors, file, "does not provide a favicon.");
    }
    if (/href=["']#["']/i.test(source)) {
        report(errors, file, "contains a dead href=\"#\" link.");
    }
    if (/©\s*2024/i.test(source)) {
        report(errors, file, "contains a stale 2024 copyright year.");
    }
    if (/(?:cdn\.tailwindcss\.com|cdn\.jsdelivr\.net\/npm\/(?:gsap|@studio-freight\/lenis))/i.test(source)) {
        report(errors, file, "still relies on a runtime UI/motion CDN.");
    }
    if (/tailwindcss-browser|tailwind\.config/i.test(source)) {
        report(errors, file, "still compiles Tailwind CSS inside the browser.");
    }
    if (!/assets\/css\/verde-fonts\.css/i.test(source)) {
        report(errors, file, "does not load the self-hosted typography.");
    }
    if (/lh3\.googleusercontent\.com/i.test(source)) {
        report(errors, file, "still loads original third-party photography instead of a local optimized asset.");
    }

    const ids = idsFor(file);
    const references = source.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi);
    for (const [, rawValue] of references) {
        const value = rawValue.trim();
        if (!value || isExternal(value)) continue;

        if (value.startsWith("#")) {
            const anchor = decodeURIComponent(value.slice(1));
            if (anchor && !ids.has(anchor)) {
                report(errors, file, `links to missing in-page anchor #${anchor}.`);
            }
            continue;
        }

        const cleanPath = decodeURIComponent(localPart(value)).replace(/^\.\//, "").replace(/^\//, "");
        if (!cleanPath) continue;
        const absolute = resolveLocalFile(root, value);
        if (!absolute) {
            report(errors, file, `references missing local asset/page: ${cleanPath}.`);
            continue;
        }

        const hashIndex = value.indexOf("#");
        if (hashIndex !== -1 && absolute.toLowerCase().endsWith(".html")) {
            const targetFile = relative(root, absolute).replaceAll("\\", "/");
            const anchor = decodeURIComponent(value.slice(hashIndex + 1));
            const targetSource = documents.get(targetFile) || "";
            const dynamicFilter = new RegExp(`data-(?:shop-filter|topic-filter)=["']${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(targetSource);
            if (anchor && documents.has(targetFile) && !idsFor(targetFile).has(anchor) && !dynamicFilter) {
                report(errors, file, `links to missing anchor ${targetFile}#${anchor}.`);
            }
        }
    }

    for (const match of source.matchAll(/<img\b([^>]*)>/gi)) {
        const attributes = match[1];
        if (!/\salt=["'][^"']*["']/i.test(attributes)) {
            report(errors, file, "contains an <img> without an alt attribute.");
        }
        if (/src=["']assets\/images\//i.test(attributes) && (!/\swidth=/i.test(attributes) || !/\sheight=/i.test(attributes))) {
            report(errors, file, "contains a local photo without intrinsic width and height.");
        }
    }

    for (const match of source.matchAll(/<a\b([^>]*)target=["']_blank["']([^>]*)>/gi)) {
        const attributes = `${match[1]} ${match[2]}`;
        if (!/rel=["'][^"']*noopener/i.test(attributes)) {
            report(errors, file, "opens a new tab without rel=\"noopener\".");
        }
    }
}

if (warnings.length) {
    console.warn(`\nSite warnings (${warnings.length})`);
    warnings.forEach((warning) => console.warn(`  - ${warning}`));
}

if (errors.length) {
    console.error(`\nSite checks failed (${errors.length})`);
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exitCode = 1;
} else {
    console.log(`Site checks passed for ${htmlFiles.length} HTML pages.`);
}
