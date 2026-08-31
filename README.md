# Verde Market

A portfolio-grade, multi-page organic grocery storefront with a connected produce-box subscription journey. The experience pairs editorial storytelling with a functional browser-based commerce demo across 11 responsive pages.

**Live site:** https://verde-market.vercel.app/

## Experience highlights

- Seasonal shop with filters, product discovery, a cross-tab synchronized basket, and undoable basket clearing
- Choose-a-plan, customize-a-box, checkout, confirmation, and subscriber dashboard flow
- Story, sustainability, journal, and location experiences with useful search and filter states
- Accessible drawers, dialogs, form feedback, focus treatment, reduced-motion support, and mobile navigation
- Local browser storage for the basket, box selections, newsletter signup, and simulated order details
- Separate subscription preferences and new-order drafts; direct plan/box editing preserves order history and delivery schedules
- Build-time Tailwind CSS, self-hosted GSAP/ScrollTrigger, and content-hashed production CSS/JavaScript
- Self-hosted, subset typography and responsive WebP photographs using the original imagery
- Page-specific SEO metadata, social preview, manifest, and generated Verde brand artwork

## Portfolio note

This is a frontend concept—not a live grocery or payment service. Checkout is intentionally simulated, no payment is processed, and demo data remains in the current browser. Visual directions used during the renovation are preserved in `design-references/`.

## Stack

HTML · Tailwind CSS · Vanilla JavaScript · GSAP · ScrollTrigger

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by the local server. The command builds and serves only the generated `dist/` folder at `127.0.0.1:4174`, keeping repository configuration and local environment files out of the preview. Clean-URL redirects preserve checkout mode and search parameters. Run `npm run build` again after source edits, then refresh the browser.

For the production preview, stop the development server, then run:

```bash
npm run build
npm run preview
```

The build writes `dist/` and fingerprints CSS/JavaScript so new releases cannot reuse an outdated cached interface. Vercel publishes this directory. Normal builds use checked-in local assets and do not fetch font or image services.

## Quality checks

```bash
npm run check
```

The check builds production output, validates HTML, and checks metadata, links, assets, image alternatives, font-symbol coverage, responsive image delivery, and cache configuration. Automated commerce and DOM regression tests cover subscription editing, checkout totals, immutable order snapshots, storage failures, multi-tab changes, browser-history restoration, keyboard focus, empty states, newsletter feedback, and URL-backed searches. HTTP tests exercise every page route, query-preserving redirects, asset responses, and private-file boundaries; animation dependency checks exercise failed-script fallbacks. These tests complement, rather than replace, rendered desktop/mobile browser testing.

`npm run assets:sync` is an explicit maintenance command for refreshing local font subsets and compressing source photographs. It requires network access; it is not part of a normal build. Source URLs are recorded in `assets/images/manifest.json` and `assets/fonts/manifest.json`.

## Page map

- `index.html` — homepage and brand introduction
- `verde-market-shop-page.html` — seasonal shop
- `build-my-box-select-plan.html` — subscription plan selection
- `build-my-box-customize-contents.html` — produce-box builder
- `build-my-box-checkout-finalize.html` — simulated checkout
- `verde-market-order-confirmation.html` — order success state
- `verde-market-subscriber-dashboard.html` — subscriber overview
- `verde-market-our-story.html` — founder and grower story
- `verde-market-sustainability.html` — impact and practices
- `verde-market-blog-journal.html` — editorial journal
- `verde-market-locations.html` — market finder
