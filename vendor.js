/* =========================================================
   KASI MEALS — Vendor dashboard (v5)
   A vendor logs in, sees only the restaurant(s) they own in
   public.restaurant_owners, and can manage orders, menu and
   restaurant details. Security is enforced by the database.
========================================================= */

const SUPABASE_URL = "https://yrcoiwybsjhrmxaswocz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyY29pd3lic2pocm14YXN3b2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NzU2ODYsImV4cCI6MjEwNzI1MTY4Nn0.Jw--tFIC4PuPB0vdJaZCn4UjLwb4BLHFtufC6FE2wq8";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const POLL_MS = 15000;
const EMOJIS = ["🍔","🌭","🍟","🍗","🥩","🍛","🥘","🍖","🥪","🍕","🥤","🧃","🍰","🍽️"];

const STATUSES = [
    { id: "placed",     label: "New",        next: "preparing",  nextLabel: "Start preparing" },
    { id: "preparing",  label: "Preparing",  next: "on_the_way", nextLabel: "Out for delivery" },
    { id: "on_the_way", label: "On the way", next: "delivered",  nextLabel: "Mark delivered" },
    { id: "delivered",  label: "Done" },
    { id: "cancelled",  label: "Cancelled" }
];

let myRestaurants = [];
let restaurant = null;          // the one currently selected
let section = "orders";

let orders = [];
let itemsByOrder = {};
let menuItems = [];
let editingId = null;

let activeTab = "placed";
let knownIds = new Set();
let firstLoad = true;
let pollTimer = null;
let soundOn = true;

const $ = (id) => document.getElementById(id);

function esc(t) {
    return String(t ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function setText(id, msg) {
    const el = $(id);
    el.textContent = msg || "";
    el.hidden = !msg;
}

/* ---------- views ---------- */

function show(view) {
    $("loginView").hidden = view !== "login";
    $("appView").hidden = view !== "app";
    $("vendorActions").hidden = view !== "app";
    if (view !== "app") $("restaurantLabel").textContent = "Vendor";
}

function showSection(name) {
    section = name;
    $("ordersPanel").hidden = name !== "orders";
    $("menuPanel").hidden = name !== "menu";
    $("settingsPanel").hidden = name !== "settings";
    document.querySelectorAll(".section-tab").forEach(t =>
        t.classList.toggle("active", t.dataset.section === name));

    if (name === "menu") loadMenu();
    if (name === "settings") fillSettings();
    if (name === "orders") loadOrders();
}

/* ---------- auth + loading my restaurants ---------- */

async function loadMyRestaurants() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return { ok: false };

    // Admins have their own dashboard
    const { data: role } = await db.rpc("my_role");
    if (role === "admin") {
        window.location.replace("admin.html");
        return { ok: false, redirected: true };
    }

    const { data: links, error } = await db.from("restaurant_owners").select("restaurant_id");
    if (error) return { ok: false, message: "Could not verify your account: " + error.message };

    if (!links || !links.length) {
        // Maybe they applied and are waiting for approval
        const { data: apps } = await db.from("restaurant_applications")
            .select("status, admin_note").order("created_at", { ascending: false }).limit(1);
        const a = apps && apps[0];
        let message = "This account is not linked to a restaurant yet. You can apply on the \"List your restaurant\" page.";
        if (a && a.status === "pending") {
            message = "Your restaurant application is waiting for admin approval. You'll be able to log in here as soon as it's approved.";
        } else if (a && a.status === "rejected") {
            message = "Your restaurant application was not approved." + (a.admin_note ? " Note: " + a.admin_note : "");
        }
        return { ok: false, message };
    }

    const { data: rows, error: rError } = await db
        .from("restaurants").select("*").in("id", links.map(l => l.restaurant_id)).order("name");
    if (rError || !rows || !rows.length) {
        return { ok: false, message: "Could not load your restaurant: " + (rError ? rError.message : "none found") };
    }

    myRestaurants = rows;
    return { ok: true };
}

async function startSession() {
    const result = await loadMyRestaurants();
    if (result.redirected) return;
    if (!result.ok) {
        if (result.message) {
            await db.auth.signOut();
            setText("loginError", result.message);
        }
        stopSession();
        show("login");
        return;
    }

    const saved = localStorage.getItem("kasi-vendor-restaurant");
    restaurant = myRestaurants.find(r => r.id === saved) || myRestaurants[0];
    buildRestaurantSelect();
    show("app");
    showSection("orders");

    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (section === "orders") loadOrders(); }, POLL_MS);
}

function stopSession() {
    clearInterval(pollTimer);
    myRestaurants = [];
    restaurant = null;
    orders = [];
    itemsByOrder = {};
    menuItems = [];
    knownIds = new Set();
    firstLoad = true;
}

