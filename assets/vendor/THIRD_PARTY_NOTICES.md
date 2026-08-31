# Third-party browser assets

These pinned browser files are checked into the portfolio demo so the interface does not depend on runtime CDN availability. The current production build loads only GSAP and ScrollTrigger where used; the older browser compiler and unused plugins below are retained with the source assets for provenance but excluded from build output.

- Tailwind CSS browser runtime — Tailwind Labs, MIT License: https://github.com/tailwindlabs/tailwindcss
- GSAP 3.12.5, ScrollTrigger, ScrollToPlugin, and CustomEase — GreenSock standard license: https://gsap.com/licensing/
- Lenis 1.0.42 — Studio Freight / darkroom.engineering, MIT License: https://github.com/darkroomengineering/lenis

Source filenames retain their upstream version numbers where available. Review the linked upstream licenses before redistributing this project outside a portfolio context.

Tailwind CSS 3.4.17 is now a pinned build-time dependency. Its generated static stylesheet is served without a compiler or runtime configuration script. Official build documentation: https://v3.tailwindcss.com/docs/installation

Self-hosted fonts and their full license texts are documented in `assets/fonts/README.md`.
