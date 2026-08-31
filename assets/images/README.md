# Existing Verde photography

These WebP files are size-optimized derivatives of the same public image URLs already present in the Verde Market source. No new photography, cropping, compositing, or aesthetic changes were introduced during this delivery pass.

`manifest.json` maps each original URL to its local derivative, dimensions, original byte size, and compressed size. The original downloads are cached locally under the git-ignored `.cache/delivery/` directory. `npm run assets:sync` reproduces the derivatives using Sharp; standard builds only copy the checked-in files and do not contact the source host.

Original artwork ownership and usage rights remain with their respective creators. Preserve upstream attribution and verify rights before reusing these portfolio-concept images in a commercial service.