function buildRestaurantSelect() {
    const sel = $("restaurantSelect");
    $("restaurantLabel").textContent = restaurant.name;
    sel.hidden = myRestaurants.length < 2;
    sel.innerHTML = myRestaurants.map(r =>
        `<option value="${esc(r.id)}" ${r.id === restaurant.id ? "selected" : ""}>${esc(r.name)}</option>`
    ).join("");
}

$("restaurantSelect").addEventListener("change", (e) => {
    restaurant = myRestaurants.find(r => r.id === e.target.value) || restaurant;
    localStorage.setItem("kasi-vendor-restaurant", restaurant.id);
    $("restaurantLabel").textContent = restaurant.name;
    orders = []; itemsByOrder = {}; menuItems = [];
    knownIds = new Set(); firstLoad = true;
    closeItemForm();
    showSection(section);
});

$("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setText("loginError", "");
    const btn = $("loginBtn");
    btn.disabled = true;

    const { error } = await db.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
    });

    btn.disabled = false;
    if (error) { setText("loginError", error.message); return; }
    $("password").value = "";
    startSession();
});

$("logoutBtn").addEventListener("click", async () => {
    await db.auth.signOut();
    stopSession();
    show("login");
});

$("refreshBtn").addEventListener("click", () => {
    if (section === "orders") loadOrders();
    else if (section === "menu") loadMenu();
    else fillSettings();
});

$("soundToggle").addEventListener("click", () => {
    soundOn = !soundOn;
    $("soundToggle").textContent = soundOn ? "🔔 Sound on" : "🔕 Sound off";
    $("soundToggle").setAttribute("aria-pressed", String(soundOn));
    if (soundOn) beep();
});

$("sectionTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".section-tab");
    if (tab) showSection(tab.dataset.section);
});

/* =========================================================
   ORDERS
========================================================= */

async function loadOrders() {
    if (!restaurant) return;
    const rid = restaurant.id;

    const { data, error } = await db
        .from("orders")
        .select("*")
        .eq("restaurant_id", rid)
        .order("created_at", { ascending: false })
        .limit(200);

    if (rid !== restaurant.id) return; // vendor switched restaurant meanwhile

    if (error) {
        setText("globalError", "Could not load orders: " + error.message);
        return;
    }
    setText("globalError", "");

    orders = data || [];
    const ids = orders.map(o => o.id);
    itemsByOrder = {};

    if (ids.length) {
        const { data: items, error: itemsError } = await db
            .from("order_items").select("*").in("order_id", ids);
        if (itemsError) {
            setText("globalError", "Could not load order items: " + itemsError.message);
        } else {
            (items || []).forEach(it => { (itemsByOrder[it.order_id] ||= []).push(it); });
        }
    }

    const fresh = orders.filter(o => !knownIds.has(o.id) && o.status === "placed");
    if (!firstLoad && fresh.length) {
        beep();
        activeTab = "placed";
    }
    knownIds = new Set(ids);
    firstLoad = false;

    $("lastUpdated").textContent = "Updated " +
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    renderOrders(fresh.map(o => o.id));
}

async function setStatus(orderId, status, button) {
    if (button) button.disabled = true;
    const { error } = await db.from("orders").update({ status }).eq("id", orderId);
    if (error) {
        alert("Could not update the order: " + error.message);
        if (button) button.disabled = false;
        return;
    }
    const order = orders.find(o => o.id === orderId);
    if (order) order.status = status;
    renderOrders();
}

function renderOrders(newIds = []) {
    const counts = {};
    STATUSES.forEach(s => counts[s.id] = orders.filter(o => o.status === s.id).length);

    $("statusTabs").innerHTML = STATUSES.map(s => `
        <button class="filter-chip ${s.id === activeTab ? "active" : ""}" data-tab="${s.id}" type="button">
            ${s.label}<span class="tab-count">${counts[s.id]}</span>
        </button>
    `).join("");

    const list = orders.filter(o => o.status === activeTab);
    if (!list.length) {
        $("ordersList").innerHTML = `
            <div class="vendor-empty"><div>🍽️</div><p>No ${esc(STATUSES.find(s => s.id === activeTab).label.toLowerCase())} orders right now.</p></div>`;
        return;
    }
    $("ordersList").innerHTML = list.map(o => orderCard(o, newIds.includes(o.id))).join("");
}

