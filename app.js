/* =========================================================
   KASI MEALS — customer app (v5)
   Restaurants + menus come from Supabase, orders are placed
   through the place_order() database function, customers can
   create an account and see their order history.
========================================================= */

const SUPABASE_URL = "https://yrcoiwybsjhrmxaswocz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyY29pd3lic2pocm14YXN3b2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NzU2ODYsImV4cCI6MjEwNzI1MTY4Nn0.Jw--tFIC4PuPB0vdJaZCn4UjLwb4BLHFtufC6FE2wq8";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const body = document.body;
const themeToggle = document.getElementById("themeToggle");

/* ---------- state ---------- */
let cart = [];                  // { id, restaurantId, name, description, emoji, price, quantity }
let activeCategory = "all";

const FAV_KEY = "kasi-favourites-v2";   // stores restaurant ids
let favourites = [];
try { favourites = JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { favourites = []; }

let homeHTML = "";              // pristine copy of the home page
let restaurants = [];           // loaded from Supabase
let allMenuItems = [];          // loaded from Supabase
let catalogError = "";

let currentView = "home";
let returnView = "home";        // which tab to go back to
let viewRestaurantId = null;
let shownMenu = [];

let discoverQuery = "";
let discoverFilter = "all";
let discoverDishes = [];

const LOC_KEY = "kasi-location";
let deliveryLocation = null;    // { label, address, lat, lng }
try { deliveryLocation = JSON.parse(localStorage.getItem(LOC_KEY)); } catch (e) { deliveryLocation = null; }

let currentUser = null;
let authMode = "login";
let historyOrders = [];
let historyItems = {};

const STATUS_LABELS = {
    placed: "Received",
    preparing: "Preparing",
    on_the_way: "On the way",
    delivered: "Delivered",
    cancelled: "Cancelled"
};

const IMAGE_CLASS = {
    kotas: "kota-image", meals: "meals-image", braai: "braai-image", chicken: "chicken-image"
};

/* =========================================================
   THEME
========================================================= */
const savedTheme = localStorage.getItem("kasi-theme");
if (savedTheme === "dark") {
    body.dataset.theme = "dark";
    if (themeToggle) themeToggle.textContent = "☀️";
}

if (themeToggle) {
    themeToggle.addEventListener("click", () => {
        const isDark = body.dataset.theme === "dark";
        if (isDark) {
            delete body.dataset.theme;
            themeToggle.textContent = "🌙";
            localStorage.setItem("kasi-theme", "light");
        } else {
            body.dataset.theme = "dark";
            themeToggle.textContent = "☀️";
            localStorage.setItem("kasi-theme", "dark");
        }
    });
}

/* =========================================================
   SMALL HELPERS
========================================================= */
function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function restaurantById(id) {
    return restaurants.find(r => r.id === id) || null;
}

function showToast(message) {
    const existing = document.querySelector(".cart-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "cart-toast";
    const tick = document.createElement("span");
    tick.textContent = "✓";
    toast.append(tick, " " + message);   // text only: safe for names from the database
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 1800);
}

function mapRestaurant(row) {
    const rating = Number(row.rating) || 0;
    const fee = Number(row.delivery_fee) || 0;
    const min = Number(row.min_order) || 0;
    return {
        id: row.id,
        name: row.name,
        type: row.type || "",
        category: row.category || "meals",
        emoji: row.emoji || "🍛",
        imageClass: row.image_class || IMAGE_CLASS[row.category] || "",
        rating,
        ratingText: rating > 0 ? "⭐ " + rating.toFixed(1) : "⭐ New",
        delivery: row.delivery_time || "20–30 min",
        minutes: parseInt(row.delivery_time, 10) || 99,
        minOrderValue: min,
        minOrder: min > 0 ? `R${min} min.` : "No minimum",
        deliveryFee: fee,
        freeOver: Number(row.free_delivery_over) || 0,
        fee: fee === 0 ? "Free delivery" : `R${fee} delivery`,
        isOpen: row.is_open !== false
    };
}

function mapItem(row) {
    return {
        id: row.id,
        restaurantId: row.restaurant_id,
        name: row.name,
        description: row.description || "",
        emoji: row.emoji || "🍽️",
        price: Number(row.price) || 0,
        available: row.is_available !== false
    };
}

async function loadCatalog() {
    const [r, m] = await Promise.all([
        supabaseClient.from("restaurants").select("*").order("created_at", { ascending: true }),
        supabaseClient.from("menu_items").select("*")
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })
    ]);
    if (r.error) throw r.error;
    if (m.error) throw m.error;
    restaurants = (r.data || []).map(mapRestaurant);
    allMenuItems = (m.data || []).map(mapItem);
}

/* =========================================================
   CART HELPERS
========================================================= */
function updateCartCount() {
    const el = document.querySelector(".cart-count");
    if (!el) return;
    el.textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
}

function cartRestaurant() {
    return cart.length ? restaurantById(cart[0].restaurantId) : null;
}

// returns true when the item was added
function addToCart(item, quantity = 1) {
    const r = restaurantById(item.restaurantId);

    if (r && !r.isOpen) {
        showToast(`${r.name} is closed right now`);
        return false;
    }

    if (cart.length && cart[0].restaurantId !== item.restaurantId) {
        const from = cartRestaurant()?.name || "another restaurant";
        const to = r?.name || "this restaurant";
        if (!confirm(`Your cart has items from ${from}. Start a new cart with ${to}?`)) return false;
        cart = [];
    }

    const existing = cart.find(i => i.id === item.id);
    if (existing) {
        existing.quantity += quantity;
    } else {
        cart.push({
            id: item.id,
            restaurantId: item.restaurantId,
            name: item.name,
            description: item.description || "",
            emoji: item.emoji || "🍽️",
            price: item.price,
            quantity
        });
    }
    updateCartCount();
    showToast(`${item.name} added to cart`);
    return true;
}

