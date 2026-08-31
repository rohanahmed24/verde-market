(() => {
    "use strict";

    const STORAGE = {
        cart: "verde-market-cart-v1",
        newsletter: "verde-market-newsletter-v1",
        plan: "verde-market-plan-v1",
        box: "verde-market-box-v1",
        order: "verde-market-order-v1",
    };

    const $ = (selector, scope = document) => scope.querySelector(selector);
    const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
    const pathSegment = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    const currentFile = pathSegment.includes(".") ? pathSegment : `${pathSegment || "index"}.html`;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const defaultNavigation = [
        ["Shop", "verde-market-shop-page.html"],
        ["Build a Box", "build-my-box-select-plan.html"],
        ["Our Story", "verde-market-our-story.html"],
        ["Sustainability", "verde-market-sustainability.html"],
        ["Journal", "verde-market-blog-journal.html"],
        ["Locations", "verde-market-locations.html"],
    ];

    function readStorage(key, fallback) {
        try {
            const value = window.localStorage.getItem(key);
            return value ? JSON.parse(value) : fallback;
        } catch {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    }

    function escapeHtml(value = "") {
        return String(value).replace(/[&<>'"]/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#39;",
            '"': "&quot;",
        })[character]);
    }

    function slugify(value = "item") {
        return value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "") || "item";
    }

    function materialIcon(name, extraClass = "") {
        return `<span class="material-symbols-outlined ${extraClass}" aria-hidden="true">${name}</span>`;
    }

    function getFocusable(container) {
        return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
            .filter((element) => !element.hidden && element.getClientRects().length);
    }

    function trapFocus(event, container) {
        if (event.key !== "Tab") return;
        const focusable = getFocusable(container);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function ensureMainLandmark() {
        const main = $("main") || $("section");
        if (main && !main.id) main.id = "main-content";
        if (main && !$(".verde-skip-link")) {
            document.body.insertAdjacentHTML(
                "afterbegin",
                '<a class="verde-skip-link" href="#main-content">Skip to main content</a>',
            );
        }
    }

    function updateCopyrightYears() {
        const year = new Date().getFullYear();
        $$('footer p, [data-copyright]').forEach((element) => {
            element.childNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE && /©\s*20\d{2}/.test(node.textContent)) {
                    node.textContent = node.textContent.replace(/©\s*20\d{2}/, `© ${year}`);
                }
            });
        });
    }

    function markCurrentNavigation() {
        $$('header a[href], .verde-menu-list a[href]').forEach((link) => {
            const href = (link.getAttribute("href") || "").split(/[?#]/)[0].toLowerCase();
            const isHome = currentFile === "index.html" && href === "index.html";
            if (href && (href === currentFile || isHome)) link.setAttribute("aria-current", "page");
        });
    }

    let toastRegion;
    function showToast(title, message, icon = "check_circle") {
        if (!toastRegion) {
            toastRegion = document.createElement("div");
            toastRegion.className = "verde-toast-region";
            toastRegion.setAttribute("aria-live", "polite");
            toastRegion.setAttribute("aria-atomic", "true");
            document.body.append(toastRegion);
        }
        const toast = document.createElement("div");
        toast.className = "verde-toast";
        toast.innerHTML = `${materialIcon(icon)}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
        toastRegion.append(toast);
        window.setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(0.75rem)";
            window.setTimeout(() => toast.remove(), 220);
        }, 3600);
    }

    function findHeaderActions(header) {
        const candidates = $$('header nav, header [class*="items-center"], header > div', header);
        return candidates.reverse().find((element) => $("button, a", element)) || header;
    }

    function createOverlay(type, title, bodyHtml, footerHtml = "") {
        const overlay = document.createElement("div");
        overlay.className = "verde-overlay";
        overlay.id = `verde-${type}-overlay`;
        overlay.dataset.overlay = type;
        overlay.dataset.open = "false";
        overlay.inert = true;
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = `
            <section class="verde-drawer" role="dialog" aria-modal="true" aria-labelledby="verde-${type}-title">
                <div class="verde-drawer__header">
                    <h2 id="verde-${type}-title">${escapeHtml(title)}</h2>
                    <button class="verde-icon-button" type="button" data-close-overlay aria-label="Close ${escapeHtml(title)}">
                        ${materialIcon("close")}
                    </button>
                </div>
                <div class="verde-drawer__body">${bodyHtml}</div>
                ${footerHtml ? `<div class="verde-drawer__footer">${footerHtml}</div>` : ""}
                ${type === "cart" ? '<p class="sr-only" data-cart-announcement role="status" aria-live="polite" aria-atomic="true"></p>' : ""}
            </section>`;
        document.body.append(overlay);
        return overlay;
    }

    let closeActiveOverlay = null;

    function bindOverlay(overlay, trigger, onBeforeOpen) {
        let previousFocus = null;
        let previousOverflow = "";
        let backgroundState = [];
        const drawer = $(".verde-drawer", overlay);
        const setExpanded = (expanded) => {
            $$(`[aria-controls="${overlay.id}"]`).forEach((control) => control.setAttribute("aria-expanded", String(expanded)));
        };
        const close = () => {
            if (overlay.dataset.open !== "true") return;
            overlay.dataset.open = "false";
            backgroundState.forEach(([element, wasInert]) => { element.inert = wasInert; });
            backgroundState = [];
            document.body.style.overflow = previousOverflow;
            setExpanded(false);
            if (closeActiveOverlay === close) closeActiveOverlay = null;
            previousFocus?.focus({ preventScroll: true });
            overlay.inert = true;
            overlay.setAttribute("aria-hidden", "true");
        };
        const open = (event) => {
            event?.preventDefault?.();
            closeActiveOverlay?.();
            onBeforeOpen?.();
            previousFocus = document.activeElement;
            previousOverflow = document.body.style.overflow;
            backgroundState = Array.from(document.body.children)
                .filter((element) => element !== overlay && !element.classList.contains("verde-toast-region"))
                .map((element) => [element, element.inert]);
            backgroundState.forEach(([element]) => { element.inert = true; });
            overlay.inert = false;
            overlay.removeAttribute("aria-hidden");
            overlay.dataset.open = "true";
            document.body.style.overflow = "hidden";
            setExpanded(true);
            closeActiveOverlay = close;
            $("[data-close-overlay]", overlay)?.focus({ preventScroll: true });
        };
        trigger?.setAttribute("aria-controls", overlay.id);
        trigger?.addEventListener("click", open);
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay || event.target.closest("[data-close-overlay]")) close();
        });
        overlay.addEventListener("keydown", (event) => {
            if (event.key === "Escape") close();
            trapFocus(event, drawer);
        });
        return { open, close };
    }

    function setupMobileNavigation() {
        const header = $("header");
        if (!header) return;

        const headerLinks = $$('nav a[href]', header)
            .map((link) => [link.textContent.trim(), link.getAttribute("href")])
            .filter(([label, href]) => label && href && !href.startsWith("#"));
        const unique = new Map(defaultNavigation.map(([label, href]) => [href, label]));
        headerLinks.forEach(([label, href]) => {
            const canonicalHref = href.split(/[?#]/)[0].replace(/^\.\//, "").replace(/\.html$/, "");
            const existing = Array.from(unique.keys()).find((key) => key.replace(/\.html$/, "") === canonicalHref);
            if (!existing) unique.set(href, label);
        });

        let trigger = $('[aria-label*="menu" i]', header);
        if (!trigger) {
            trigger = document.createElement("button");
            trigger.type = "button";
            trigger.innerHTML = materialIcon("menu");
            findHeaderActions(header).append(trigger);
        }
        trigger.classList.add("verde-menu-trigger");
        trigger.setAttribute("aria-label", "Open navigation");
        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", "false");

        const items = Array.from(unique, ([href, label]) => `<li><a href="${escapeHtml(href)}"><span>${escapeHtml(label)}</span>${materialIcon("north_east")}</a></li>`).join("");
        const overlay = createOverlay(
            "menu",
            "Explore Verde",
            `<nav aria-label="Mobile navigation"><ul class="verde-menu-list">${items}</ul></nav>
             <div class="verde-menu-note"><strong>Fresh this week</strong><span>Local produce boxes, packed with the best of the season.</span></div>`,
        );
        bindOverlay(overlay, trigger);
        markCurrentNavigation();
    }

    let cart = window.VerdeCommerce?.normalizeCart(readStorage(STORAGE.cart, [])) || [];
    let savedCart = cart.map((item) => ({ ...item }));
    let cartBeforeClear = null;
    let cartOverlay;
    let cartApi;
    let cartTriggers = [];

    function cartCount() {
        return cart.reduce((total, item) => total + item.quantity, 0);
    }

    function cartTotal() {
        return cart.reduce((total, item) => total + item.price * item.quantity, 0);
    }

    function persistCart() {
        const saved = writeStorage(STORAGE.cart, cart);
        if (saved) savedCart = cart.map((item) => ({ ...item }));
        else {
            cart = savedCart.map((item) => ({ ...item }));
            cartBeforeClear = null;
            showToast("Could not save your basket", "Your previous basket is unchanged. Allow browser storage and try again.", "info");
        }
        updateCartTriggers();
        renderCart();
        document.dispatchEvent(new CustomEvent("verde:cartchange"));
        return saved;
    }

    function syncCartFromStorage() {
        let raw;
        try {
            raw = window.localStorage.getItem(STORAGE.cart);
        } catch {
            return;
        }
        let value;
        try { value = raw ? JSON.parse(raw) : []; }
        catch { value = []; }
        const fresh = window.VerdeCommerce.normalizeCart(value);
        savedCart = fresh.map((item) => ({ ...item }));
        if (JSON.stringify(fresh) === JSON.stringify(cart)) return;
        cart = fresh;
        cartBeforeClear = null;
        updateCartTriggers();
        renderCart();
        document.dispatchEvent(new CustomEvent("verde:cartchange"));
    }

    function updateCartTriggers() {
        const count = cartCount();
        cartTriggers.forEach((trigger) => {
            const badge = $(".verde-cart-count", trigger);
            if (badge) {
                badge.textContent = count > 99 ? "99+" : String(count);
                badge.hidden = count === 0;
            }
            trigger.setAttribute("aria-label", `Shopping cart, ${count} ${count === 1 ? "item" : "items"}`);
        });
    }

    function renderCart() {
        if (!cartOverlay) return;
        const body = $(".verde-drawer__body", cartOverlay);
        const total = $("[data-cart-total]", cartOverlay);
        const clear = $("[data-cart-clear]", cartOverlay);
        const footer = $(".verde-drawer__footer", cartOverlay);
        const announcement = $("[data-cart-announcement]", cartOverlay);
        const active = document.activeElement;
        const focusAction = active?.hasAttribute("data-cart-increase") ? "data-cart-increase" : "data-cart-decrease";
        const focusId = active?.getAttribute(focusAction);
        const hadQuantityFocus = Boolean(focusId && body.contains(active));
        const hadBodyFocus = body.contains(active);
        const hadFooterFocus = footer?.contains(active);
        const focusedIndex = hadQuantityFocus ? $$(".verde-cart-item", body).indexOf(active.closest(".verde-cart-item")) : -1;
        if (total) total.textContent = `$${cartTotal().toFixed(2)}`;
        if (clear) clear.hidden = cart.length === 0;
        if (footer) footer.hidden = cart.length === 0;
        if (announcement && cartOverlay.dataset.open === "true") {
            announcement.textContent = `${cartCount()} ${cartCount() === 1 ? "item" : "items"} in your basket. Subtotal $${cartTotal().toFixed(2)}.`;
        }
        if (!cart.length) {
            body.innerHTML = `<div class="verde-cart-empty">${materialIcon("shopping_basket")}<strong>Your basket is ready for something fresh.</strong><p>Add produce from the shop to see it here.</p><a class="verde-primary-action" href="verde-market-shop-page.html">Browse the harvest</a>${cartBeforeClear ? '<button class="verde-secondary-action" type="button" data-cart-undo>Undo clear</button>' : ""}</div>`;
            if (hadBodyFocus || hadFooterFocus) $("a", body)?.focus({ preventScroll: true });
            return;
        }
        body.innerHTML = `<div class="verde-cart-items">${cart.map((item) => `
            <article class="verde-cart-item">
                ${item.image ? `<img class="verde-cart-item__image" src="${escapeHtml(item.image)}" alt="">` : `<div class="verde-cart-item__image"></div>`}
                <div><p class="verde-cart-item__name">${escapeHtml(item.name)}</p><p class="verde-cart-item__price">$${item.price.toFixed(2)} ${item.unit ? `/ ${escapeHtml(item.unit)}` : "each"}</p></div>
                <div class="verde-quantity" aria-label="Quantity for ${escapeHtml(item.name)}">
                    <button type="button" data-cart-decrease="${escapeHtml(item.id)}" aria-label="Remove one ${escapeHtml(item.name)}">${materialIcon("remove")}</button>
                    <strong aria-label="${item.quantity} selected">${item.quantity}</strong>
                    <button type="button" data-cart-increase="${escapeHtml(item.id)}" aria-label="Add one ${escapeHtml(item.name)}" ${item.quantity >= window.VerdeCommerce.MAX_QUANTITY ? "disabled" : ""}>${materialIcon("add")}</button>
                </div>
            </article>`).join("")}</div>`;
        if (hadQuantityFocus) {
            const matching = $$(`[${focusAction}]`, body).find((button) => !button.disabled && button.getAttribute(focusAction) === focusId);
            const fallback = $$(".verde-cart-item", body)[Math.min(focusedIndex, cart.length - 1)];
            (matching || $("button:not([disabled])", fallback || body))?.focus({ preventScroll: true });
        } else if (hadBodyFocus) {
            $("button:not([disabled])", body)?.focus({ preventScroll: true });
        }
    }

    function extractProduct(button) {
        let card = button.closest(".product-card, [data-product]");
        let cursor = button.parentElement;
        while (!card && cursor && cursor !== document.body) {
            if ($("h2, h3, h4", cursor) && /\$\s*\d/.test(cursor.textContent)) card = cursor;
            cursor = cursor.parentElement;
        }
        if (!card) return null;
        const name = $("h2, h3, h4", card)?.textContent.trim() || "Seasonal produce";
        const priceText = card.dataset.price || card.textContent.match(/\$\s*(\d+(?:\.\d{1,2})?)/)?.[1];
        const price = Number.parseFloat(String(priceText).replace(/[^\d.]/g, "")) || 0;
        if (!Number.isFinite(price) || price <= 0) return null;
        const imageElement = $("img", card);
        const backgroundElement = $$('[style*="background-image"]', card)[0];
        const background = backgroundElement?.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] || "";
        const id = card.dataset.product || slugify(name);
        const priceLabel = $(".shop-product__price, .home-product__price", card)?.textContent || "";
        const sourceUnit = card.dataset.unit || priceLabel.match(/\/\s*(.+)$/)?.[1];
        const unit = window.VerdeCommerce.normalizeSaleUnit({ id, name, unit: sourceUnit });
        return {
            id,
            name,
            price,
            image: imageElement?.currentSrc || imageElement?.src || background,
            ...(unit === "each" && !sourceUnit ? {} : { unit }),
        };
    }

    function showCommerceUnavailable() {
        if ($("[data-commerce-unavailable]")) return;
        const notice = document.createElement("p");
        notice.className = "verde-commerce-notice";
        notice.setAttribute("data-commerce-unavailable", "");
        notice.setAttribute("role", "status");
        notice.textContent = "Shopping tools could not load. Reload this page to try again. No changes have been saved.";
        ($("main") || document.body).prepend(notice);
    }

    function setupCart() {
        const header = $("header");
        if (!header) return;
        if (!window.VerdeCommerce) {
            $$('[aria-label^="Cart" i], [aria-label*="shopping cart" i], [aria-label*="add to cart" i]').forEach((control) => {
                control.disabled = true;
                control.setAttribute("aria-disabled", "true");
                control.title = "Shopping tools could not load. Reload to try again.";
            });
            showCommerceUnavailable();
            return;
        }
        cart = window.VerdeCommerce.normalizeCart(cart);
        cartTriggers = $$('[aria-label^="Cart" i], [aria-label*="shopping cart" i]', header);
        if (!cartTriggers.length) {
            const textButton = $$('button', header).find((button) => /^cart\b/i.test(button.textContent.trim()));
            if (textButton) cartTriggers = [textButton];
        }
        if (!cartTriggers.length) {
            const trigger = document.createElement("button");
            trigger.type = "button";
            findHeaderActions(header).prepend(trigger);
            cartTriggers = [trigger];
        }
        cartTriggers.forEach((trigger) => {
            trigger.classList.add("verde-cart-trigger");
            trigger.innerHTML = `${materialIcon("shopping_bag")}<span class="verde-cart-count" hidden>0</span>`;
            trigger.type = "button";
            trigger.setAttribute("aria-haspopup", "dialog");
            trigger.setAttribute("aria-expanded", "false");
        });

        cartOverlay = createOverlay(
            "cart",
            "Your harvest",
            "",
            `<div class="verde-total-row"><span>Estimated total</span><strong data-cart-total>$0.00</strong></div>
             <a class="verde-primary-action" href="build-my-box-checkout-finalize?checkout=basket" data-cart-checkout>Review checkout</a>
             <button class="verde-secondary-action" type="button" data-cart-clear>Clear basket</button>`,
        );
        cartApi = bindOverlay(cartOverlay, cartTriggers[0], () => {
            syncCartFromStorage();
            renderCart();
        });
        cartTriggers.slice(1).forEach((trigger) => {
            trigger.setAttribute("aria-controls", cartOverlay.id);
            trigger.addEventListener("click", cartApi.open);
        });
        cartOverlay.addEventListener("click", (event) => {
            const increase = event.target.closest("[data-cart-increase]");
            const decrease = event.target.closest("[data-cart-decrease]");
            const clear = event.target.closest("[data-cart-clear]");
            const undo = event.target.closest("[data-cart-undo]");
            if (!increase && !decrease && !clear && !undo) return;
            syncCartFromStorage();
            if (increase) {
                const item = cart.find((entry) => entry.id === increase.dataset.cartIncrease);
                if (!item || item.quantity >= window.VerdeCommerce.MAX_QUANTITY) return;
                cartBeforeClear = null;
                item.quantity += 1;
                persistCart();
            }
            if (decrease) {
                const item = cart.find((entry) => entry.id === decrease.dataset.cartDecrease);
                if (!item) return;
                cartBeforeClear = null;
                item.quantity -= 1;
                cart = cart.filter((entry) => entry.quantity > 0);
                persistCart();
            }
            if (clear) {
                if (!cart.length) return;
                cartBeforeClear = cart.map((item) => ({ ...item }));
                cart = [];
                if (persistCart()) showToast("Basket cleared", "You can undo this while the basket is empty.", "delete_sweep");
            }
            if (undo && cartBeforeClear && !cart.length) {
                cart = cartBeforeClear.map((item) => ({ ...item }));
                cartBeforeClear = null;
                if (persistCart()) showToast("Basket restored", "Your items and quantities are back in your basket.", "shopping_bag");
            }
        });

        $$('[aria-label*="add to cart" i]').forEach((button) => {
            button.addEventListener("click", () => {
                const product = extractProduct(button);
                if (!product) return;
                syncCartFromStorage();
                const existing = cart.find((entry) => entry.id === product.id);
                if (existing) {
                    if (existing.quantity >= window.VerdeCommerce.MAX_QUANTITY) {
                        showToast("Basket limit reached", "You can add up to 99 of each item in this demo.", "info");
                        return;
                    }
                    Object.assign(existing, product, { quantity: existing.quantity + 1 });
                }
                else cart.push({ ...product, quantity: 1 });
                cartBeforeClear = null;
                if (!persistCart()) return;
                if (!prefersReducedMotion) button.animate?.(
                    [{ transform: "scale(1)" }, { transform: "scale(0.86)" }, { transform: "scale(1)" }],
                    { duration: 260, easing: "ease-out" },
                );
                showToast("Added to your basket", `${product.name} is saved for checkout.`, "shopping_bag");
            });
        });
        updateCartTriggers();
        renderCart();
        window.addEventListener("storage", (event) => {
            if (event.key === null || event.key === STORAGE.cart) syncCartFromStorage();
        });
        window.addEventListener("pagehide", () => { closeActiveOverlay?.(); });
        window.addEventListener("pageshow", (event) => {
            if (!event.persisted) return;
            closeActiveOverlay?.();
            syncCartFromStorage();
        });
    }

    function setupNewsletters() {
        $$('form').filter((form) => $('input[type="email"]', form)).forEach((form) => {
            const input = $('input[type="email"]', form);
            const button = $('button[type="submit"], button:not([type])', form);
            if (!input || !button) return;
            input.name ||= "email";
            input.autocomplete = "email";
            input.setAttribute("aria-label", input.getAttribute("aria-label") || "Email address");
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                if (!form.reportValidity()) return;
                if (!writeStorage(STORAGE.newsletter, { email: input.value.trim(), joinedAt: new Date().toISOString() })) {
                    showToast("Could not save signup", "Allow browser storage and try again. Your email has not been saved.", "info");
                    input.focus();
                    return;
                }
                const original = button.innerHTML;
                const originalLabel = button.getAttribute("aria-label");
                const icon = $(".material-symbols-outlined", button);
                if (icon && button.textContent.trim() === icon.textContent.trim()) button.innerHTML = materialIcon("check");
                else button.textContent = "You're on the list";
                button.setAttribute("aria-label", "Demo subscription saved");
                button.disabled = true;
                showToast("Welcome to Verde Weekly", "A demo subscription has been saved in this browser.", "mark_email_read");
                form.reset();
                window.setTimeout(() => {
                    button.innerHTML = original;
                    if (originalLabel) button.setAttribute("aria-label", originalLabel);
                    else button.removeAttribute("aria-label");
                    button.disabled = false;
                }, 3000);
            });
        });
    }

    function ensureDialog(id, content) {
        let dialog = $(`#${id}`);
        if (dialog) return dialog;
        dialog = document.createElement("dialog");
        dialog.className = "verde-dialog";
        dialog.id = id;
        dialog.innerHTML = `<div class="verde-dialog__surface"><button class="verde-icon-button verde-dialog__close" type="button" aria-label="Close dialog">${materialIcon("close")}</button>${content}</div>`;
        const heading = $("h2", dialog);
        if (heading) {
            heading.id = `${id}-title`;
            dialog.setAttribute("aria-labelledby", heading.id);
        }
        document.body.append(dialog);
        dialog.addEventListener("click", (event) => {
            if (event.target === dialog || event.target.closest(".verde-dialog__close")) dialog.close();
        });
        dialog.addEventListener("keydown", (event) => {
            if (event.key === "Escape") dialog.close();
            trapFocus(event, dialog);
        });
        return dialog;
    }

    function setupStoryDialog() {
        const trigger = $('[data-story-dialog]') || $$('button, a').find((element) => /watch (our )?(story|video)/i.test(element.textContent));
        if (!trigger) return;
        const dialog = ensureDialog(
            "verde-story-dialog",
            `<span class="verde-dialog__eyebrow">The 24-hour harvest</span>
             <h2>Picked nearby. Packed gently. Delivered fresh.</h2>
             <p>Verde connects neighborhood growers with households who care where their food comes from. This interactive story is part of the portfolio demo—no stock promises, just a transparent look at the concept.</p>
             <div class="verde-story-grid">
                <div class="verde-story-step"><span>01</span><strong>Harvest</strong><p>Farmers pick produce at peak ripeness.</p></div>
                <div class="verde-story-step"><span>02</span><strong>Pack</strong><p>Orders are grouped in low-waste crates.</p></div>
                <div class="verde-story-step"><span>03</span><strong>Deliver</strong><p>Local routes bring the harvest home.</p></div>
             </div>`,
        );
        trigger.addEventListener("click", (event) => {
            event.preventDefault();
            dialog.showModal();
        });
    }

    function setupAccountButtons() {
        $$('[aria-label*="account" i], button').filter((button) => {
            const iconText = $(".material-symbols-outlined", button)?.textContent.trim();
            return /account/i.test(button.getAttribute("aria-label") || "") || iconText === "person";
        }).forEach((button) => {
            button.setAttribute("aria-label", "Open subscriber dashboard");
            button.addEventListener("click", () => {
                window.location.href = "verde-market-subscriber-dashboard.html";
            });
        });
    }

    function commerceControlsReady() {
        if (window.VerdeCommerce) return true;
        showCommerceUnavailable();
        $$('[data-plan-card] button, input[name="frequency"], [data-box-product] button, #demo-fill, #checkout-form button, #checkout-form fieldset, #pause-plan, #skip-delivery, [data-dashboard-tool], #dashboard-undo').forEach((control) => { control.disabled = true; });
        $$('#plan-continue, #box-review, [data-edit-plan], a[href*="edit=subscription"]').forEach((link) => {
            link.setAttribute("aria-disabled", "true");
            link.removeAttribute("href");
            link.addEventListener("click", (event) => event.preventDefault());
        });
        $("#checkout-form")?.addEventListener("submit", (event) => event.preventDefault());
        $$('#confirmation-content, #confirmation-progress, [data-subscription-panel], #dashboard-order-table').forEach((panel) => { panel.hidden = true; });
        return false;
    }

    // Treat a checkout as one logical update. A quota failure on a later key
    // must not leave a new order paired with an old basket or subscription.
    function commitCommerceStorage(changes) {
        const previous = new Map();
        const written = [];
        try {
            Object.keys(changes).forEach((key) => previous.set(key, window.localStorage.getItem(key)));
            for (const [key, value] of Object.entries(changes)) {
                const serialized = JSON.stringify(value);
                if (previous.get(key) === serialized) continue;
                window.localStorage.setItem(key, serialized);
                written.push(key);
                if (window.localStorage.getItem(key) !== serialized) throw new Error("Storage did not retain the update");
            }
            return true;
        } catch {
            written.reverse().forEach((key) => {
                try {
                    if (previous.get(key) === null) window.localStorage.removeItem(key);
                    else window.localStorage.setItem(key, previous.get(key));
                } catch { /* Storage can become unavailable during rollback too. */ }
            });
            return false;
        }
    }

    function activeSubscription() {
        const commerce = window.VerdeCommerce;
        const saved = commerce.normalizeOrder(readStorage("verde-market-subscription-v1", null));
        if (saved?.mode === "box") return saved;
        const order = commerce.normalizeOrder(readStorage(STORAGE.order, null));
        return order?.mode === "box" ? order : null;
    }

    function setupPlanSelector() {
        if (currentFile !== "build-my-box-select-plan.html") return;
        if (!commerceControlsReady()) return;
        const commerce = window.VerdeCommerce;
        const cards = $$('[data-plan-card]');
        let subscription = activeSubscription();
        const editingSubscription = new URLSearchParams(window.location.search).get("edit") === "subscription" && Boolean(subscription);
        const continueLink = $("#plan-continue");
        let saved = false;
        let selected = commerce.normalizePlan(editingSubscription ? subscription.plan : readStorage(STORAGE.plan, null));
        if (editingSubscription) {
            $('[aria-label="Subscription progress"]').hidden = true;
            $("h1").textContent = "A new rhythm for your next harvest.";
            $("#plan-next-heading").textContent = "Save your subscription changes.";
            $("#plan-next-copy").textContent = "Your next delivery date and paused status stay unchanged. The new price and cadence apply to upcoming boxes; past orders stay as placed.";
            continueLink.textContent = "Save plan changes";
            continueLink.href = "verde-market-subscriber-dashboard.html";
            continueLink.setAttribute("role", "button");
        }
        const render = (persist = false) => {
            cards.forEach((card) => {
                const active = card.dataset.planCard === selected.id;
                const button = $("button", card);
                const plan = commerce.PLANS.find((item) => item.id === card.dataset.planCard);
                card.classList.toggle("verde-selected-card", active);
                card.classList.toggle("border-primary", active);
                card.classList.toggle("border-2", active);
                card.classList.toggle("shadow-xl", active);
                button.classList.remove("bg-primary", "bg-white", "text-white", "text-primary", "hover:bg-forest", "hover:bg-mint");
                button.classList.add(...(active ? ["bg-primary", "text-white", "hover:bg-forest"] : ["border", "border-primary", "bg-white", "text-primary", "hover:bg-mint"]));
                button.setAttribute("aria-pressed", String(active));
                button.textContent = active ? "Selected" : `Select ${plan.name.replace(/^The\s+|\s+Box$|\s+Feast$/gi, "")}`;
            });
            $$('input[name="frequency"]').forEach((radio) => { radio.checked = radio.value === selected.frequency; });
            const summary = $("#selected-plan-summary");
            if (summary) summary.textContent = `${selected.name} · ${commerceMoney(selected.price)} per delivery · ${selected.frequency}`;
            if (persist && !editingSubscription) writeStorage(STORAGE.plan, selected);
        };
        cards.forEach((card) => {
            const select = () => {
                if (saved) return;
                selected = commerce.normalizePlan({ id: card.dataset.planCard, frequency: selected.frequency });
                render(true);
                showToast("Box selected", `${selected.name} is ${commerceMoney(selected.price)} per delivery.`, "inventory_2");
            };
            $("button", card).addEventListener("click", select);
            card.addEventListener("click", (event) => {
                if (!event.target.closest("button, a, input, label")) select();
            });
        });
        $$('input[name="frequency"]').forEach((radio) => {
            radio.addEventListener("change", () => {
                if (saved) return;
                selected = commerce.normalizePlan({ ...selected, frequency: radio.value });
                render(true);
            });
        });
        continueLink?.addEventListener("click", (event) => {
            if (saved) { event.preventDefault(); return; }
            if (!editingSubscription) {
                if (!commitCommerceStorage({ [STORAGE.plan]: selected })) {
                    event.preventDefault();
                    showToast("Plan could not be saved", "Allow site storage before continuing. Your selection is still here.", "info");
                }
                return;
            }
            event.preventDefault();
            const current = activeSubscription();
            if (!subscription || !current || current.number !== subscription.number || JSON.stringify(current.plan) !== JSON.stringify(subscription.plan)) {
                showToast("Subscription changed", "Reload this page to review the latest subscription before saving.", "info");
                return;
            }
            if (!commitCommerceStorage({ "verde-market-subscription-v1": commerce.normalizeOrder({ ...current, plan: selected }) })) {
                showToast("Plan could not be saved", "Allow site storage and try again. Your existing subscription is unchanged.", "info");
                return;
            }
            saved = true;
            continueLink.textContent = "Plan saved";
            continueLink.setAttribute("aria-disabled", "true");
            cards.forEach((card) => { $("button", card).disabled = true; });
            $$('input[name="frequency"]').forEach((radio) => { radio.disabled = true; });
            window.setTimeout(() => window.location.assign("verde-market-subscriber-dashboard.html"), 450);
        });
        continueLink?.addEventListener("keydown", (event) => {
            if (editingSubscription && event.key === " ") { event.preventDefault(); continueLink.click(); }
        });
        const refresh = () => {
            if (editingSubscription && !saved) return;
            subscription = activeSubscription();
            selected = commerce.normalizePlan(editingSubscription ? subscription?.plan : readStorage(STORAGE.plan, null));
            saved = false;
            cards.forEach((card) => { $("button", card).disabled = false; });
            $$('input[name="frequency"]').forEach((radio) => { radio.disabled = false; });
            continueLink.removeAttribute("aria-disabled");
            if (editingSubscription) continueLink.textContent = "Save plan changes";
            render();
        };
        window.addEventListener("pageshow", (event) => { if (event.persisted) refresh(); });
        window.addEventListener("storage", (event) => { if (!editingSubscription && (event.key === null || event.key === STORAGE.plan)) refresh(); });
        render();
    }

    function commerceMoney(value) {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
    }

    function commerceDate(value, options = {}) {
        return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", ...options }).format(new Date(value));
    }

    function renderCommerceItems(items) {
        return items.map((item) => `<li class="flex items-start justify-between gap-4 py-3">
            <span class="min-w-0"><strong class="block text-sm">${escapeHtml(item.name)}</strong><span class="text-xs text-[#607068]">${item.quantity} × ${commerceMoney(item.price)} / ${escapeHtml(item.unit || "each")}</span></span>
            <strong class="shrink-0 text-sm">${commerceMoney(item.price * item.quantity)}</strong>
        </li>`).join("");
    }

    function setupBoxBuilder() {
        if (currentFile !== "build-my-box-customize-contents.html") return;
        if (!commerceControlsReady()) return;
        const commerce = window.VerdeCommerce;
        const products = $$('[data-box-product]');
        const summary = $("#box-summary-items");
        const progress = $("#box-progress");
        const progressLabel = $("#box-progress-label");
        const progressHint = $("#box-progress-hint");
        const totalLabel = $("#box-total");
        const review = $("#box-review");
        let subscription = activeSubscription();
        const editingSubscription = new URLSearchParams(window.location.search).get("edit") === "subscription" && Boolean(subscription);
        const draft = commerce.normalizeBox(readStorage(STORAGE.box, {}));
        const stored = editingSubscription ? commerce.normalizeBox(subscription.box) : draft;
        let plan = commerce.normalizePlan(editingSubscription ? subscription.plan : readStorage(STORAGE.plan, null));
        const planSummary = $("#box-plan-summary");
        if (planSummary) planSummary.textContent = `${plan.name} · ${commerceMoney(plan.price)} · ${plan.frequency}`;
        const state = {};
        let saved = false;
        if (editingSubscription) {
            $('[aria-label="Subscription progress"]').hidden = true;
            $("h1").textContent = "Make your next harvest your own.";
            review.textContent = "Save next box";
            review.setAttribute("role", "button");
            $("#box-checkout-copy").textContent = "Save these preferences for your subscription. Your basket, plan, and delivery schedule will not change.";
        }

        products.forEach((product) => {
            const name = product.dataset.boxProduct;
            const price = Number.parseFloat(product.dataset.price || "0");
            const initial = stored[name] || 0;
            const background = $('[style*="background-image"]', product)?.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] || "";
            state[name] = { name, price, quantity: initial, image: background };

            product.addEventListener("click", (event) => {
                const button = event.target.closest("button");
                if (!button || button.disabled || saved) return;
                const action = button.dataset.quantityAction || $(".material-symbols-outlined", button)?.textContent.trim();
                const units = Object.values(state).reduce((sum, item) => sum + item.quantity, 0);
                if (action === "add" && units < commerce.CAPACITY) state[name].quantity += 1;
                if (action === "remove") state[name].quantity = Math.max(0, state[name].quantity - 1);
                render(true);
            });
        });

        const render = (persist = false) => {
            if (planSummary) planSummary.textContent = `${plan.name} · ${commerceMoney(plan.price)} · ${plan.frequency}`;
            const selected = Object.values(state).filter((item) => item.quantity > 0);
            const units = selected.reduce((sum, item) => sum + item.quantity, 0);
            const fullness = Math.min(100, Math.round((units / commerce.CAPACITY) * 100));
            const total = selected.reduce((sum, item) => sum + item.price * item.quantity, 0);
            products.forEach((product) => {
                const item = state[product.dataset.boxProduct];
                const quantity = $("[data-quantity]", product);
                const remove = $('button[data-quantity-action="remove"]', product);
                const add = $('button[data-quantity-action="add"]', product);
                if (quantity) {
                    quantity.textContent = String(item.quantity);
                    quantity.classList.toggle("text-slate-400", item.quantity === 0);
                }
                if (remove) remove.disabled = item.quantity === 0;
                if (add) add.disabled = units >= commerce.CAPACITY;
            });
            if (progress) progress.style.width = `${fullness}%`;
            if (progressLabel) progressLabel.textContent = `${units} / ${commerce.CAPACITY}`;
            if (progressHint) progressHint.textContent = units >= commerce.CAPACITY ? "All preference slots filled. Your harvest is ready." : units ? `${commerce.CAPACITY - units} open slots. Your grower will fill them with seasonal picks.` : "Add your first favorite to start your box.";
            if (totalLabel) totalLabel.textContent = commerceMoney(total);
            if (review) {
                review.setAttribute("aria-disabled", String(units === 0));
                review.setAttribute("href", editingSubscription ? "verde-market-subscriber-dashboard.html" : "build-my-box-checkout-finalize?checkout=box");
            }
            if (summary) {
                summary.innerHTML = selected.length ? selected.map((item) => `
                    <article class="verde-cart-item">
                        ${item.image ? `<div class="verde-cart-item__image" role="img" aria-label="${escapeHtml(item.name)}" style="background-image:url('${escapeHtml(item.image)}');background-size:cover;background-position:center"></div>` : '<div class="verde-cart-item__image"></div>'}
                        <div><p class="verde-cart-item__name">${escapeHtml(item.name)}</p><p class="verde-cart-item__price">${commerceMoney(item.price * item.quantity)} market value</p></div>
                        <strong>×${item.quantity}</strong>
                    </article>`).join("") : `<div class="verde-cart-empty">${materialIcon("nutrition")}<strong>A little room for your favorites.</strong><p>Add produce from the list. Every pick is included in your plan.</p></div>`;
            }
            if (persist && !editingSubscription) writeStorage(STORAGE.box, commerce.normalizeBox(Object.fromEntries(Object.entries(state).map(([name, item]) => [name, item.quantity]))));
        };
        review?.addEventListener("click", (event) => {
            if (saved) { event.preventDefault(); return; }
            const units = Object.values(state).reduce((sum, item) => sum + item.quantity, 0);
            if (!units) {
                event.preventDefault();
                showToast("Your box is empty", "Add at least one item before reviewing checkout.", "nutrition");
                return;
            }
            const box = commerce.normalizeBox(Object.fromEntries(Object.entries(state).map(([name, item]) => [name, item.quantity])));
            if (!editingSubscription) {
                if (!commitCommerceStorage({ [STORAGE.box]: box })) {
                    event.preventDefault();
                    showToast("Box could not be saved", "Allow site storage before continuing. Your picks are still here.", "info");
                }
                return;
            }
            event.preventDefault();
            const current = activeSubscription();
            if (!subscription || !current || current.number !== subscription.number || JSON.stringify(current.box) !== JSON.stringify(subscription.box)) {
                showToast("Subscription changed", "Reload this page to review the latest box before saving.", "info");
                return;
            }
            if (!commitCommerceStorage({ "verde-market-subscription-v1": commerce.normalizeOrder({ ...current, box }) })) {
                showToast("Box could not be saved", "Allow site storage and try again. Your existing box is unchanged.", "info");
                return;
            }
            saved = true;
            review.textContent = "Box saved";
            review.setAttribute("aria-disabled", "true");
            products.forEach((product) => $$("button", product).forEach((button) => { button.disabled = true; }));
            window.setTimeout(() => window.location.assign("verde-market-subscriber-dashboard.html"), 450);
        });
        review?.addEventListener("keydown", (event) => {
            if (editingSubscription && event.key === " ") { event.preventDefault(); review.click(); }
        });
        const refresh = () => {
            if (editingSubscription && !saved) return;
            subscription = activeSubscription();
            const box = commerce.normalizeBox(editingSubscription ? subscription?.box : readStorage(STORAGE.box, {}));
            plan = commerce.normalizePlan(editingSubscription ? subscription?.plan : readStorage(STORAGE.plan, null));
            Object.entries(state).forEach(([name, item]) => { item.quantity = box[name] || 0; });
            saved = false;
            if (editingSubscription) review.textContent = "Save next box";
            render();
        };
        window.addEventListener("pageshow", (event) => { if (event.persisted) refresh(); });
        window.addEventListener("storage", (event) => { if (!editingSubscription && (event.key === null || [STORAGE.plan, STORAGE.box].includes(event.key))) refresh(); });
        render();
    }

    function setupCheckout() {
        if (currentFile !== "build-my-box-checkout-finalize.html") return;
        if (!commerceControlsReady()) return;
        const commerce = window.VerdeCommerce;
        const form = $("#checkout-form");
        if (!form) return;
        const fields = $$("input, textarea", form);
        const submit = $('button[type="submit"]', form);
        const submitLabel = submit.innerHTML;
        const fill = $("#demo-fill");
        const errorSummary = $("#checkout-error-summary");
        const mode = commerce.resolveCheckoutMode(new URLSearchParams(window.location.search).get("checkout"), readStorage(STORAGE.box, {}), cart);
        let submitting = false;
        let attempted = false;
        let reviewedSummary = "";
        const getSummary = () => commerce.summarizeCheckout({ mode, plan: readStorage(STORAGE.plan, null), box: readStorage(STORAGE.box, {}), cart });

        const updateSummary = () => {
            const summary = getSummary();
            reviewedSummary = JSON.stringify(summary);
            const isBox = mode === "box";
            $("#checkout-progress").hidden = !isBox;
            $("#basket-checkout-progress").hidden = isBox;
            $("#checkout-heading").textContent = isBox ? "Everything looks fresh." : "Your market, all together.";
            $("#checkout-intro").textContent = isBox ? "Your plan, harvest preferences, and any one-time add-ons—ready for a final review." : "Review your basket and try the simulated checkout. This is a one-time order, not a subscription.";
            $("#order-summary-heading").textContent = isBox ? "Your seasonal box" : "Your market basket";
            $$('[data-box-checkout]', form).forEach((element) => { element.hidden = !isBox; });
            $("#checkout-plan-name").textContent = summary.plan?.name || "";
            $("#checkout-frequency").textContent = summary.plan?.frequency || "";
            $("#checkout-box-count").textContent = `${summary.slotCount} of ${commerce.CAPACITY} selected`;
            $("#checkout-preference-list").textContent = Object.entries(summary.box).map(([name, units]) => `${name} ×${units}`).join(" · ");
            $("#checkout-plan-price").textContent = commerceMoney(summary.planTotal);
            $("#checkout-items-heading").textContent = isBox ? "One-time add-ons" : "Basket items";
            $("#checkout-items-section").hidden = isBox && !summary.items.length;
            $("#checkout-line-items").innerHTML = renderCommerceItems(summary.items);
            $("#checkout-item-count").textContent = `${summary.itemCount} ${summary.itemCount === 1 ? "item" : "items"}`;
            $("#checkout-total").textContent = commerceMoney(summary.total);
            $("#checkout-total-note").textContent = isBox ? `${commerceMoney(summary.planTotal)} per ${summary.plan.frequency.toLowerCase()} delivery${summary.merchandise ? ` + ${commerceMoney(summary.merchandise)} in one-time add-ons` : ""}. No charge is made.` : "A one-time demo total. Delivery is included; no charge is made.";
            $("#checkout-terms").textContent = isBox ? "This simulates a flexible subscription. No real payment or account is created." : "This simulates a one-time market order. No payment, subscription, or account is created.";
            $("#checkout-delivery-date").textContent = commerceDate(commerce.nextDeliveryDate());
            $("#checkout-empty").hidden = !summary.empty;
            $("#checkout-form-details").hidden = summary.empty;
            $("#checkout-order-summary").hidden = summary.empty;
            const returnLink = $("#checkout-return");
            returnLink.href = isBox ? "build-my-box-customize-contents.html" : "verde-market-shop-page.html";
            returnLink.textContent = isBox ? "Choose your harvest" : "Browse the market";
            $("#checkout-empty-copy").textContent = isBox ? "Your box needs its first preference. Pick a favorite, then come back to review your plan." : "Your basket is empty. Add something fresh from the shop, then return to checkout.";
            submit.disabled = summary.empty || submitting;
            submit.setAttribute("aria-disabled", String(submit.disabled));
            if (fill) fill.disabled = summary.empty || submitting;
            $$('fieldset', form).forEach((fieldset) => { fieldset.disabled = summary.empty || submitting; });
        };

        const errorFor = (field) => {
            const value = field.value.trim();
            if (field.required && !value) return "Please complete this field.";
            if (field.name === "cardNumber" && value.replace(/\D/g, "") !== "4242424242424242") return "Use the test card 4242 4242 4242 4242. Do not enter a real card.";
            if (field.name === "expiry") {
                const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value);
                if (!match) return "Enter a valid future expiry in MM/YY format.";
                const end = new Date(2000 + Number(match[2]), Number(match[1]), 0, 23, 59, 59);
                if (end < new Date()) return "Use a future test expiry date.";
            }
            if (field.name === "cvc" && !/^\d{3,4}$/.test(value)) return "Enter a fictional 3- or 4-digit CVC, such as 123.";
            if (field.name === "postalCode" && !/^\d{5}(?:-\d{4})?$/.test(value)) return "Use a 5-digit demo ZIP code, such as 97204.";
            return "";
        };
        const validate = (field) => {
            const message = errorFor(field);
            field.setCustomValidity(message);
            field.setAttribute("aria-invalid", String(Boolean(message)));
            const error = $(`#${field.id}-error`);
            error.textContent = message;
            error.hidden = !message;
            return !message;
        };
        fields.forEach((field) => {
            const error = document.createElement("p");
            error.id = `${field.id}-error`;
            error.className = "mt-2 text-sm font-semibold text-[#a13d26]";
            error.hidden = true;
            field.insertAdjacentElement("afterend", error);
            field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
            field.addEventListener("input", () => {
                if (field.name === "cardNumber") field.value = field.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
                if (field.name === "expiry") {
                    const digits = field.value.replace(/\D/g, "").slice(0, 4);
                    field.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
                }
                if (field.name === "cvc") field.value = field.value.replace(/\D/g, "").slice(0, 4);
                if (attempted || field.getAttribute("aria-invalid") === "true") validate(field);
            });
            field.addEventListener("blur", () => { if (field.value.trim()) validate(field); });
        });

        fill?.addEventListener("click", () => {
            const values = { firstName: "Alex", lastName: "Morgan", address: "18 Garden Lane", city: "Portland", postalCode: "97204", cardNumber: "4242 4242 4242 4242", expiry: `12/${String(new Date().getFullYear() + 4).slice(-2)}`, cvc: "123" };
            fields.forEach((field) => {
                if (values[field.name]) field.value = values[field.name];
                validate(field);
            });
            errorSummary.hidden = true;
            showToast("Demo details added", "Only fictional details are used. Review the total, then place your demo order.", "verified_user");
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (submitting) return;
            // A background tab may already have consumed or changed this cart.
            // Read it again at the save boundary, even before storage events run.
            cart = commerce.normalizeCart(readStorage(STORAGE.cart, []));
            const summary = getSummary();
            if (summary.empty) {
                updateSummary();
                $("#checkout-return").focus();
                return;
            }
            if (JSON.stringify(summary) !== reviewedSummary) {
                updateSummary();
                updateCartTriggers();
                renderCart();
                errorSummary.hidden = false;
                errorSummary.textContent = "Your order changed in another tab. Review the updated items and total, then submit again.";
                errorSummary.focus();
                return;
            }
            attempted = true;
            const invalid = fields.filter((field) => !validate(field));
            if (invalid.length) {
                errorSummary.hidden = false;
                errorSummary.textContent = `Please check ${invalid.length} ${invalid.length === 1 ? "field" : "fields"} below. Nothing has been submitted.`;
                invalid[0].focus();
                return;
            }
            errorSummary.hidden = true;
            submitting = true;
            form.setAttribute("aria-busy", "true");
            updateSummary();
            const order = commerce.createOrder({ mode, plan: summary.plan, box: summary.box, cart: summary.items });
            const changes = {};
            if (mode === "basket") {
                const dedicated = commerce.normalizeOrder(readStorage("verde-market-subscription-v1", null));
                const legacy = activeSubscription();
                // Older saved demos kept the active box only in the last-order
                // slot. Preserve it before a one-time receipt replaces that slot.
                if (dedicated?.mode !== "box" && legacy) changes["verde-market-subscription-v1"] = legacy;
            }
            changes[STORAGE.order] = order;
            if (mode === "box") {
                changes["verde-market-subscription-v1"] = order;
                changes["verde-market-dashboard-v1"] = { paused: false, nextDate: order.deliveryDate };
                changes[STORAGE.box] = {};
            }
            changes[STORAGE.cart] = [];
            if (!commitCommerceStorage(changes)) {
                submitting = false;
                form.removeAttribute("aria-busy");
                errorSummary.hidden = false;
                errorSummary.textContent = "This browser could not save the demo order. Allow site storage or try another browser; your basket has not been cleared.";
                updateSummary();
                errorSummary.focus();
                return;
            }
            cart = [];
            updateCartTriggers();
            renderCart();
            document.dispatchEvent(new CustomEvent("verde:cartchange"));
            submit.innerHTML = `${materialIcon("progress_activity", "animate-spin")} Saving your demo order…`;
            window.setTimeout(() => window.location.assign("verde-market-order-confirmation.html"), 450);
        });
        document.addEventListener("verde:cartchange", () => { if (!submitting) updateSummary(); });
        window.addEventListener("storage", (event) => {
            if (submitting) return;
            if (event.key === null || event.key === STORAGE.cart) cart = commerce.normalizeCart(readStorage(STORAGE.cart, []));
            if (event.key === null || [STORAGE.cart, STORAGE.plan, STORAGE.box].includes(event.key)) updateSummary();
        });
        window.addEventListener("pageshow", (event) => {
            if (!event.persisted) return;
            submitting = false;
            cart = commerce.normalizeCart(readStorage(STORAGE.cart, []));
            form.removeAttribute("aria-busy");
            submit.innerHTML = submitLabel;
            errorSummary.hidden = true;
            updateSummary();
        });
        updateSummary();
    }

    function setupOrderConfirmation() {
        if (currentFile !== "verde-market-order-confirmation.html") return;
        if (!commerceControlsReady()) return;
        const commerce = window.VerdeCommerce;
        const render = () => {
            const order = commerce.normalizeOrder(readStorage(STORAGE.order, null));
            $("#confirmation-empty").hidden = Boolean(order);
            $("#confirmation-content").hidden = !order;
            $("#confirmation-progress").hidden = !order || order.mode !== "box";
            if (!order) return;
            const isBox = order.mode === "box";
            const slotCount = commerce.boxCount(order.box);
            $("[data-order-number]").textContent = order.number;
            $("#confirmation-kicker").textContent = isBox ? "Your simulated subscription is ready" : "Your simulated market order is ready";
            $("#confirmation-plan-label").textContent = isBox ? "Your box" : "Order type";
            $("#confirmation-plan").textContent = order.plan?.name || "One-time market basket";
            $("#confirmation-frequency").textContent = order.plan?.frequency || "One-time purchase";
            $("#confirmation-box-details").hidden = !isBox;
            $("#confirmation-box-summary").textContent = `${slotCount} preference ${slotCount === 1 ? "slot" : "slots"}: ${Object.entries(order.box).map(([name, units]) => `${name} ×${units}`).join(", ")}.${slotCount < commerce.CAPACITY ? ` Your grower fills the remaining ${commerce.CAPACITY - slotCount} slots.` : ""}`;
            $("#confirmation-items-section").hidden = !order.items.length;
            $("#confirmation-items-heading").textContent = isBox ? "One-time add-ons" : "Your market basket";
            $("#confirmation-items").innerHTML = renderCommerceItems(order.items);
            $("#confirmation-total").textContent = commerceMoney(order.total);
            $("#confirmation-delivery-date").textContent = commerceDate(order.deliveryDate);
            const primary = $("#confirmation-primary");
            primary.textContent = isBox ? "Open subscriber dashboard" : "Back to the market";
            primary.href = isBox ? "verde-market-subscriber-dashboard.html" : "verde-market-shop-page.html";
            $("#confirmation-view").textContent = isBox ? "View my box" : "Continue shopping";
            $("#confirmation-view").href = primary.href;
            $("#confirmation-build").textContent = isBox ? "Build another" : "Build a box";
            $("#confirmation-total-note").textContent = "Saved demo total · no payment was taken";
        };
        window.addEventListener("pageshow", render);
        window.addEventListener("storage", (event) => { if (event.key === null || event.key === STORAGE.order) render(); });
        render();
    }

    function setupSubscriberDashboard() {
        if (currentFile !== "verde-market-subscriber-dashboard.html") return;
        if (!commerceControlsReady()) return;
        const commerce = window.VerdeCommerce;
        let order = commerce.normalizeOrder(readStorage(STORAGE.order, null));
        let subscription = activeSubscription();
        let plan = commerce.normalizePlan(subscription?.plan);
        let schedule = commerce.normalizeSchedule(readStorage("verde-market-dashboard-v1", { nextDate: subscription?.deliveryDate }), plan.frequency);
        const pauseButtons = [$("#pause-plan"), $('[data-dashboard-tool="pause"]')];
        const skipButtons = [$("#skip-delivery"), $('[data-dashboard-tool="skip"]')];
        const announcement = $("#dashboard-announcement");
        const undo = $("#dashboard-undo");
        let previousSchedule = null;
        let appliedScheduleSnapshot = null;
        const scheduleSnapshot = () => JSON.stringify({ subscription, schedule });
        const feedback = (message) => {
            announcement.textContent = message;
            $("#dashboard-feedback").hidden = false;
            $("#dashboard-feedback-text").textContent = message;
        };
        const render = () => {
            $("#dashboard-subscription-empty").hidden = Boolean(subscription);
            $$('[data-subscription-panel]').forEach((panel) => { panel.hidden = !subscription; });
            $$('[data-edit-plan]').forEach((link) => {
                link.href = subscription ? "build-my-box-select-plan?edit=subscription" : "build-my-box-select-plan.html";
                if (!subscription) link.textContent = "Build a box";
            });
            $("#dashboard-plan-name").textContent = subscription ? plan.name : "No active subscription";
            $("#dashboard-frequency").textContent = subscription ? plan.frequency : "—";
            $("#dashboard-price").textContent = subscription ? `${commerceMoney(plan.price)} per box` : "—";
            $("#dashboard-slot-count").textContent = String(commerce.boxCount(subscription?.box));
            $("#dashboard-cadence-short").textContent = subscription ? plan.frequency === "Monthly" ? "1mo" : plan.frequency === "Bi-weekly" ? "2w" : "1w" : "—";
            $("#dashboard-order-empty").hidden = Boolean(order);
            $("#dashboard-order-table").hidden = !order;
            if (order) {
                $("#dashboard-order-number").textContent = order.number;
                $("#dashboard-order-date").textContent = commerceDate(order.placedAt, { weekday: undefined, year: "numeric" });
                $("#dashboard-order-plan").textContent = order.plan?.name || "Market basket";
                $("#dashboard-order-total").textContent = commerceMoney(order.total);
            }
            const paused = schedule.paused;
            $("#dashboard-delivery-date").textContent = !subscription ? "No delivery scheduled" : paused ? "Plan paused" : commerceDate(schedule.nextDate);
            $("#delivery-state").textContent = !subscription ? "Complete a box checkout to start your subscription." : paused ? "Resume whenever you’re ready. No deliveries are scheduled while paused." : "Packing window opens 48 hours before delivery.";
            $("#pause-plan").textContent = paused ? "Resume plan" : "Pause plan";
            pauseButtons.forEach((button) => { button.setAttribute("aria-pressed", String(paused)); button.disabled = !subscription; });
            skipButtons.forEach((button) => { button.disabled = paused || !subscription; });
            $("#dashboard-pause-label").textContent = paused ? "Resume your plan" : "Pause your plan";
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const next = new Date(schedule.nextDate);
            next.setHours(0, 0, 0, 0);
            $("#countdown-days").textContent = paused || !subscription ? "—" : String(Math.max(0, Math.round((next - today) / 86400000)));
            undo.hidden = !previousSchedule;
        };
        const refresh = () => {
            order = commerce.normalizeOrder(readStorage(STORAGE.order, null));
            subscription = activeSubscription();
            plan = commerce.normalizePlan(subscription?.plan);
            schedule = commerce.normalizeSchedule(readStorage("verde-market-dashboard-v1", { nextDate: subscription?.deliveryDate }), plan.frequency);
            // Undo belongs to the exact change applied here, not whatever state
            // a later history/visibility refresh happens to load into schedule.
            if (previousSchedule && scheduleSnapshot() !== appliedScheduleSnapshot) {
                previousSchedule = null;
                appliedScheduleSnapshot = null;
                feedback("Your subscription or schedule changed. The latest state is shown; that older change can no longer be undone.");
            }
            render();
        };
        const changeSchedule = (action) => {
            refresh();
            if (!subscription) return;
            if (action === "skip" && schedule.paused) return;
            const nextSchedule = action === "skip"
                ? { ...schedule, nextDate: commerce.advanceDeliveryDate(schedule.nextDate, plan.frequency).toISOString() }
                : { ...schedule, paused: !schedule.paused };
            if (!commitCommerceStorage({ "verde-market-dashboard-v1": nextSchedule })) {
                feedback("This browser could not save the schedule change. Allow site storage and try again; your saved schedule is unchanged.");
                return;
            }
            previousSchedule = { ...schedule };
            schedule = nextSchedule;
            appliedScheduleSnapshot = scheduleSnapshot();
            const message = action === "skip" ? `Delivery moved to ${commerceDate(schedule.nextDate)}.` : schedule.paused ? "Your demo subscription is paused." : "Your demo subscription is active again.";
            feedback(message);
            render();
        };
        skipButtons.forEach((button) => button.addEventListener("click", () => changeSchedule("skip")));
        pauseButtons.forEach((button) => button.addEventListener("click", () => changeSchedule("pause")));
        undo.addEventListener("click", () => {
            if (!previousSchedule) return;
            refresh();
            if (!previousSchedule) return;
            const restored = commerce.normalizeSchedule(previousSchedule, plan.frequency);
            if (!commitCommerceStorage({ "verde-market-dashboard-v1": restored })) {
                feedback("This browser could not save the undo. Allow site storage and try again.");
                return;
            }
            schedule = restored;
            previousSchedule = null;
            appliedScheduleSnapshot = null;
            feedback("Your previous schedule has been restored.");
            render();
            $("#pause-plan").focus();
        });
        window.addEventListener("storage", (event) => {
            if (event.key === null || [STORAGE.order, "verde-market-subscription-v1", "verde-market-dashboard-v1"].includes(event.key)) {
                refresh();
            }
        });
        window.addEventListener("pageshow", refresh);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
        render();
    }

    function setupLocationSearch() {
        if (document.body.dataset.locationSearchManaged === "true") return;
        const input = $('[data-location-search], input[type="search"], input[placeholder*="location" i], input[placeholder*="local Verde" i]');
        const cards = $$('[data-location-card]');
        if (!input || !cards.length) return;
        const empty = document.createElement("div");
        empty.className = "verde-empty-state verde-hidden";
        empty.textContent = "No market matches that search. Try another neighborhood or postcode.";
        cards[cards.length - 1].insertAdjacentElement("afterend", empty);
        const filter = () => {
            const query = input.value.trim().toLowerCase();
            let visible = 0;
            cards.forEach((card) => {
                const match = !query || card.textContent.toLowerCase().includes(query);
                card.classList.toggle("verde-hidden", !match);
                if (match) visible += 1;
            });
            empty.classList.toggle("verde-hidden", visible > 0);
        };
        input.setAttribute("aria-label", "Search market locations");
        input.addEventListener("input", filter);
        cards.forEach((card) => {
            $$('button', card).forEach((button) => {
                if (/directions/i.test(button.textContent)) {
                    button.addEventListener("click", () => {
                        const query = encodeURIComponent(card.dataset.locationCard || card.textContent.trim());
                        window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, "_blank", "noopener,noreferrer");
                    });
                }
                if (/store info/i.test(button.textContent)) {
                    button.addEventListener("click", () => showToast("Store details", "Hours, pickup options, and accessibility information are shown on this location card.", "storefront"));
                }
            });
        });
    }

    function setupShopFilters() {
        if (currentFile !== "verde-market-shop-page.html") return;
        if (document.body.dataset.shopFiltersManaged === "true") return;
        const filters = $$('[data-shop-filter]');
        const products = $$('[data-category]');
        if (!filters.length || !products.length) return;
        const empty = document.createElement("div");
        empty.className = "verde-empty-state verde-hidden";
        empty.textContent = "That aisle is being restocked. Try another fresh category.";
        $(".products-grid")?.append(empty);
        const apply = (filter) => {
            let visible = 0;
            products.forEach((product) => {
                const categories = (product.dataset.category || "").split(/\s+/);
                const match = filter === "all" || categories.includes(filter);
                product.classList.toggle("verde-hidden", !match);
                if (match) visible += 1;
            });
            empty.classList.toggle("verde-hidden", visible > 0);
            filters.forEach((link) => {
                const selected = link.dataset.shopFilter === filter;
                link.setAttribute("aria-pressed", String(selected));
                link.classList.toggle("bg-primary", selected);
                link.classList.toggle("text-white", selected);
            });
        };
        filters.forEach((link) => link.addEventListener("click", (event) => {
            event.preventDefault();
            const filter = link.dataset.shopFilter;
            window.history.replaceState({}, "", filter === "all" ? currentFile : `${currentFile}#${filter}`);
            apply(filter);
        }));
        apply(window.location.hash.slice(1) || "all");
    }

    function setupBlogFilters() {
        if (currentFile !== "verde-market-blog-journal.html") return;
        const filters = $$('[data-topic-filter]');
        const articles = $$('.journal-card[data-topic]');
        const search = $("#journal-search-input");
        if (!articles.length || !search) return;
        const topics = new Set(filters.map((filter) => filter.dataset.topicFilter));
        const articleText = new Map(articles.map((article) => [article,
            $$('h2, h3, p, time, .journal-category', article).map((item) => item.textContent).join(" ").toLowerCase(),
        ]));
        let topic = "all";
        const linkedNote = () => {
            let id;
            try { id = decodeURIComponent(window.location.hash.slice(1)); }
            catch { return null; }
            const target = document.getElementById(id);
            return target?.matches(".journal-card, .journal-feature details") ? target : null;
        };
        const syncURL = (push = false, clearNote = false) => {
            const url = new URL(window.location.href);
            const query = search.value.trim();
            if (query) url.searchParams.set("q", query);
            else url.searchParams.delete("q");
            if (topic !== "all") url.searchParams.set("topic", topic);
            else url.searchParams.delete("topic");
            if (clearNote && linkedNote()) url.hash = "";
            if (url.href !== window.location.href) {
                window.history[push ? "pushState" : "replaceState"]({}, "", url);
            }
        };
        const apply = () => {
            const query = search.value.trim().toLowerCase();
            let visible = 0;
            articles.forEach((article) => {
                const articleTopics = (article.dataset.topic || "").split(/\s+/);
                const topicMatch = topic === "all" || articleTopics.includes(topic);
                const searchMatch = !query || articleText.get(article).includes(query);
                const match = topicMatch && searchMatch;
                article.classList.toggle("verde-hidden", !match);
                if (match) visible += 1;
            });
            filters.forEach((filter) => {
                const selected = filter.dataset.topicFilter === topic;
                filter.setAttribute("aria-pressed", String(selected));
                filter.classList.toggle("text-primary", selected);
            });
            const empty = $("#journal-empty");
            empty?.classList.toggle("verde-hidden", visible > 0);
            const count = $("#journal-results-count");
            if (count) count.textContent = `${visible} of ${articles.length} field notes${query ? ` for “${search.value.trim()}”` : ""}`;
        };
        filters.forEach((filter) => filter.addEventListener("click", (event) => {
            event.preventDefault();
            topic = filter.dataset.topicFilter;
            syncURL(true, true);
            apply();
        }));
        search.addEventListener("input", () => { syncURL(false, true); apply(); });
        $$('[data-journal-reset]').forEach((button) => button.addEventListener("click", () => {
            search.value = "";
            topic = "all";
            syncURL(true, true);
            apply();
            search.focus({ preventScroll: true });
        }));
        const subscribe = $$('button').find((button) => /^subscribe$/i.test(button.textContent.trim()) && !button.closest("form"));
        subscribe?.addEventListener("click", () => {
            const email = $("#journal-email");
            email?.focus({ preventScroll: true });
            email?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
        });
        const restore = () => {
            const url = new URL(window.location.href);
            const requestedTopic = url.searchParams.get("topic");
            topic = topics.has(requestedTopic) ? requestedTopic : "all";
            search.value = (url.searchParams.get("q") || "").slice(0, 80);
            const target = linkedNote();
            if (target?.matches(".journal-card")) {
                const articleTopics = target.dataset.topic.split(/\s+/);
                if (topic !== "all" && !articleTopics.includes(topic)) topic = articleTopics.find((value) => topics.has(value)) || "all";
                if (!articleText.get(target).includes(search.value.trim().toLowerCase())) search.value = "";
                syncURL();
            }
            apply();
            if (target) {
                const details = target.matches("details") ? target : $("details", target);
                if (details) details.open = true;
                target.scrollIntoView({ behavior: "auto", block: "start" });
            }
        };
        window.addEventListener("popstate", restore);
        window.addEventListener("hashchange", restore);
        restore();
    }

    function setupSustainabilityActions() {
        if (currentFile !== "verde-market-sustainability.html") return;
        $$('button, a').forEach((element) => {
            if (/shop sustainable/i.test(element.textContent)) {
                element.addEventListener("click", () => { window.location.href = "verde-market-shop-page.html"; });
            }
            if (/read our report/i.test(element.textContent)) {
                element.addEventListener("click", () => {
                    const heading = $$('h2, h3').find((item) => /impact metrics/i.test(item.textContent));
                    heading?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
                    showToast("2026 impact snapshot", "The key environmental metrics are highlighted below.", "eco");
                });
            }
        });
    }

    function setupHelpButton() {
        const buttons = $$('button').filter((button) => $(".material-symbols-outlined", button)?.textContent.trim() === "help");
        if (!buttons.length) return;
        const dialog = ensureDialog(
            "verde-help-dialog",
            `<span class="verde-dialog__eyebrow">Build your box</span><h2>Choose what feels good this week.</h2><p>Add or remove items until the fullness meter reaches your preferred mix. This portfolio demo saves choices in your browser and never charges a payment method.</p><a class="verde-primary-action" href="verde-market-locations.html">Contact &amp; pickup information</a>`,
        );
        buttons.forEach((button) => button.addEventListener("click", () => dialog.showModal()));
    }

    function handleLegacyPlaceholderLinks() {
        $$('a[href="#"]').forEach((link) => {
            link.addEventListener("click", (event) => {
                event.preventDefault();
                showToast("Portfolio demo", "This supporting destination is represented by the interactive storefront flow.", "info");
            });
        });
    }

    function settleReducedMotion() {
        if (!prefersReducedMotion) return;
        window.setTimeout(() => {
            if (window.ScrollTrigger) {
                window.ScrollTrigger.getAll().forEach((trigger) => {
                    trigger.animation?.progress(1);
                    trigger.kill();
                });
            }
            if (window.gsap) window.gsap.globalTimeline.timeScale(1000);
            $("#preloader")?.remove();
            document.body.style.cursor = "auto";
        }, 0);
    }

    function enhanceImages() {
        const images = $$("img");
        const primary = $("main img");
        images.forEach((image) => {
            image.decoding ||= "async";
            if (image === primary) {
                image.fetchPriority = "high";
            } else {
                image.loading ||= "lazy";
            }
        });
    }

    function init() {
        ensureMainLandmark();
        enhanceImages();
        updateCopyrightYears();
        markCurrentNavigation();
        setupMobileNavigation();
        setupCart();
        setupNewsletters();
        setupStoryDialog();
        setupAccountButtons();
        setupPlanSelector();
        setupBoxBuilder();
        setupCheckout();
        setupOrderConfirmation();
        setupSubscriberDashboard();
        setupLocationSearch();
        setupShopFilters();
        setupBlogFilters();
        setupSustainabilityActions();
        setupHelpButton();
        handleLegacyPlaceholderLinks();
        settleReducedMotion();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
