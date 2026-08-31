import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "..");
for (const file of readdirSync(root).filter((path) => path.endsWith(".html"))) {
    const source = readFileSync(resolve(root, file), "utf8");
    const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((match) => match[1]).filter((script) => script.includes("registerPlugin(ScrollTrigger)"));
    if (!scripts.length) continue;
    test(`${file}: optional animation script failures do not abort page initialization`, () => {
        for (const state of ["no-gsap", "no-scrolltrigger", "ready"]) {
            let registrations = 0;
            const context = {
                document: { addEventListener: (_, callback) => callback(), querySelectorAll: () => [] },
                matchMedia: () => ({ matches: false }),
            };
            if (state !== "no-gsap") {
                context.gsap = { registerPlugin: () => registrations++, from() {}, utils: { toArray: () => [] } };
            }
            if (state === "ready") context.ScrollTrigger = {};
            context.window = context;
            for (const script of scripts) assert.doesNotThrow(() => runInNewContext(script, context), `${file}: ${state}`);
            assert.equal(registrations, state === "ready" ? scripts.length : 0, `${file}: ${state}`);
        }
    });
}