function calculateSubtotal() {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

function calculateDelivery() {
    const r = cartRestaurant();
    if (!cart.length || !r) return 0;
    return calculateSubtotal() >= r.freeOver ? 0 : r.deliveryFee;
}

function calculateTotal() {
    return calculateSubtotal() + calculateDelivery();
}

/* =========================================================
   RESTAURANT VIEW
========================================================= */
function renderMenuItems(items, closed) {
    shownMenu = items;
    const box = document.getElementById("menuList");
    if (!box) return;

    if (!items.length) {
        box.innerHTML = `<p class="grid-note">This menu is empty for now. Check back soon.</p>`;
        return;
    }

    box.innerHTML = items.map((item, index) => `
        <article class="menu-item ${item.available ? "" : "is-sold-out"}">
            <div class="menu-item-food">${esc(item.emoji)}</div>
            <div class="menu-item-info">
                <h3>${esc(item.name)}</h3>
                <p>${esc(item.description)}</p>
                <strong>R${item.price}</strong>
            </div>
            <button class="add-menu-item" data-index="${index}" type="button"
                    ${item.available && !closed ? "" : "disabled"}>
                ${item.available ? (closed ? "Closed" : "+ Add") : "Sold out"}
            </button>
        </article>
    `).join("");
}

async function openRestaurant(id) {
    const r = restaurantById(id);
    const main = document.querySelector("main");
    if (!r || !main) return;

    rememberReturnView();
    currentView = "restaurant";
    viewRestaurantId = id;
    window.scrollTo({ top: 0 });

    main.innerHTML = `
        <section class="restaurant-view">
            <button class="back-button" id="backToHome" type="button">← Back</button>

            <div class="restaurant-hero">
                <div class="restaurant-hero-food">${esc(r.emoji)}</div>
                <div class="restaurant-hero-info">
                    <span class="section-kicker">${r.isOpen ? "LOCAL FAVOURITE" : "CLOSED RIGHT NOW"}</span>
                    <h1>${esc(r.name)}</h1>
                    <p>${esc(r.type)}</p>
                    <div class="restaurant-hero-meta">
                        <span>${esc(r.ratingText)}</span>
                        <span>•</span>
                        <span>${esc(r.delivery)}</span>
                        <span>•</span>
                        <span>${esc(r.minOrder)}</span>
                    </div>
                </div>
            </div>

            <div class="menu-heading">
                <span class="section-kicker">MENU</span>
                <h2>What are you having?</h2>
            </div>

            <div class="menu-list" id="menuList"></div>
        </section>
    `;

    document.getElementById("backToHome")?.addEventListener("click", restorePreviousView);

    document.getElementById("menuList").addEventListener("click", (e) => {
        const btn = e.target.closest(".add-menu-item");
        if (!btn || btn.disabled) return;
        const item = shownMenu[Number(btn.dataset.index)];
        if (item && addToCart(item)) {
            btn.textContent = "Added ✓";
            btn.classList.add("added");
            setTimeout(() => {
                btn.textContent = "+ Add";
                btn.classList.remove("added");
            }, 1200);
        }
    });

    // Show what we already have straight away, then refresh from Supabase
    renderMenuItems(allMenuItems.filter(i => i.restaurantId === id), !r.isOpen);

    const { data, error } = await supabaseClient
        .from("menu_items").select("*").eq("restaurant_id", id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

    if (error) return;
    const fresh = (data || []).map(mapItem);
    allMenuItems = allMenuItems.filter(i => i.restaurantId !== id).concat(fresh);
    if (currentView === "restaurant" && viewRestaurantId === id) {
        renderMenuItems(fresh, !r.isOpen);
    }
}

/* =========================================================
   CART VIEW
========================================================= */
function openCart() {
    const main = document.querySelector("main");
    if (!main) return;

    rememberReturnView();
    currentView = "cart";
    setActiveNav("cart");

    if (cart.length === 0) {
        main.innerHTML = `
            <section class="cart-view">
                <button class="back-button" id="backFromCart" type="button">← Back</button>
                <div class="cart-header">
                    <span class="section-kicker">YOUR ORDER</span>
                    <h1>Your cart</h1>
                </div>
                <div class="cart-empty">
                    <div class="cart-empty-icon">🛒</div>
                    <h2>Your cart is empty</h2>
                    <p>Add something delicious from a local spot.</p>
                    <button class="primary-action" id="startOrdering" type="button">Start ordering</button>
                </div>
            </section>
        `;
        document.getElementById("backFromCart")?.addEventListener("click", restorePreviousView);
        document.getElementById("startOrdering")?.addEventListener("click", () => navigate("home"));
        return;
    }

    const r = cartRestaurant();
    const subtotal = calculateSubtotal();
    const delivery = calculateDelivery();
    const total = calculateTotal();
    const belowMin = r && subtotal < r.minOrderValue;

    main.innerHTML = `
        <section class="cart-view">
            <button class="back-button" id="backFromCart" type="button">← Back</button>
            <div class="cart-header">
                <span class="section-kicker">YOUR ORDER</span>
                <h1>Your cart</h1>
                <p>${cart.reduce((s, i) => s + i.quantity, 0)} item(s)${r ? " from <strong>" + esc(r.name) + "</strong>" : ""}</p>
            </div>

            <div class="cart-items">
                ${cart.map((item, index) => `
                    <article class="cart-item">
                        <div class="cart-item-image">${esc(item.emoji || "🍛")}</div>
                        <div class="cart-item-info">
                            <h3>${esc(item.name)}</h3>
                            <p>${esc(item.description || "")}</p>
                            <strong>R${item.price}</strong>
                            <div class="quantity-control">
                                <button class="quantity-button" data-action="decrease" data-index="${index}">−</button>
                                <span>${item.quantity}</span>
                                <button class="quantity-button" data-action="increase" data-index="${index}">+</button>
                            </div>
                        </div>
                        <button class="remove-item" data-index="${index}" type="button">×</button>
                    </article>
                `).join("")}
            </div>

            <div class="cart-summary">
                <h2>Order summary</h2>
                <div class="summary-row"><span>Subtotal</span><strong>R${subtotal}</strong></div>
                <div class="summary-row"><span>Delivery</span><strong>${delivery === 0 ? "FREE" : "R" + delivery}</strong></div>
                <div class="summary-divider"></div>
                <div class="summary-total"><span>Total</span><strong>R${total}</strong></div>
                ${belowMin ? `<p class="min-note">Minimum order for ${esc(r.name)} is R${r.minOrderValue}. Add R${r.minOrderValue - subtotal} more.</p>` : ""}
                <button class="checkout-button" id="checkoutButton" type="button" ${belowMin ? "disabled" : ""}>
                    Proceed to checkout <span>→</span>
                </button>
            </div>
        </section>
    `;

    document.getElementById("backFromCart")?.addEventListener("click", restorePreviousView);

    document.querySelectorAll(".quantity-button").forEach(btn => {
        btn.addEventListener("click", () => {
            const index = Number(btn.dataset.index);
            const change = btn.dataset.action === "increase" ? 1 : -1;
            cart[index].quantity += change;
            if (cart[index].quantity <= 0) cart.splice(index, 1);
            updateCartCount();
            openCart();
        });
    });

    document.querySelectorAll(".remove-item").forEach(btn => {
        btn.addEventListener("click", () => {
            cart.splice(Number(btn.dataset.index), 1);
            updateCartCount();
            openCart();
        });
    });

    document.getElementById("checkoutButton")?.addEventListener("click", openCheckout);
}

/* =========================================================
   CHECKOUT
========================================================= */
function openCheckout() {
    const main = document.querySelector("main");
    if (!main || !cart.length) return;

    const total = calculateTotal();
    currentView = "checkout";

    const meta = currentUser?.user_metadata || {};
    const prefillName = meta.full_name || "";
    const prefillPhone = meta.phone || "";

    main.innerHTML = `
        <section class="checkout-view">
            <button class="back-button" id="backFromCheckout" type="button">← Back to cart</button>
            <div class="checkout-header">
                <span class="section-kicker">CHECKOUT</span>
                <h1>Almost there 🔥</h1>
                <p>Enter your details so the vendor can reach you.</p>
            </div>
            <div class="checkout-card">
                ${currentUser
                    ? `<p class="signed-in-note">Signed in as <strong>${esc(currentUser.email)}</strong>. This order will appear in your order history.</p>`
                    : `<p class="signed-in-note">Ordering as a guest. <button class="link-button" id="loginFromCheckout" type="button">Log in or sign up</button> to save your details and track your orders.</p>`}
                <div class="checkout-form">
                    <label>
                        <span>Your name</span>
                        <input type="text" id="customerName" placeholder="e.g. Thabo" value="${esc(prefillName)}" required>
                    </label>
                    <label>
                        <span>Phone number</span>
                        <input type="tel" id="customerPhone" placeholder="e.g. 082 123 4567" value="${esc(prefillPhone)}" required>
                    </label>
                    <label>
                        <span>Delivery address &amp; notes</span>
                        <textarea id="deliveryNotes" rows="3" placeholder="Street, hostel name, room number or landmark">${esc(deliveryLocation ? (deliveryLocation.address || deliveryLocation.label || "") : "")}</textarea>
                    </label>
                </div>
                <div class="checkout-total">
                    <span>Order total</span>
                    <strong>R${total}</strong>
                </div>
                <button class="checkout-button" id="placeOrderBtn" type="button">
                    Place Order <span>→</span>
                </button>
            </div>
        </section>
    `;

    document.getElementById("backFromCheckout")?.addEventListener("click", openCart);
    document.getElementById("placeOrderBtn")?.addEventListener("click", placeRealOrder);
    document.getElementById("loginFromCheckout")?.addEventListener("click", () => navigate("profile"));
}

async function placeRealOrder() {
    const name = document.getElementById("customerName")?.value.trim();
    const phone = document.getElementById("customerPhone")?.value.trim();
    let notes = document.getElementById("deliveryNotes")?.value.trim() || "";

    // If the customer shared their GPS location, give the vendor a map link
    if (deliveryLocation && deliveryLocation.lat && deliveryLocation.lng) {
        notes += (notes ? "\n" : "")
            + `Map: https://www.google.com/maps?q=${deliveryLocation.lat},${deliveryLocation.lng}`;
    }

    if (!name || !phone) {
        alert("Please enter your name and phone number");
        return;
    }
    if (!cart.length) return;

    const btn = document.getElementById("placeOrderBtn");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Placing order...";
    }

    try {
        // The database works out the real prices and total.
        const { data, error } = await supabaseClient.rpc("place_order", {
            p_restaurant_id: cart[0].restaurantId,
            p_name: name,
            p_phone: phone,
            p_notes: notes,
            p_items: cart.map(i => ({ menu_item_id: i.id, quantity: i.quantity }))
        });

        if (error) throw error;
        showOrderSuccess(data);
    } catch (err) {
        console.error(err);
        alert((err.message || "Something went wrong.") + "\n\nPlease try again.");
        loadCatalog().catch(() => {});   // refresh menus in case something changed
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `Place Order <span>→</span>`;
        }
    }
}

