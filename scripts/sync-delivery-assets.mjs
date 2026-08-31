import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const assetRoot = join(root, "assets");
const cache = join(root, ".cache", "delivery");
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const pages = readdirSync(root).filter((file) => file.endsWith(".html"));
const sourceFiles = [...pages, ...readdirSync(join(assetRoot, "js")).filter((file) => file.endsWith(".js")).map((file) => `assets/js/${file}`)];
const sources = sourceFiles.map((file) => readFileSync(join(root, file), "utf8"));

for (const directory of [cache, join(assetRoot, "images"), join(assetRoot, "fonts"), join(assetRoot, "icons")]) mkdirSync(directory, { recursive: true });

async function download(url) {
    const hash = createHash("sha256").update(url).digest("hex");
    const cached = join(cache, hash);
    if (existsSync(cached)) return readFileSync(cached);
    const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${response.status} downloading ${new URL(url).hostname}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(cached, bytes);
    return bytes;
}

async function syncFonts() {
    const bodyUrl = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..900&family=Manrope:wght@400..800&display=swap";
    const css = (await download(bodyUrl)).toString("utf8");
    const blocks = Array.from(css.matchAll(/\/\* latin \*\/\s*(@font-face\s*\{[\s\S]*?\})/g), (match) => match[1]);
    if (blocks.length !== 2) throw new Error("Unexpected Google Fonts Latin response; review before updating fonts.");
    const manifest = { bodyCssSource: bodyUrl, fonts: [], symbols: [] };
    const localCss = ["/* Self-hosted, unmodified Google Fonts Latin subsets. See assets/fonts/README.md. */"];
    for (const block of blocks) {
        const family = block.match(/font-family:\s*'([^']+)'/)[1];
        const source = block.match(/url\((https:[^)]+)\)/)[1];
        const filename = `${family.toLowerCase()}-latin.woff2`;
        const bytes = await download(source);
        if (bytes.subarray(0, 4).toString() !== "wOF2") throw new Error(`${family}: expected a WOFF2 font`);
        const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
        writeFileSync(join(assetRoot, "fonts", filename), bytes);
        localCss.push(block.replace(source, `../fonts/${filename}?v=${hash}`));
        manifest.fonts.push({ family, source, filename, bytes: bytes.length, hash });
    }
    const codepointsUrl = "https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL,GRAD,opsz,wght%5D.codepoints";
    const codepoints = (await download(codepointsUrl)).toString("utf8");
    const knownIcons = new Set(codepoints.split("\n").map((line) => line.trim().split(/\s+/)[0]));
    const icons = new Set();
    for (const source of sources) {
        for (const match of source.matchAll(/class=["'][^"']*material-symbols-outlined[^"']*["'][^>]*>\s*([a-z][a-z0-9_]+)\s*</g)) {
            if (knownIcons.has(match[1])) icons.add(match[1]);
        }
        for (const match of source.matchAll(/["'`]([a-z][a-z0-9_]+)["'`]/g)) {
            if (knownIcons.has(match[1])) icons.add(match[1]);
        }
    }
    // Used by generated shared navigation and feedback, even before an optional module loads.
    for (const icon of ["add", "arrow_forward", "check_circle", "close", "delete", "error", "info", "menu", "north_east", "remove", "shopping_bag", "shopping_basket", "warning"]) icons.add(icon);
    manifest.symbols = Array.from(icons).sort();
    const symbolCssUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&icon_names=${manifest.symbols.join(",")}&display=block`;
    const symbolCss = (await download(symbolCssUrl)).toString("utf8");
    const symbolSource = symbolCss.match(/url\((https:[^)]+)\)/)?.[1];
    if (!symbolSource) throw new Error("Unexpected Material Symbols response.");
    const symbolBytes = await download(symbolSource);
    if (symbolBytes.subarray(0, 4).toString() !== "wOF2") throw new Error("Expected a WOFF2 Material Symbols subset");
    const symbolHash = createHash("sha256").update(symbolBytes).digest("hex").slice(0, 12);
    writeFileSync(join(assetRoot, "fonts", "material-symbols-subset.woff2"), symbolBytes);
    localCss.push(symbolCss.replaceAll(symbolSource, `../fonts/material-symbols-subset.woff2?v=${symbolHash}`));
    manifest.fonts.push({ family: "Material Symbols Outlined", source: symbolSource, cssSource: symbolCssUrl, filename: "material-symbols-subset.woff2", bytes: symbolBytes.length, hash: symbolHash });
    const generatedCss = `${localCss.join("\n\n")}\n`;
    writeFileSync(join(assetRoot, "css", "verde-fonts.css"), generatedCss);
    const cssHash = createHash("sha256").update(generatedCss).digest("hex").slice(0, 12);
    // Keep source previews cache-safe too. Production emits hashed filenames.
    for (const page of pages) {
        const path = join(root, page);
        let html = readFileSync(path, "utf8");
        html = html.replace(/assets\/css\/verde-fonts\.css(?:\?v=[a-f\d]+)?(?=["'])/g, `assets/css/verde-fonts.css?v=${cssHash}`);
        for (const font of manifest.fonts) {
            const escaped = font.filename.replaceAll(".", "\\.");
            html = html.replace(new RegExp(`assets/fonts/${escaped}(?:\\?v=[a-f\\d]+)?(?=["'])`, "g"), `assets/fonts/${font.filename}?v=${font.hash}`);
        }
        writeFileSync(path, html);
    }
    writeFileSync(join(assetRoot, "fonts", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const [filename, url] of [
        ["Fraunces-OFL.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/OFL.txt"],
        ["Manrope-OFL.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt"],
        ["Material-Symbols-LICENSE.txt", "https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE"],
    ]) writeFileSync(join(assetRoot, "fonts", filename), await download(url));
    console.log(`Fonts: ${manifest.fonts.reduce((total, font) => total + font.bytes, 0).toLocaleString()} bytes total; ${manifest.symbols.length} icon names, ${symbolBytes.length.toLocaleString()}-byte symbol subset.`);
}

async function syncImages() {
    const manifestPath = join(assetRoot, "images", "manifest.json");
    const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
    const urls = new Set(previous.map((entry) => entry.source));
    for (const source of sources) {
        for (const match of source.matchAll(/https:\/\/lh3\.googleusercontent\.com\/[^\s"')]+/g)) urls.add(match[0]);
    }
    const manifest = [];
    const queue = Array.from(urls).sort();
    async function worker() {
        for (;;) {
            const source = queue.shift();
            if (!source) return;
            const original = await download(source);
            const metadata = await sharp(original).metadata();
            const identifier = createHash("sha256").update(source).digest("hex").slice(0, 12);
            const path = `assets/images/harvest-${identifier}.webp`;
            const webp = await sharp(original).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toBuffer();
            const webpMetadata = await sharp(webp).metadata();
            writeFileSync(join(root, path), webp);
            const entry = { source, path, originalBytes: original.length, bytes: webp.length, width: webpMetadata.width, height: webpMetadata.height };
            if (metadata.width > 640) {
                const smallPath = `assets/images/harvest-${identifier}-640.webp`;
                const small = await sharp(original).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toBuffer();
                writeFileSync(join(root, smallPath), small);
                entry.small = { path: smallPath, width: 640, bytes: small.length };
            }
            manifest.push(entry);
        }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    manifest.sort((first, second) => first.source.localeCompare(second.source));
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const originalBytes = manifest.reduce((total, entry) => total + entry.originalBytes, 0);
    const bytes = manifest.reduce((total, entry) => total + entry.bytes, 0);
    console.log(`Photos: ${manifest.length}, ${originalBytes.toLocaleString()} original bytes → ${bytes.toLocaleString()} WebP bytes (${Math.round((1 - bytes / originalBytes) * 100)}% smaller).`);
}

async function syncBrand() {
    const mark = join(assetRoot, "verde-mark.png");
    for (const size of [32, 180, 192, 512]) {
        await sharp(mark).resize(size, size, { fit: "inside" }).png({ compressionLevel: 9, palette: true }).toFile(join(assetRoot, "icons", `verde-${size}.png`));
    }
    await sharp(join(assetRoot, "verde-market-social-preview.png"))
        .resize({ width: 1200, height: 630, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 86, mozjpeg: true })
        .toFile(join(assetRoot, "verde-market-social-preview.jpg"));
    console.log("Generated practical favicon/app sizes and a compressed social preview without cropping.");
}

await Promise.all([syncFonts(), syncImages(), syncBrand()]);