function orderCard(o, isNew) {
    const status = STATUSES.find(s => s.id === o.status);
    const items = itemsByOrder[o.id] || [];
    const shortId = String(o.id).slice(0, 8).toUpperCase();
    const time = o.created_at
        ? new Date(o.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })
        : "";
    const phoneDigits = String(o.customer_phone || "").replace(/[^\d+]/g, "");
    const waNumber = phoneDigits.replace(/^\+/, "").replace(/^0/, "27");

    return `
        <article class="order-card ${isNew ? "is-new" : ""}">
            <div class="order-top">
                <div>
                    <div class="order-id">#KM-${esc(shortId)}</div>
                    <div class="order-time">${esc(time)}</div>
                </div>
                <span class="status-pill ${esc(o.status)}">${esc(status ? status.label : o.status)}</span>
            </div>

            <div class="order-customer">
                <strong>${esc(o.customer_name)}</strong><br>
                <a href="tel:${esc(phoneDigits)}">📞 ${esc(o.customer_phone)}</a>
                <a href="https://wa.me/${esc(waNumber)}" target="_blank" rel="noopener">💬 WhatsApp</a>
            </div>

            ${o.delivery_notes ? `<div class="order-notes">📍 ${esc(o.delivery_notes)}</div>` : ""}

            <ul class="order-items">
                ${items.length ? items.map(it => `
                    <li>
                        <span>${esc(it.quantity)} × ${esc(it.item_name)}</span>
                        <span>R${esc(Number(it.unit_price) * Number(it.quantity))}</span>
                    </li>`).join("") : `<li><span>No items found</span></li>`}
                ${Number(o.delivery_fee) > 0 ? `<li><span>Delivery</span><span>R${esc(o.delivery_fee)}</span></li>` : ""}
            </ul>

            <div class="order-total"><span>Total</span><span>R${esc(o.total_amount)}</span></div>

            <div class="order-actions">
                ${status && status.next ? `
                    <button data-action="advance" data-id="${esc(o.id)}" data-status="${esc(status.next)}" type="button">${esc(status.nextLabel)}</button>` : ""}
                ${o.status !== "delivered" && o.status !== "cancelled" ? `
                    <button class="secondary" data-action="cancel" data-id="${esc(o.id)}" type="button">Cancel</button>` : ""}
            </div>
        </article>
    `;
}

$("statusTabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (!tab) return;
    activeTab = tab.dataset.tab;
    renderOrders();
});

$("ordersList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "cancel") {
        if (!confirm("Cancel this order?")) return;
        setStatus(btn.dataset.id, "cancelled", btn);
    } else {
        setStatus(btn.dataset.id, btn.dataset.status, btn);
    }
});

/* =========================================================
   MENU MANAGER
========================================================= */

async function loadMenu() {
    if (!restaurant) return;
    const rid = restaurant.id;

    const { data, error } = await db
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", rid)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

    if (rid !== restaurant.id) return;
    if (error) {
        setText("globalError", "Could not load your menu: " + error.message);
        return;
    }
    setText("globalError", "");
    menuItems = data || [];
    renderMenu();
}

function renderMenu() {
    if (!menuItems.length) {
        $("menuList").innerHTML = `
            <div class="vendor-empty"><div>🍽️</div><p>Your menu is empty. Tap "+ Add item" to start.</p></div>`;
        return;
    }
    $("menuList").innerHTML = menuItems.map(m => `
        <article class="menu-row ${m.is_available ? "" : "is-off"}">
            <div class="m-emoji">${esc(m.emoji)}</div>
            <div>
                <h3>${esc(m.name)}${m.is_available ? "" : '<span class="m-tag">Sold out</span>'}</h3>
                ${m.description ? `<p>${esc(m.description)}</p>` : ""}
                <div class="m-price">R${esc(m.price)}</div>
            </div>
            <div class="menu-actions">
                <button data-menu="edit" data-id="${esc(m.id)}" type="button">✏️ Edit</button>
                <button data-menu="toggle" data-id="${esc(m.id)}" type="button">${m.is_available ? "Mark sold out" : "Mark available"}</button>
                <button class="danger" data-menu="delete" data-id="${esc(m.id)}" type="button">🗑 Delete</button>
            </div>
        </article>
    `).join("");
}

function openItemForm(item) {
    editingId = item ? item.id : null;
    $("itemFormTitle").textContent = item ? "Edit menu item" : "Add menu item";
    $("itemEmoji").value = item ? item.emoji : "🍽️";
    $("itemName").value = item ? item.name : "";
    $("itemDescription").value = item ? item.description : "";
    $("itemPrice").value = item ? item.price : "";
    $("itemAvailable").checked = item ? item.is_available : true;
    setText("itemError", "");
    $("itemForm").hidden = false;
    $("itemForm").scrollIntoView({ behavior: "smooth", block: "start" });
    $("itemName").focus();
}

