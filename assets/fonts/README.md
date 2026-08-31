# Self-hosted typography

Fraunces and Manrope are unmodified Latin variable-font subsets supplied by the official Google Fonts CSS API. Both are distributed under the SIL Open Font License; the upstream license files are included here.

Material Symbols Outlined is the same variable icon family used in the original interface. It is reduced to the alphabetically sorted icon names used in HTML and JavaScript using Google's official `icon_names` API parameter. It retains the 100–700 weight and 0–1 fill ranges. The Apache 2.0 license is included.

`manifest.json` records source URLs, exact byte sizes, and the included icon names. Run `npm run assets:sync` after introducing a new symbol. This is an explicit maintenance task that downloads official assets; normal builds do not need network access to fonts or photography.

The sync command versions font URLs, preload URLs, and the font stylesheet link in source HTML using content digests. Production builds fingerprint font filenames first, then rewrite and fingerprint their stylesheet. Changing a glyph subset therefore cannot silently reuse an earlier browser-cached font, and font preloads match the final CSS URLs.

Documentation: https://developers.google.com/fonts/docs/material_symbols