function showOrderSuccess(result) {
    const main = document.querySelector("main");
    if (!main) return;

    currentView = "success";
    const orderId = result && result.id ? String(result.id) : "";
    const shortId = orderId ? orderId.slice(0, 8).toUpperCase() : "";
    const r = cartRestaurant();

    main.innerHTML = `
        <section class="order-success">
            <div class="success-icon">✓</div>
            <span class="section-kicker">ORDER RECEIVED</span>
            <h1>Your food is on the way! 🔥</h1>
            <p>${r ? esc(r.name) + " has" : "The vendor has"} received your order.</p>
            ${shortId ? `<div class="demo-order-number">Order #KM-${esc(shortId)}</div>` : ""}
            ${currentUser
                ? `<button class="primary-action" id="viewMyOrders" type="button">Track my order</button>`
                : `<p class="signed-in-note">Create an account next time to track your orders.</p>`}
            <button class="primary-action ${currentUser ? "secondary-action" : ""}" id="backToHomeAfterOrder" type="button">
                Back to KASI MEALS
            </button>
        </section>
    `;

    cart = [];
    updateCartCount();

    document.getElementById("viewMyOrders")?.addEventListener("click", () => navigate("profile"));
    document.getElementById("backToHomeAfterOrder")?.addEventListener("click", () => navigate("home"));
}

/* =========================================================
   HOME HELPERS
========================================================= */
function restorePreviousView() {
    navigate(returnView || "home");
}

function bindRestaurantCards(root = document) {
    root.querySelectorAll(".restaurant-card").forEach(card => {
        card.addEventListener("click", (e) => {
            if (e.target.closest(".favorite-button")) return;
            openRestaurant(card.dataset.id);
        });
    });
}

function bindCategories() {
    document.querySelectorAll(".category").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".category").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            activeCategory = btn.dataset.category || "all";
            filterRestaurants();
        });
    });
}

function filterRestaurants() {
    const search = document.getElementById("searchInput");
    const query = search ? search.value.trim().toLowerCase() : "";
    let visible = 0;

    document.querySelectorAll("#restaurantGrid .restaurant-card").forEach(card => {
        const text = card.textContent.toLowerCase();
        const category = card.dataset.category;
        const matchSearch = !query || text.includes(query);
        const matchCategory = activeCategory === "all" || category === activeCategory;
        const show = matchSearch && matchCategory;
        card.style.display = show ? "" : "none";
        if (show) visible++;
    });

    const empty = document.getElementById("emptyState");
    if (empty) empty.hidden = visible !== 0 || restaurants.length === 0;

    document.getElementById("clearSearch")?.classList.toggle("visible", query.length > 0);
}

function bindCartButtons() {
    document.querySelectorAll(".cart-button, .cart-nav").forEach(btn => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = "1";
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            openCart();
        });
    });
}

function bindShortcuts() {
    const goCategory = (cat) => {
        const btn = document.querySelector(`.category[data-category="${cat}"]`);
        if (btn) btn.click();
        document.getElementById("restaurantGrid")?.scrollIntoView({ behavior: "smooth" });
    };
    document.getElementById("promoKotas")?.addEventListener("click", () => goCategory("kotas"));
    document.getElementById("featuredMealAction")?.addEventListener("click", () => goCategory("kotas"));
    document.getElementById("seeAllRestaurants")?.addEventListener("click", () => goCategory("all"));
    document.getElementById("clearSearch")?.addEventListener("click", () => {
        const s = document.getElementById("searchInput");
        if (s) { s.value = ""; filterRestaurants(); }
    });

    // "Recommended" cards: find the matching dish in the live menu
    document.querySelectorAll(".recommended-add").forEach(btn => {
        btn.addEventListener("click", () => {
            const card = btn.closest(".recommended-card");
            const matches = allMenuItems.filter(i => i.name === btn.dataset.recommended && i.available);
            const item = matches.find(i => {
                const rn = restaurantById(i.restaurantId)?.name;
                return rn && card.textContent.includes(rn);
            }) || matches[0];

            if (!item) { showToast("Not available right now"); return; }
            addToCart(item);
        });
    });
}

function bindAllEvents() {
    bindRestaurantCards();
    bindCategories();
    bindCartButtons();
    bindShortcuts();

    const search = document.getElementById("searchInput");
    if (search) {
        search.addEventListener("input", filterRestaurants);
    }
}

function fillRestaurantGrid() {
    const grid = document.getElementById("restaurantGrid");
    if (!grid) return;

    if (catalogError) {
        grid.innerHTML = `
            <div class="grid-note">
                <p>Couldn't load restaurants.</p>
                <button class="primary-action" id="retryCatalog" type="button">Try again</button>
            </div>`;
        document.getElementById("retryCatalog")?.addEventListener("click", () => location.reload());
        return;
    }

    grid.innerHTML = restaurants.length
        ? restaurants.map(restaurantCardHTML).join("")
        : `<p class="grid-note">No restaurants yet. Check back soon.</p>`;
}

/* =========================================================
   RESTAURANT CARDS
========================================================= */
function restaurantCardHTML(r) {
    const liked = isFavourite(r.id);
    return `
        <article class="restaurant-card ${r.isOpen ? "" : "is-closed"}" data-id="${esc(r.id)}" data-category="${esc(r.category)}">
            <div class="restaurant-image ${esc(r.imageClass)}">
                <span class="food-emoji">${esc(r.emoji)}</span>
                <button class="favorite-button ${liked ? "liked" : ""}"
                        aria-label="Favourite ${esc(r.name)}"
                        aria-pressed="${liked}"
                        type="button">${liked ? "♥" : "♡"}</button>
                <span class="delivery-badge">${r.isOpen ? esc(r.delivery) : "Closed"}</span>
            </div>
            <div class="restaurant-info">
                <div class="restaurant-title">
                    <h3>${esc(r.name)}</h3>
                    <span class="rating">${esc(r.ratingText)}</span>
                </div>
                <p>${esc(r.type)}</p>
                <div class="restaurant-meta">
                    <span>${esc(r.minOrder)}</span>
                    <span>•</span>
                    <span>${esc(r.fee)}</span>
                </div>
            </div>
        </article>
    `;
}

/* =========================================================
   FAVOURITES
========================================================= */
function isFavourite(id) {
    return favourites.includes(id);
}

function saveFavourites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favourites)); } catch (e) { /* ignore */ }
}

function syncHearts() {
    document.querySelectorAll(".restaurant-card").forEach(card => {
        const btn = card.querySelector(".favorite-button");
        const id = card.dataset.id;
        if (!btn || !id) return;
        const liked = isFavourite(id);
        btn.classList.toggle("liked", liked);
        btn.textContent = liked ? "♥" : "♡";
        btn.setAttribute("aria-pressed", String(liked));
    });
}

function toggleFavourite(id, button) {
    const name = restaurantById(id)?.name || "Restaurant";
    if (isFavourite(id)) {
        favourites = favourites.filter(n => n !== id);
        showToast(`${name} removed from favourites`);
    } else {
        favourites.push(id);
        showToast(`${name} saved to favourites`);
    }
    saveFavourites();

    if (currentView === "favourites") {
        renderFavourites();
        return;
    }

    syncHearts();
    if (button) {
        button.classList.add("pop");
        setTimeout(() => button.classList.remove("pop"), 400);
    }
}

function bindFavouriteClicks() {
    // One delegated listener on <main>, so it survives every re-render.
    document.querySelector("main")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".favorite-button");
        if (!btn) return;
        e.stopPropagation();
        const id = btn.closest(".restaurant-card")?.dataset.id;
        if (id) toggleFavourite(id, btn);
    });
}

function renderFavourites() {
    const main = document.querySelector("main");
    if (!main) return;

    const list = restaurants.filter(r => isFavourite(r.id));

    main.innerHTML = `
        <section class="favourites-view">
            <div class="favourites-header">
                <span class="section-kicker">YOUR SAVED SPOTS</span>
                <h1>Favourites</h1>
                <p>${list.length
                    ? `${list.length} spot${list.length === 1 ? "" : "s"} you love`
                    : "Tap the heart on any restaurant to save it here."}</p>
            </div>

            ${list.length ? `
                <div class="favourites-grid">
                    ${list.map(restaurantCardHTML).join("")}
                </div>
            ` : `
                <div class="favourites-empty">
                    <div class="cart-empty-icon">♡</div>
                    <h2>No favourites yet</h2>
                    <p>Find a kitchen you love and tap the heart. It will show up here.</p>
                    <button class="primary-action" id="browseFromFav" type="button">Browse restaurants</button>
                </div>
            `}
        </section>
    `;

    bindRestaurantCards(main);
    document.getElementById("browseFromFav")?.addEventListener("click", () => navigate("home"));
}

/* =========================================================
   DISCOVER
========================================================= */
const DISCOVER_FILTERS = [
    { id: "all",     label: "All" },
    { id: "top",     label: "⭐ Top rated", test: r => r.rating >= 4.7, sort: (a, b) => b.rating - a.rating },
    { id: "fast",    label: "⚡ Quick",     test: r => r.minutes <= 25, sort: (a, b) => a.minutes - b.minutes },
    { id: "free",    label: "🛵 Free delivery", test: r => r.deliveryFee === 0 },
    { id: "kotas",   label: "🍔 Kotas",     test: r => r.category === "kotas" },
    { id: "meals",   label: "🍛 Kasi Meals", test: r => r.category === "meals" },
    { id: "chicken", label: "🍗 Chicken",   test: r => r.category === "chicken" },
    { id: "braai",   label: "🥩 Braai",     test: r => r.category === "braai" }
];

function allDishes() {
    return allMenuItems
        .filter(i => i.available)
        .map(i => ({ ...i, from: restaurantById(i.restaurantId)?.name || "" }))
        .filter(d => restaurantById(d.restaurantId)?.isOpen);
}

function renderDiscover() {
    const main = document.querySelector("main");
    if (!main) return;

    main.innerHTML = `
        <section class="discover-view">
            <div class="discover-header">
                <span class="section-kicker">DISCOVER</span>
                <h1>Find your next meal</h1>
                <p>Search kitchens and dishes across your kasi.</p>
            </div>

            <div class="search-box discover-search">
                <span>🔍</span>
                <input type="search" id="discoverSearch" placeholder="Try kota, pap, wings…"
                       autocomplete="off" aria-label="Search kitchens and dishes"
                       value="${esc(discoverQuery)}">
                <button class="clear-search" id="discoverClear" aria-label="Clear search" type="button">×</button>
            </div>

            <div class="filter-chips" id="filterChips">
                ${DISCOVER_FILTERS.map(f => `
                    <button class="filter-chip ${f.id === discoverFilter ? "active" : ""}"
                            data-filter="${f.id}" type="button">${f.label}</button>
                `).join("")}
            </div>

            <div id="discoverResults"></div>
        </section>
    `;

    const input = document.getElementById("discoverSearch");
    input.addEventListener("input", () => {
        discoverQuery = input.value;
        updateDiscoverResults();
    });

    document.getElementById("discoverClear").addEventListener("click", () => {
        discoverQuery = "";
        input.value = "";
        updateDiscoverResults();
        input.focus();
    });

    document.getElementById("filterChips").addEventListener("click", (e) => {
        const chip = e.target.closest(".filter-chip");
        if (!chip) return;
        discoverFilter = chip.dataset.filter;
        document.querySelectorAll(".filter-chip").forEach(c =>
            c.classList.toggle("active", c === chip));
        updateDiscoverResults();
    });

    document.getElementById("discoverResults").addEventListener("click", (e) => {
        const btn = e.target.closest(".add-menu-item");
        if (!btn) return;
        const dish = discoverDishes[Number(btn.dataset.dish)];
        if (!dish) return;
        if (addToCart(dish)) {
            btn.textContent = "Added ✓";
            btn.classList.add("added");
            setTimeout(() => {
                btn.textContent = "+ Add";
                btn.classList.remove("added");
            }, 1200);
        }
    });

    updateDiscoverResults();
}

function updateDiscoverResults() {
    const box = document.getElementById("discoverResults");
    if (!box) return;

    const query = discoverQuery.trim().toLowerCase();
    const filter = DISCOVER_FILTERS.find(f => f.id === discoverFilter) || DISCOVER_FILTERS[0];

    document.getElementById("discoverClear")?.classList.toggle("visible", query.length > 0);

    let places = restaurants.filter(r => {
        const matchesQuery = !query ||
            `${r.name} ${r.type} ${r.category}`.toLowerCase().includes(query);
        const matchesFilter = !filter.test || filter.test(r);
        return matchesQuery && matchesFilter;
    });
    if (filter.sort) places = [...places].sort(filter.sort);

    const allowed = new Set(places.map(r => r.id));
    const limit = (query || filter.test) ? Infinity : 8;
    discoverDishes = allDishes()
        .filter(d => {
            const matchesQuery = !query ||
                `${d.name} ${d.description} ${d.from}`.toLowerCase().includes(query);
            const matchesFilter = !filter.test || allowed.has(d.restaurantId);
            return matchesQuery && matchesFilter;
        })
        .slice(0, limit);

    if (!places.length && !discoverDishes.length) {
        box.innerHTML = `
            <div class="empty-state">
                <div>😕</div>
                <h3>Nothing found</h3>
                <p>Try another dish, kitchen or filter.</p>
            </div>
        `;
        return;
    }

    box.innerHTML = `
        ${places.length ? `
            <div class="discover-block">
                <div class="menu-heading">
                    <span class="section-kicker">KITCHENS</span>
                    <h2>${places.length} spot${places.length === 1 ? "" : "s"} for you</h2>
                </div>
                <div class="restaurant-grid">
                    ${places.map(restaurantCardHTML).join("")}
                </div>
            </div>
        ` : ""}

        ${discoverDishes.length ? `
            <div class="discover-block">
                <div class="menu-heading">
                    <span class="section-kicker">DISHES</span>
                    <h2>${query || filter.test ? "Matching dishes" : "Popular dishes"}</h2>
                </div>
                <div class="menu-list">
                    ${discoverDishes.map((d, i) => `
                        <article class="menu-item">
                            <div class="menu-item-food">${esc(d.emoji)}</div>
                            <div class="menu-item-info">
                                <h3>${esc(d.name)}</h3>
                                <p>${esc(d.description)}</p>
                                ${d.from ? `<small class="dish-from">from ${esc(d.from)}</small>` : ""}
                                <strong>R${d.price}</strong>
                            </div>
                            <button class="add-menu-item" data-dish="${i}" type="button">+ Add</button>
                        </article>
                    `).join("")}
                </div>
            </div>
        ` : ""}
    `;

    bindRestaurantCards(box);
}

/* =========================================================
   PROFILE: sign in / sign up / my details / order history
========================================================= */
function renderProfile() {
    const main = document.querySelector("main");
    if (!main) return;

    currentView = "profile";
    setActiveNav("profile");

    if (!currentUser) renderAuthForm(main);
    else renderAccount(main);
}

function renderAuthForm(main) {
    const signup = authMode === "signup";

    main.innerHTML = `
        <section class="profile-view">
            <div class="profile-header">
                <span class="section-kicker">YOUR ACCOUNT</span>
                <h1>${signup ? "Join Kasi Meals" : "Welcome back"}</h1>
                <p>Save your details and track every order.</p>
            </div>

            <div class="profile-card">
                <div class="auth-tabs">
                    <button type="button" data-mode="login" class="${signup ? "" : "active"}">Log in</button>
                    <button type="button" data-mode="signup" class="${signup ? "active" : ""}">Create account</button>
                </div>

                <form id="authForm" class="checkout-form">
                    ${signup ? `
                        <label>
                            <span>Your name</span>
                            <input type="text" id="authName" autocomplete="name" placeholder="e.g. Thabo" required>
                        </label>
                        <label>
                            <span>Phone number</span>
                            <input type="tel" id="authPhone" autocomplete="tel" placeholder="e.g. 082 123 4567" required>
                        </label>
                    ` : ""}
                    <label>
                        <span>Email</span>
                        <input type="email" id="authEmail" autocomplete="email" required>
                    </label>
                    <label>
                        <span>Password</span>
                        <input type="password" id="authPassword" minlength="6"
                               autocomplete="${signup ? "new-password" : "current-password"}" required
                               placeholder="${signup ? "At least 6 characters" : ""}">
                    </label>
                    <button class="checkout-button" id="authSubmit" type="submit">
                        ${signup ? "Create account" : "Log in"} <span>→</span>
                    </button>
                    <p class="auth-message" id="authMessage" role="alert" hidden></p>
                </form>
            </div>
            <p class="signed-in-note center-note">Own a restaurant? <a class="link-button" href="apply.html">List it on Kasi Meals</a></p>
        </section>
    `;

    main.querySelectorAll(".auth-tabs button").forEach(btn => {
        btn.addEventListener("click", () => {
            authMode = btn.dataset.mode;
            renderAuthForm(main);
        });
    });

    document.getElementById("authForm").addEventListener("submit", handleAuthSubmit);
}

// 'admin' | 'vendor' | 'customer'  (decided by the database)
async function getRole() {
    try {
        const { data, error } = await supabaseClient.rpc("my_role");
        return error || !data ? "customer" : data;
    } catch (e) {
        return "customer";
    }
}

function staffPage(role) {
    return role === "admin" ? "admin.html" : role === "vendor" ? "vendor.html" : null;
}

function setAuthMessage(text, ok = false) {
    const el = document.getElementById("authMessage");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("ok", ok);
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthMessage("");

    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const btn = document.getElementById("authSubmit");
    btn.disabled = true;

    try {
        if (authMode === "signup") {
            const full_name = document.getElementById("authName").value.trim();
            const phone = document.getElementById("authPhone").value.trim();

            const { data, error } = await supabaseClient.auth.signUp({
                email, password, options: { data: { full_name, phone } }
            });
            if (error) throw error;

            if (data.session) {
                currentUser = data.user;
                showToast("Account created");
                renderProfile();
            } else {
                authMode = "login";
                renderAuthForm(document.querySelector("main"));
                setAuthMessage("Account created. Check your email to confirm it, then log in.", true);
            }
        } else {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            currentUser = data.user;

            // Staff (vendors / admins) go straight to their own dashboard
            const page = staffPage(await getRole());
            if (page) {
                showToast("Opening your dashboard…");
                setTimeout(() => { window.location.href = page; }, 400);
                return;
            }

            showToast("Logged in");
            renderProfile();
        }
    } catch (err) {
        setAuthMessage(err.message || "Something went wrong. Please try again.");
        btn.disabled = false;
    }
}

function renderAccount(main) {
    const meta = currentUser.user_metadata || {};
    const name = meta.full_name || "";

    main.innerHTML = `
        <section class="profile-view">
            <div class="profile-header">
                <span class="section-kicker">YOUR ACCOUNT</span>
                <h1>Hi${name ? ", " + esc(name.split(" ")[0]) : ""} 👋</h1>
                <p>${esc(currentUser.email)}</p>
            </div>

            <div class="profile-card">
                <h2>My details</h2>
                <form id="detailsForm" class="checkout-form">
                    <label>
                        <span>Name</span>
                        <input type="text" id="detName" value="${esc(name)}" autocomplete="name">
                    </label>
                    <label>
                        <span>Phone number</span>
                        <input type="tel" id="detPhone" value="${esc(meta.phone || "")}" autocomplete="tel">
                    </label>
                    <button class="checkout-button" type="submit">Save details <span>→</span></button>
                    <p class="auth-message" id="detailsMsg" hidden></p>
                </form>
            </div>

            <div class="history-head">
                <h2>My orders</h2>
                <button class="see-all" id="refreshHistory" type="button">↻ Refresh</button>
            </div>
            <div id="historyList"><p class="grid-note">Loading your orders…</p></div>

            <p class="signed-in-note center-note">Own a restaurant? <a class="link-button" href="apply.html">List it on Kasi Meals</a></p>

            <button class="primary-action signout-button" id="signOutBtn" type="button">Log out</button>
        </section>
    `;

    document.getElementById("detailsForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = document.getElementById("detailsMsg");
        const { data, error } = await supabaseClient.auth.updateUser({
            data: {
                full_name: document.getElementById("detName").value.trim(),
                phone: document.getElementById("detPhone").value.trim()
            }
        });
        msg.hidden = false;
        if (error) {
            msg.textContent = error.message;
            msg.classList.remove("ok");
        } else {
            currentUser = data.user;
            msg.textContent = "Saved ✓";
            msg.classList.add("ok");
        }
    });

    document.getElementById("refreshHistory").addEventListener("click", refreshHistory);

    document.getElementById("signOutBtn").addEventListener("click", async () => {
        await supabaseClient.auth.signOut();
        currentUser = null;
        historyOrders = [];
        historyItems = {};
        showToast("Logged out");
        renderProfile();
    });

    document.getElementById("historyList").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-reorder]");
        if (btn) reorder(btn.dataset.reorder);
    });

    refreshHistory();
}

async function refreshHistory() {
    const box = document.getElementById("historyList");
    if (!box || !currentUser) return;

    const { data, error } = await supabaseClient
        .from("orders")
        .select("*")
        .eq("customer_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(30);

    if (!document.getElementById("historyList")) return;   // left the page meanwhile

    if (error) {
        box.innerHTML = `<p class="grid-note">Couldn't load your orders: ${esc(error.message)}</p>`;
        return;
    }

    historyOrders = data || [];
    historyItems = {};

    if (historyOrders.length) {
        const { data: items } = await supabaseClient
            .from("order_items").select("*").in("order_id", historyOrders.map(o => o.id));
        (items || []).forEach(it => { (historyItems[it.order_id] ||= []).push(it); });
    }

    renderHistory();
}

