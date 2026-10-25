/* =========================================================
   KASI MEALS — Admin dashboard
   Overview stats, restaurant applications (approve / reject),
   all restaurants (suspend / restore) and all orders.
   Everything is protected by the database: only users listed
   in public.admin_users can read or change this data.
========================================================= */

const SUPABASE_URL = "https://yrcoiwybsjhrmxaswocz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyY29pd3lic2pocm14YXN3b2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NzU2ODYsImV4cCI6MjEwNzI1MTY4Nn0.Jw--tFIC4PuPB0vdJaZCn4UjLwb4BLHFtufC6FE2wq8";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const ORDER_STATUS = {
    placed: "New", preparing: "Preparing", on_the_way: "On the way",
    delivered: "Delivered", cancelled: "Cancelled"
};
const CATEGORY = { kotas: "Kotas", meals: "Kasi Meals", chicken: "Chicken", braai: "Braai" };

let section = "overview";
let appFilter = "pending";
let orderFilter = "all";
let applications = [];
let restaurants = [];
let orders = [];
let pollTimer = null;

function esc(t) {
    return String(t ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}
const rand = (n) => "R" + Number(n || 0).toLocaleString("en-ZA");

function setText(id, msg) {
    const el = $(id);
    el.textContent = msg || "";
    el.hidden = !msg;
}

function show(view) {
    $("loginView").hidden = view !== "login";
    $("appView").hidden = view !== "app";
    $("adminActions").hidden = view !== "app";
}

/* ---------- auth ---------- */

async function start() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { show("login"); return; }

    const { data: role, error } = await db.rpc("my_role");
    if (error || role !== "admin") {
        await db.auth.signOut();
        setText("loginError", error
            ? "Could not verify your account: " + error.message
            : "This account is not an administrator.");
        show("login");
        return;
    }

    show("app");
    showSection("overview");
    refreshPending();
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshPending, 30000);
}

$("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setText("loginError", "");
    $("loginBtn").disabled = true;
    const { error } = await db.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
    });
    $("loginBtn").disabled = false;
    if (error) { setText("loginError", error.message); return; }
    $("password").value = "";
    start();
});

$("logoutBtn").addEventListener("click", async () => {
    await db.auth.signOut();
    clearInterval(pollTimer);
    show("login");
});

$("refreshBtn").addEventListener("click", () => { showSection(section); refreshPending(); });

$("sectionTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".section-tab");
    if (tab) showSection(tab.dataset.section);
});

function showSection(name) {
    section = name;
    ["overview", "applications", "restaurants", "orders"].forEach(s => {
        $(s + "Panel").hidden = s !== name;
    });
    document.querySelectorAll(".section-tab").forEach(t =>
        t.classList.toggle("active", t.dataset.section === name));
    setText("globalError", "");

    if (name === "overview") loadOverview();
    if (name === "applications") loadApplications();
    if (name === "restaurants") loadRestaurants();
    if (name === "orders") loadOrders();
}

async function refreshPending() {
    const { count } = await db.from("restaurant_applications")
        .select("id", { count: "exact", head: true }).eq("status", "pending");
    const dot = $("pendingDot");
    dot.textContent = count || 0;
    dot.hidden = !count;
}

/* ---------- overview ---------- */

async function loadOverview() {
    const { data, error } = await db.rpc("admin_stats");
    if (error) { setText("globalError", "Could not load stats: " + error.message); return; }
    const s = data || {};
    const by = s.by_status || {};
    const maxStatus = Math.max(1, ...Object.values(by).map(Number));

    $("overviewPanel").innerHTML = `
        <div class="vendor-heading"><div><span class="section-kicker">TODAY &amp; ALL TIME</span><h1>Overview</h1></div></div>

        <div class="stat-grid">
            <div class="stat-card highlight"><small>Orders today</small><strong>${esc(s.orders_today)}</strong></div>
            <div class="stat-card highlight"><small>Revenue today</small><strong>${rand(s.revenue_today)}</strong></div>
            <div class="stat-card"><small>Total orders</small><strong>${esc(s.orders_total)}</strong></div>
            <div class="stat-card"><small>Total revenue</small><strong>${rand(s.revenue_total)}</strong></div>
            <div class="stat-card"><small>Restaurants</small><strong>${esc(s.restaurants)}</strong></div>
            <div class="stat-card"><small>Open now</small><strong>${esc(s.restaurants_open)}</strong></div>
            <div class="stat-card"><small>Customers</small><strong>${esc(s.customers)}</strong></div>
            <div class="stat-card"><small>Pending applications</small><strong>${esc(s.pending_applications)}</strong></div>
        </div>

        <div class="vendor-card admin-block">
            <h2>Orders by status</h2>
            ${Object.keys(ORDER_STATUS).map(k => `
                <div class="bar-row">
                    <span class="bar-label">${esc(ORDER_STATUS[k])}</span>
                    <span class="bar"><span style="width:${(Number(by[k] || 0) / maxStatus) * 100}%"></span></span>
                    <span class="bar-num">${esc(by[k] || 0)}</span>
                </div>`).join("")}
        </div>

        <div class="vendor-card admin-block">
            <h2>Top restaurants</h2>
            ${(s.top_restaurants || []).length ? s.top_restaurants.map(r => `
                <div class="rank-row">
                    <div><strong>${esc(r.name)}</strong><small>${esc(r.orders)} order${Number(r.orders) === 1 ? "" : "s"}</small></div>
                    <strong>${rand(r.revenue)}</strong>
                </div>`).join("") : `<p>No orders yet.</p>`}
        </div>
    `;
}

