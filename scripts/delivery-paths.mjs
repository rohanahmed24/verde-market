import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, posix, relative, resolve } from "node:path";

export function resolveLocalFile(siteRoot, reference, baseDirectory = siteRoot) {
    let path;
    try { path = decodeURIComponent(reference.split(/[?#]/)[0]); } catch { return null; }
    const destination = path.startsWith("/") ? resolve(siteRoot, path.slice(1)) : resolve(baseDirectory, path);
    const localPath = relative(siteRoot, destination);
    if (isAbsolute(localPath) || localPath === ".." || localPath.startsWith("../") || localPath.startsWith("..\\")) return null;
    if (existsSync(destination) && statSync(destination).isFile()) return destination;
    const html = !extname(destination) && `${destination}.html`;
    if (html && existsSync(html) && statSync(html).isFile()) return html;
    const index = join(destination, "index.html");
    return existsSync(index) && statSync(index).isFile() ? index : null;
}

export const excludedAssets = new Set([
    "assets/verde-mark.png",
    "assets/verde-market-social-preview.png",
    "assets/vendor/tailwindcss-browser.js",
    "assets/vendor/lenis-1.0.42.min.js",
    "assets/vendor/ScrollToPlugin-3.12.5.min.js",
    "assets/vendor/CustomEase-3.12.5.min.js",
]);

function unversionedSuffix(suffix) {
    const hashIndex = suffix.indexOf("#");
    const query = hashIndex === -1 ? suffix : suffix.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : suffix.slice(hashIndex);
    if (!query.startsWith("?")) return suffix;
    const separator = query.includes("&amp;") ? "&amp;" : "&";
    const parameters = query.slice(1).split(/&(?:amp;)?/).filter((value) => !/^v=[a-f\d]+$/i.test(value));
    return `${parameters.length ? `?${parameters.join(separator)}` : ""}${hash}`;
}

export function rewriteCssAssets(css, sourcePath, manifest) {
    return css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/g, (full, quote, rawUrl) => {
        rawUrl = rawUrl.trim();
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(rawUrl)) return full;
        const clean = rawUrl.split(/[?#]/)[0];
        const resolved = clean.startsWith("/") ? posix.normalize(clean.slice(1)) : posix.normalize(posix.join(posix.dirname(sourcePath), clean));
        if (!manifest[resolved]) return full;
        const target = clean.startsWith("/") ? `/${manifest[resolved]}` : posix.relative(posix.dirname(sourcePath), manifest[resolved]);
        return `url(${quote}${target}${unversionedSuffix(rawUrl.slice(clean.length))}${quote})`;
    });
}

export function rewriteHtmlAssets(html, manifest) {
    let output = html;
    for (const [original, hashed] of Object.entries(manifest)) {
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Match complete local URLs, not another host's path or a similarly
        // named file such as verde.js.map. Keep non-cache query state intact.
        const pattern = new RegExp(`(^|[\\s"'(=])((?:\\./|/)?)${escaped}(?=[?#\\s"'()<>]|$)([?#][^\\s"'()<>]*)?`, "g");
        output = output.replace(pattern, (_, boundary, prefix, suffix = "") => `${boundary}${prefix}${hashed}${unversionedSuffix(suffix)}`);
    }
    return output;
}