function renderHistory() {
    const box = document.getElementById("historyList");
    if (!box) return;

    if (!historyOrders.length) {
        box.innerHTML = `
            <div class="favourites-empty">
                <div class="cart-empty-icon">🧾</div>
                <h2>No orders yet</h2>
                <p>Your orders will show up here once you place one.</p>
                <button class="primary-action" id="startFromHistory" type="button">Browse restaurants</button>
            </div>`;
        document.getElementById("startFromHistory")?.addEventListener("click", () => navigate("home"));
        return;
    }

    box.innerHTML = historyOrders.map(o => {
        const r = restaurantById(o.restaurant_id);
        const items = historyItems[o.id] || [];
        const when = o.created_at
            ? new Date(o.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : "";
        return `
            <article class="history-card">
                <div class="history-top">
                    <div>
                        <strong>${esc(r ? r.name : "Restaurant")}</strong>
                        <small>#KM-${esc(String(o.id).slice(0, 8).toUpperCase())} • ${esc(when)}</small>
                    </div>
                    <span class="status-pill ${esc(o.status)}">${esc(STATUS_LABELS[o.status] || o.status)}</span>
                </div>
                <ul class="history-items">
                    ${items.map(it => `<li><span>${esc(it.quantity)} × ${esc(it.item_name)}</span><span>R${esc(Number(it.unit_price) * Number(it.quantity))}</span></li>`).join("")}
                    ${Number(o.delivery_fee) > 0 ? `<li><span>Delivery</span><span>R${esc(o.delivery_fee)}</span></li>` : ""}
                </ul>
                <div class="history-bottom">
                    <strong>Total R${esc(o.total_amount)}</strong>
                    ${items.some(it => it.menu_item_id) ? `<button class="reorder-button" data-reorder="${esc(o.id)}" type="button">Order again</button>` : ""}
                </div>
            </article>
        `;
    }).join("");
}

function reorder(orderId) {
    const items = historyItems[orderId] || [];
    let added = 0;
    let missing = 0;

    for (const it of items) {
        const menuItem = allMenuItems.find(m => m.id === it.menu_item_id && m.available);
        if (!menuItem) { missing++; continue; }
        if (!addToCart(menuItem, Number(it.quantity) || 1)) return;   // user cancelled / closed
        added++;
    }

    if (!added) { showToast("Those items aren't available right now"); return; }
    if (missing) showToast(`${missing} item(s) are no longer available`);
    openCart();
}

/* =========================================================
   DELIVERY LOCATION
========================================================= */
function updateLocationChip() {
    const el = document.getElementById("deliveryLocation");
    if (el) el.textContent = (deliveryLocation && deliveryLocation.label) || "Set your location";
}

function saveLocation(loc) {
    deliveryLocation = loc;
    try {
        if (loc) localStorage.setItem(LOC_KEY, JSON.stringify(loc));
        else localStorage.removeItem(LOC_KEY);
    } catch (e) { /* ignore */ }
    updateLocationChip();
}

// Turns GPS coordinates into a readable place using OpenStreetMap's free Nominatim service
async function reverseGeocode(lat, lng) {
    const url = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=17&accept-language=en"
        + `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Lookup failed");
    const d = await res.json();
    const a = d.address || {};
    const area = a.suburb || a.neighbourhood || a.quarter || a.village || a.hamlet || a.city_district || "";
    const city = a.city || a.town || a.municipality || a.county || "";
    const label = [area, city].filter((v, i, arr) => v && arr.indexOf(v) === i).join(", ")
        || String(d.display_name || "").split(",").slice(0, 2).join(",").trim();
    return { label: label || "Current location", address: d.display_name || label || "" };
}

function closeLocationSheet() {
    document.getElementById("locationSheet")?.remove();
    document.removeEventListener("keydown", onSheetKey);
}

function onSheetKey(e) {
    if (e.key === "Escape") closeLocationSheet();
}

function openLocationSheet() {
    closeLocationSheet();

    const wrap = document.createElement("div");
    wrap.className = "sheet-overlay";
    wrap.id = "locationSheet";
    wrap.innerHTML = `
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Choose delivery location">
            <div class="sheet-handle"></div>
            <div class="sheet-head">
                <h2>Where should we deliver?</h2>
                <button class="sheet-close" id="sheetClose" aria-label="Close" type="button">×</button>
            </div>

            <button class="sheet-primary" id="useGps" type="button">📍 Use my current location</button>
            <p class="sheet-or">or type it in</p>

            <form id="manualLocation" class="sheet-form">
                <input type="text" id="manualInput" maxlength="80" autocomplete="street-address"
                       placeholder="Suburb, town or street address"
                       value="${esc(deliveryLocation && !deliveryLocation.lat ? deliveryLocation.label : "")}">
                <button class="sheet-save" type="submit">Save</button>
            </form>

            <p class="sheet-msg" id="sheetMsg" role="status" hidden></p>
            <p class="sheet-note">Your exact location is only shared with the restaurant when you place an order.</p>
            ${deliveryLocation ? `<button class="link-button" id="clearLocation" type="button">Remove saved location</button>` : ""}
        </div>
    `;
    document.body.appendChild(wrap);
    document.addEventListener("keydown", onSheetKey);

    const msg = (text, isError = false) => {
        const el = document.getElementById("sheetMsg");
        if (!el) return;
        el.textContent = text || "";
        el.hidden = !text;
        el.classList.toggle("error", isError);
    };

    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeLocationSheet(); });
    document.getElementById("sheetClose").addEventListener("click", closeLocationSheet);

    document.getElementById("clearLocation")?.addEventListener("click", () => {
        saveLocation(null);
        closeLocationSheet();
        showToast("Location removed");
    });

    document.getElementById("manualLocation").addEventListener("submit", (e) => {
        e.preventDefault();
        const text = document.getElementById("manualInput").value.trim();
        if (!text) { msg("Please type your area or address.", true); return; }
        saveLocation({ label: text, address: text, lat: null, lng: null });
        closeLocationSheet();
        showToast("Delivering to " + text);
    });

    document.getElementById("useGps").addEventListener("click", () => {
        const btn = document.getElementById("useGps");
        if (!navigator.geolocation) {
            msg("Your browser can't share your location. Please type it in instead.", true);
            return;
        }
        btn.disabled = true;
        msg("Finding you…");

        navigator.geolocation.getCurrentPosition(async (pos) => {
            const lat = Math.round(pos.coords.latitude * 1e5) / 1e5;
            const lng = Math.round(pos.coords.longitude * 1e5) / 1e5;
            let info = { label: "Current location", address: "" };
            try { info = await reverseGeocode(lat, lng); } catch (e) { /* keep the coordinates anyway */ }

            saveLocation({ label: info.label, address: info.address, lat, lng });
            closeLocationSheet();
            showToast("Delivering to " + info.label);
        }, (err) => {
            btn.disabled = false;
            msg(err && err.code === 1
                ? "Location is blocked for this site. Allow it in your browser settings, or type your area instead."
                : "Couldn't get your location. Please try again or type it in.", true);
        }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
    });

    document.getElementById("manualInput").focus();
}

function bindLocation() {
    // delegated, so it works after every re-render of the home page
    document.querySelector("main")?.addEventListener("click", (e) => {
        if (e.target.closest("#locationButton")) openLocationSheet();
    });
}

/* =========================================================
   NAVIGATION
========================================================= */
function rememberReturnView() {
    if (["home", "discover", "favourites", "profile"].includes(currentView)) {
        returnView = currentView;
    }
}

function setActiveNav(view) {
    document.querySelectorAll(".bottom-nav .nav-item").forEach(btn => {
        const isCart = btn.classList.contains("cart-nav");
        btn.classList.toggle("active", isCart ? view === "cart" : btn.dataset.nav === view);
    });
}

function renderHome() {
    const main = document.querySelector("main");
    if (!main) return;
    main.innerHTML = homeHTML;
    updateLocationChip();
    fillRestaurantGrid();
    activeCategory = "all";
    bindAllEvents();
    filterRestaurants();
    syncHearts();
}

function navigate(view) {
    currentView = view;
    setActiveNav(view);

    if (view === "home") renderHome();
    else if (view === "discover") renderDiscover();
    else if (view === "favourites") renderFavourites();
    else if (view === "profile") renderProfile();
    else if (view === "cart") openCart();

    window.scrollTo({ top: 0 });
}

function bindBottomNav() {
    document.querySelectorAll(".bottom-nav .nav-item[data-nav]").forEach(btn => {
        btn.addEventListener("click", () => navigate(btn.dataset.nav));
    });
    document.querySelector(".profile-button")?.addEventListener("click", () => navigate("profile"));
}

/* =========================================================
   INIT
========================================================= */
async function init() {
    const main = document.querySelector("main");
    homeHTML = main.innerHTML;     // keep a clean copy of the home page

    const grid = document.getElementById("restaurantGrid");
    if (grid) grid.innerHTML = `<p class="grid-note">Loading restaurants…</p>`;

    bindFavouriteClicks();
    bindLocation();
    updateLocationChip();
    bindBottomNav();
    bindCartButtons();
    bindCategories();
    bindShortcuts();
    document.getElementById("searchInput")?.addEventListener("input", filterRestaurants);

    // Who is logged in?
    try {
        const { data } = await supabaseClient.auth.getSession();
        currentUser = data.session ? data.session.user : null;
    } catch (e) { currentUser = null; }

    // Vendor and admin accounts are staff only: they never see the customer side.
    if (currentUser) {
        main.style.visibility = "hidden";          // avoid a flash of customer content
        const page = staffPage(await getRole());
        if (page) {
            window.location.replace(page);
            return;
        }
        main.style.visibility = "";
    }

    supabaseClient.auth.onAuthStateChange((_event, session) => {
        currentUser = session ? session.user : null;
        // setTimeout avoids calling Supabase from inside its own callback
        setTimeout(() => { if (currentView === "profile") renderProfile(); }, 0);
    });

    // Restaurants + menus
    try {
        await loadCatalog();
        catalogError = "";
    } catch (e) {
        console.error(e);
        catalogError = e.message || "failed";
    }

    if (currentView === "home") {
        fillRestaurantGrid();
        bindRestaurantCards();
        filterRestaurants();
        syncHearts();
    }

    if (currentView === "discover") renderDiscover();
    else if (currentView === "favourites") renderFavourites();

    updateCartCount();

    // keep order statuses fresh while the customer is looking at them
    setInterval(() => {
        if (currentView === "profile" && currentUser) refreshHistory();
    }, 30000);

    console.log("Kasi Meals v9 ready (accounts + vendor menus)");
}

init();