/* ---------- applications ---------- */

async function loadApplications() {
    const { data, error } = await db.from("restaurant_applications")
        .select("*").order("created_at", { ascending: false }).limit(200);
    if (error) { setText("globalError", "Could not load applications: " + error.message); return; }
    applications = data || [];
    renderApplications();
}

function renderApplications() {
    const counts = { pending: 0, approved: 0, rejected: 0 };
    applications.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

    $("appFilters").innerHTML = ["pending", "approved", "rejected"].map(s => `
        <button class="filter-chip ${s === appFilter ? "active" : ""}" data-filter="${s}" type="button">
            ${s[0].toUpperCase() + s.slice(1)}<span class="tab-count">${counts[s] || 0}</span>
        </button>`).join("");

    const list = applications.filter(a => a.status === appFilter);
    if (!list.length) {
        $("applicationsList").innerHTML = `<div class="vendor-empty"><div>📭</div><p>No ${esc(appFilter)} applications.</p></div>`;
        return;
    }

    $("applicationsList").innerHTML = list.map(a => `
        <article class="app-card">
            <div class="row-top">
                <div>
                    <h3>${esc(a.restaurant_name)}</h3>
                    <div class="app-meta">${esc(new Date(a.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</div>
                </div>
                <span class="pill ${a.status === "approved" ? "ok" : a.status === "rejected" ? "bad" : "warn"}">${esc(a.status)}</span>
            </div>
            <dl>
                <dt>Food</dt><dd>${esc(CATEGORY[a.category] || a.category)}</dd>
                <dt>About</dt><dd>${esc(a.description || "—")}</dd>
                <dt>Address</dt><dd>${esc(a.address || "—")}</dd>
                <dt>Owner</dt><dd>${esc(a.owner_name)}</dd>
                <dt>Phone</dt><dd><a href="tel:${esc(String(a.phone).replace(/[^\d+]/g, ""))}">${esc(a.phone)}</a></dd>
                <dt>Email</dt><dd>${esc(a.email)}</dd>
            </dl>
            ${a.admin_note ? `<div class="note">Note: ${esc(a.admin_note)}</div>` : ""}
            ${a.status === "pending" ? `
                <div class="order-actions">
                    <button data-app="approve" data-id="${esc(a.id)}" type="button">✓ Approve</button>
                    <button class="secondary" data-app="reject" data-id="${esc(a.id)}" type="button">Reject</button>
                </div>` : ""}
        </article>`).join("");
}

$("appFilters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    appFilter = chip.dataset.filter;
    renderApplications();
});

$("applicationsList").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-app]");
    if (!btn) return;
    const id = btn.dataset.id;
    const app = applications.find(a => a.id === id);
    if (!app) return;

    if (btn.dataset.app === "approve") {
        if (!confirm(`Approve "${app.restaurant_name}"? This creates the restaurant and gives ${app.email} a vendor dashboard.`)) return;
        btn.disabled = true;
        const { error } = await db.rpc("approve_application", { app_id: id });
        if (error) { alert("Could not approve: " + error.message); btn.disabled = false; return; }
    } else {
        const note = prompt(`Reject "${app.restaurant_name}"? Add a short reason for the applicant (optional):`);
        if (note === null) return;
        btn.disabled = true;
        const { error } = await db.rpc("reject_application", { app_id: id, note });
        if (error) { alert("Could not reject: " + error.message); btn.disabled = false; return; }
    }
    await loadApplications();
    refreshPending();
});

/* ---------- restaurants ---------- */

async function loadRestaurants() {
    const { data, error } = await db.rpc("admin_restaurants");
    if (error) { setText("globalError", "Could not load restaurants: " + error.message); return; }
    restaurants = data || [];
    renderRestaurants();
}