function closeItemForm() {
    editingId = null;
    $("itemForm").hidden = true;
}

$("emojiPicker").innerHTML = EMOJIS.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join("");
$("emojiPicker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-emoji]");
    if (b) $("itemEmoji").value = b.dataset.emoji;
});

$("addItemBtn").addEventListener("click", () => openItemForm(null));
$("itemCancelBtn").addEventListener("click", closeItemForm);

$("itemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setText("itemError", "");

    const name = $("itemName").value.trim();
    const price = Math.round(Number($("itemPrice").value));
    if (!name) { setText("itemError", "Please enter a name."); return; }
    if (!Number.isFinite(price) || price < 0) { setText("itemError", "Please enter a valid price."); return; }

    const payload = {
        name,
        description: $("itemDescription").value.trim(),
        price,
        emoji: $("itemEmoji").value.trim() || "🍽️",
        is_available: $("itemAvailable").checked
    };

    const btn = $("itemSaveBtn");
    btn.disabled = true;

    let error;
    if (editingId) {
        ({ error } = await db.from("menu_items").update(payload).eq("id", editingId));
    } else {
        const nextOrder = menuItems.reduce((max, m) => Math.max(max, m.sort_order || 0), 0) + 1;
        ({ error } = await db.from("menu_items").insert({
            ...payload, restaurant_id: restaurant.id, sort_order: nextOrder
        }));
    }

    btn.disabled = false;
    if (error) { setText("itemError", "Could not save: " + error.message); return; }

    closeItemForm();
    await loadMenu();
});

$("menuList").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-menu]");
    if (!btn) return;
    const item = menuItems.find(m => m.id === btn.dataset.id);
    if (!item) return;

    if (btn.dataset.menu === "edit") {
        openItemForm(item);
    } else if (btn.dataset.menu === "toggle") {
        btn.disabled = true;
        const { error } = await db.from("menu_items")
            .update({ is_available: !item.is_available }).eq("id", item.id);
        if (error) { alert("Could not update: " + error.message); btn.disabled = false; return; }
        await loadMenu();
    } else if (btn.dataset.menu === "delete") {
        if (!confirm(`Delete "${item.name}" from your menu?`)) return;
        btn.disabled = true;
        const { error } = await db.from("menu_items").delete().eq("id", item.id);
        if (error) { alert("Could not delete: " + error.message); btn.disabled = false; return; }
        await loadMenu();
    }
});

/* =========================================================
   RESTAURANT SETTINGS
========================================================= */

function fillSettings() {
    if (!restaurant) return;
    $("setName").value = restaurant.name;
    $("setType").value = restaurant.type || "";
    $("setTime").value = restaurant.delivery_time || "";
    $("setMin").value = restaurant.min_order;
    $("setFee").value = restaurant.delivery_fee;
    $("setFree").value = restaurant.free_delivery_over;
    $("openToggle").checked = !!restaurant.is_open;
    $("openLabel").textContent = restaurant.is_open ? "Open for orders" : "Closed";
    setText("settingsError", "");
    $("settingsOk").hidden = true;
}

$("openToggle").addEventListener("change", async (e) => {
    const isOpen = e.target.checked;
    const { error } = await db.from("restaurants").update({ is_open: isOpen }).eq("id", restaurant.id);
    if (error) {
        e.target.checked = !isOpen;
        alert("Could not update: " + error.message);
        return;
    }
    restaurant.is_open = isOpen;
    $("openLabel").textContent = isOpen ? "Open for orders" : "Closed";
});

$("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setText("settingsError", "");
    $("settingsOk").hidden = true;

    const num = (id) => Math.max(0, Math.round(Number($(id).value) || 0));
    const payload = {
        name: $("setName").value.trim(),
        type: $("setType").value.trim(),
        delivery_time: $("setTime").value.trim() || "20–30 min",
        min_order: num("setMin"),
        delivery_fee: num("setFee"),
        free_delivery_over: num("setFree")
    };
    if (!payload.name) { setText("settingsError", "Please enter a restaurant name."); return; }

    const { error } = await db.from("restaurants").update(payload).eq("id", restaurant.id);
    if (error) { setText("settingsError", "Could not save: " + error.message); return; }

    Object.assign(restaurant, payload);
    buildRestaurantSelect();
    $("settingsOk").hidden = false;
});

/* =========================================================
   SOUND
========================================================= */

let audioCtx = null;
function beep() {
    if (!soundOn) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.18].forEach(delay => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + delay + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + delay + 0.16);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(audioCtx.currentTime + delay);
            osc.stop(audioCtx.currentTime + delay + 0.18);
        });
    } catch (e) { /* audio not available */ }
}

/* ---------- boot ---------- */

startSession();

