/* =========================================================
   KASI MEALS — "List your restaurant" application
   The applicant creates (or uses) an account and sends an
   application. An admin must approve it before a restaurant
   and a vendor dashboard exist.
========================================================= */

const SUPABASE_URL = "https://yrcoiwybsjhrmxaswocz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyY29pd3lic2pocm14YXN3b2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NzU2ODYsImV4cCI6MjEwNzI1MTY4Nn0.Jw--tFIC4PuPB0vdJaZCn4UjLwb4BLHFtufC6FE2wq8";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let session = null;
let mode = "signup";

function esc(t) {
    return String(t ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function show(name) {
    $("loadingView").hidden = name !== "loading";
    $("statusView").hidden = name !== "status";
    $("formView").hidden = name !== "form";
}

function setMessage(text, ok = false) {
    const el = $("aMessage");
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("ok", ok);
}

async function myRole() {
    const { data, error } = await db.rpc("my_role");
    return error ? "customer" : data;
}

async function latestApplication() {
    const { data } = await db.from("restaurant_applications")
        .select("*").order("created_at", { ascending: false }).limit(1);
    return data && data[0] ? data[0] : null;
}

function renderStatus(html) {
    $("statusView").innerHTML = `<div class="profile-card status-card">${html}</div>`;
    show("status");
}

function renderApplication(app) {
    const common = `<p class="status-meta">${esc(app.restaurant_name)} • sent ${esc(new Date(app.created_at).toLocaleDateString())}</p>`;
    if (app.status === "pending") {
        renderStatus(`
            <div class="success-icon">⏳</div>
            <h2>Application received</h2>
            ${common}
            <p>Our team is reviewing it. Once it's approved, log in at the vendor page with the email you applied with.</p>
            <a class="checkout-button vendor-link" href="vendor.html">Go to vendor login <span>→</span></a>`);
    } else if (app.status === "approved") {
        renderStatus(`
            <div class="success-icon">✓</div>
            <h2>You're approved! 🎉</h2>
            ${common}
            <p>Log in to your vendor dashboard to add your menu, then switch your restaurant to <strong>Open</strong>.</p>
            <a class="checkout-button vendor-link" href="vendor.html">Open vendor dashboard <span>→</span></a>`);
    } else {
        renderStatus(`
            <div class="success-icon">✕</div>
            <h2>Application not approved</h2>
            ${common}
            ${app.admin_note ? `<p><strong>Note from our team:</strong> ${esc(app.admin_note)}</p>` : ""}
            <p>You're welcome to contact us and apply again.</p>`);
    }
}

function renderForm() {
    const loggedIn = !!session;
    $("accountFields").hidden = loggedIn;
    $("signedInNote").hidden = !loggedIn;
    if (loggedIn) {
        $("signedInNote").innerHTML = `Applying as <strong>${esc(session.user.email)}</strong>`;
        const meta = session.user.user_metadata || {};
        if (meta.full_name && !$("aOwner").value) $("aOwner").value = meta.full_name;
        if (meta.phone && !$("aPhone").value) $("aPhone").value = meta.phone;
    }
    show("form");
}

async function init() {
    try {
        const { data } = await db.auth.getSession();
        session = data.session;
    } catch (e) { session = null; }

    if (!session) { renderForm(); return; }

    const role = await myRole();
    if (role === "vendor") {
        renderStatus(`
            <h2>You already manage a restaurant</h2>
            <p>This account is a vendor account.</p>
            <a class="checkout-button vendor-link" href="vendor.html">Open vendor dashboard <span>→</span></a>`);
        return;
    }
    if (role === "admin") {
        renderStatus(`
            <h2>Admin account</h2>
            <p>Admins cannot apply for a restaurant.</p>
            <a class="checkout-button vendor-link" href="admin.html">Open admin dashboard <span>→</span></a>`);
        return;
    }

    const app = await latestApplication();
    if (app && app.status !== "rejected") { renderApplication(app); return; }
    renderForm();
}

document.querySelectorAll(".auth-tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
        mode = btn.dataset.mode;
        document.querySelectorAll(".auth-tabs button").forEach(b =>
            b.classList.toggle("active", b === btn));
        $("aPassword").autocomplete = mode === "signup" ? "new-password" : "current-password";
        $("aPassword").placeholder = mode === "signup" ? "At least 6 characters" : "";
    });
});

$("applyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage("");

    const btn = $("aSubmit");
    btn.disabled = true;

    try {
        const owner = $("aOwner").value.trim();
        const phone = $("aPhone").value.trim();

        if (!session) {
            const email = $("aEmail").value.trim();
            const password = $("aPassword").value;
            if (!email || password.length < 6) {
                throw new Error("Please enter your email and a password of at least 6 characters.");
            }

            if (mode === "signup") {
                const { data, error } = await db.auth.signUp({
                    email, password, options: { data: { full_name: owner, phone } }
                });
                if (error) throw error;
                if (!data.session) {
                    setMessage("Account created. Check your email to confirm it, then come back, choose \"I have an account\" and submit again.", true);
                    btn.disabled = false;
                    return;
                }
                session = data.session;
            } else {
                const { data, error } = await db.auth.signInWithPassword({ email, password });
                if (error) throw error;
                session = data.session;
            }
        }

        const role = await myRole();
        if (role !== "customer") { await init(); return; }

        const existing = await latestApplication();
        if (existing && existing.status !== "rejected") { renderApplication(existing); return; }

        const { error } = await db.from("restaurant_applications").insert({
            user_id: session.user.id,
            restaurant_name: $("aName").value.trim(),
            category: $("aCategory").value,
            description: $("aDescription").value.trim(),
            owner_name: owner,
            phone,
            email: session.user.email,
            address: $("aAddress").value.trim()
        });
        if (error) throw error;

        renderApplication(await latestApplication());
    } catch (err) {
        setMessage(err.message || "Something went wrong. Please try again.");
    } finally {
        btn.disabled = false;
    }
});

init();