function renderRestaurants() {
    if (!restaurants.length) {
        $("restaurantsList").innerHTML = `<div class="vendor-empty"><div>🍽️</div><p>No restaurants yet.</p></div>`;
        return;
    }
    const noPin = restaurants.filter(r => r.latitude == null || r.longitude == null).length;
    $("restaurantsList").innerHTML = (noPin
        ? `<p class="vendor-error" style="margin-bottom:12px">⚠️ ${noPin} restaurant${noPin === 1 ? " has" : "s have"} no location pin yet.</p>` : "")
        + restaurants.map(r => `
        <article class="app-card">
            <div class="row-top">
                <div>
                    <h3>${esc(r.name)}</h3>
                    <div class="app-meta">${esc(CATEGORY[r.category] || r.category)} • ${esc(r.menu_items)} menu items • ${esc(r.orders)} orders</div>
                </div>
                <div class="row-pills">
                    <span class="pill ${r.is_active ? "ok" : "bad"}">${r.is_active ? "Active" : "Suspended"}</span>
                    <span class="pill ${r.is_open ? "ok" : "grey"}">${r.is_open ? "Open" : "Closed"}</span>
                </div>
            </div>
            <dl>
                <dt>Owner</dt><dd>${esc(r.owners || "—")}</dd>
                <dt>Phone</dt><dd>${esc(r.phone || "—")}</dd>
                <dt>Address</dt><dd>${esc(r.address || "—")}</dd>
                <dt>Pin</dt><dd>${r.latitude != null && r.longitude != null
                    ? `📍 <a href="https://www.google.com/maps?q=${Number(r.latitude)},${Number(r.longitude)}" target="_blank" rel="noopener">View on map ↗</a>`
                    : "⚠️ Not set"}</dd>
            </dl>
            <div class="order-actions">
                <button class="${r.is_active ? "secondary" : ""}" data-rest="${r.is_active ? "suspend" : "restore"}" data-id="${esc(r.id)}" type="button">
                    ${r.is_active ? "Suspend restaurant" : "Restore restaurant"}
                </button>
            </div>
        </article>`).join("");
}

$("restaurantsList").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-rest]");
    if (!btn) return;
    const r = restaurants.find(x => x.id === btn.dataset.id);
    if (!r) return;
    const suspend = btn.dataset.rest === "suspend";
    if (suspend && !confirm(`Suspend "${r.name}"? Customers will no longer see it or be able to order.`)) return;

    btn.disabled = true;
    const { error } = await db.rpc("admin_set_active", { rid: r.id, active: !suspend });
    if (error) { alert("Could not update: " + error.message); btn.disabled = false; return; }
    await loadRestaurants();
});

/* ---------- orders ---------- */

async function loadOrders() {
    if (!restaurants.length) {
        const { data } = await db.rpc("admin_restaurants");
        restaurants = data || [];
    }
    const { data, error } = await db.from("orders")
        .select("*").order("created_at", { ascending: false }).limit(100);
    if (error) { setText("globalError", "Could not load orders: " + error.message); return; }
    orders = data || [];
    renderOrders();
}

function renderOrders() {
    $("orderFilters").innerHTML = ["all", ...Object.keys(ORDER_STATUS)].map(s => `
        <button class="filter-chip ${s === orderFilter ? "active" : ""}" data-filter="${s}" type="button">
            ${s === "all" ? "All" : esc(ORDER_STATUS[s])}
        </button>`).join("");

    const list = orders.filter(o => orderFilter === "all" || o.status === orderFilter);
    if (!list.length) {
        $("ordersList").innerHTML = `<div class="vendor-empty"><div>🧾</div><p>No orders here.</p></div>`;
        return;
    }
    const name = (id) => (restaurants.find(r => r.id === id) || {}).name || "Unknown restaurant";

    $("ordersList").innerHTML = list.map(o => `
        <article class="app-card">
            <div class="row-top">
                <div>
                    <strong>#KM-${esc(String(o.id).slice(0, 8).toUpperCase())}</strong> • ${esc(name(o.restaurant_id))}
                    <p>${esc(o.customer_name)} • ${esc(o.customer_phone)}</p>
                    <p>${esc(o.created_at ? new Date(o.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "")}</p>
                </div>
                <div class="row-pills" style="flex-direction:column;align-items:flex-end">
                    <strong>${rand(o.total_amount)}</strong>
                    <span class="status-pill ${esc(o.status)}">${esc(ORDER_STATUS[o.status] || o.status)}</span>
                </div>
            </div>
        </article>`).join("");
}

$("orderFilters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    orderFilter = chip.dataset.filter;
    renderOrders();
});

start();

