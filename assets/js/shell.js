/* ===================================================================
   STEAM Teams CC — Public Shell
   /assets/js/shell.js

   Single shared source for the header, mobile drawer, login modal,
   and footer on every surface in the portal. Built per Dashboard
   Design Spec v4 §10, INCLUDING the August 13 amendment at §10.4.5
   (contextual chip + visible Sign Out — no chevron, no account menu).
   Do not fork this file — pages consume it via #shell-root /
   #shell-footer mounts only. Wave 3.9b, workstream 09b_.
=================================================================== */
(function () {
  "use strict";

  // ── Supabase ─────────────────────────────────────────────────────
  var SB_URL = "https://avbogkupsoeraivbyypu.supabase.co";
  var SB_KEY = "sb_publishable_jhWuvHQjixbfRPNb9Eyhgg_ogpKCm9f";

  function sbAuth(body) {
    return fetch(SB_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: SB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  // ── §10.3 — one navigation, five items, constant for every identity.
  // Register is NEVER removed, for anyone, per §10.3's explicit decision.
  var NAV_ITEMS = [
    { label: "Home",      route: "/" },
    { label: "Calendar",  route: "/calendar" },
    { label: "Merch",     route: "/merch" },
    { label: "Sponsors",  route: "/sponsors" },
    { label: "Register",  route: "/register" }
  ];

  // §10.4 — portal route per identity (destination the chip points at)
  var PORTAL_ROUTE = { family: "/family", student: "/student", staff: "/dashboard" };
  var PRIVATE_ROUTES = ["/family", "/student", "/dashboard", "/tasks-export"];

  // §10.4.3 — role display map (fixed; unmapped renders nothing, never the raw enum)
  var ROLE_LABELS = {
    admin: "Coordinator",
    coordinator: "Coordinator",
    asst_coordinator: "Asst. Coordinator",
    paid_coach: "Coach",
    volunteer_coach: "Coach",
    volunteer_coordinator: "Volunteer Coordinator"
  };

  // ── §10.4.7 Session — one record, one source ────────────────────
  var SESSION_KEY = "steamteams_session";
  var SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

  function readSession() {
    var raw;
    try { raw = localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var rec;
    try { rec = JSON.parse(raw); } catch (e) { return null; }
    if (!rec || !rec.issuedAt || (Date.now() - rec.issuedAt) > SESSION_TTL_MS) {
      clearSession();
      return null;
    }
    return rec;
  }
  function writeSession(rec) {
    rec.issuedAt = Date.now();
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(rec)); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // ── State ────────────────────────────────────────────────────────
  var state = {
    identity: "anonymous",   // anonymous | family | student | staff
    initials: "",
    displayName: "",
    staffRole: null
  };

  function currentPathname() {
    var p = window.location.pathname;
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p || "/";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ── §10.2.2 Header markup ───────────────────────────────────────
  function renderHeader() {
    var path = currentPathname();

    var navHtml = NAV_ITEMS.map(function (it) {
      var isCurrent = it.route === path;
      var cls = "text-[15px] text-white/[.82] hover:text-white focus-visible:outline " +
        "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white";
      if (isCurrent) cls += " text-white font-medium";
      return '<a href="' + it.route + '" class="' + cls + '"' +
        (isCurrent ? ' aria-current="page"' : "") + ">" + esc(it.label) + "</a>";
    }).join("");

    var identityHtml;
    if (state.identity === "anonymous") {
      identityHtml =
        '<button id="shell-login-btn" ' +
        'class="rounded bg-[#B2292E] px-4 py-2 text-[15px] font-medium text-white hover:brightness-110 ' +
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white">' +
        "Member Login</button>";
    } else {
      // §10.4.5 AMENDMENT — contextual chip + visible Sign Out beside it.
      // No chevron, no account menu (§10.4.1/§10.4.2 withdrawn).
      // Simplified per Seth, 2026-08-13: no avatar/initials — the chip is
      // just the word "Portal" or "Home". This also resolves the initials
      // gap flagged in the 3.9b wave card (the homepage has no name to
      // derive initials from without re-introducing the RLS oracle read).
      var onPortalSurface = PRIVATE_ROUTES.indexOf(path) !== -1;
      var chipLabel = onPortalSurface ? "Home" : "Portal";
      var chipHref = onPortalSurface ? "/" : (PORTAL_ROUTE[state.identity] || "/");
      // Amended 2026-08-13 (Seth, after the first live pass): these were two
      // bare text links sitting side by side and read as words, not controls —
      // especially jarring next to the anonymous state, which is a solid button.
      // Both are now buttons, and deliberately DIFFERENT ones: the chip is
      // filled and primary, matching the weight and position of the Member
      // Login button it replaces; Sign Out is outlined and secondary. Each
      // carries an icon so they are distinguishable at a glance and without
      // reading — the icon changes with the chip's context.
      var chipIcon = onPortalSurface ? "home" : "account_circle";
      identityHtml =
        '<a id="shell-portal-chip" href="' + chipHref + '" ' +
        'class="inline-flex items-center gap-1.5 rounded bg-[#B2292E] px-4 py-2 text-[15px] font-medium ' +
        'text-white hover:brightness-110 focus-visible:outline focus-visible:outline-[3px] ' +
        'focus-visible:outline-offset-2 focus-visible:outline-white">' +
          '<span class="material-symbols-outlined" style="font-size:18px;" aria-hidden="true">' + chipIcon + "</span>" +
          esc(chipLabel) +
        "</a>" +
        '<button id="shell-signout-btn" ' +
        'class="inline-flex items-center gap-1.5 rounded border border-white/40 px-4 py-2 text-[15px] ' +
        'font-medium text-white/90 hover:bg-white/10 hover:text-white focus-visible:outline ' +
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white">' +
          '<span class="material-symbols-outlined" style="font-size:18px;" aria-hidden="true">logout</span>' +
          "Sign Out</button>";
    }

    var burgerHtml =
      '<button id="shell-burger" class="md:hidden text-white focus-visible:outline focus-visible:outline-[3px] ' +
      'focus-visible:outline-offset-2 focus-visible:outline-white" aria-label="Menu" ' +
      'aria-controls="shell-drawer" aria-expanded="false">' +
      '<span class="material-symbols-outlined">menu</span></button>';

    return (
      '<header id="shell-header" class="sticky top-0 z-40 bg-[#1C355E] border-b border-white/10 transition-shadow">' +
        '<div class="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-4 md:h-16 md:px-6">' +
          '<a href="/" id="shell-wordmark" class="shrink-0 text-[18px] font-semibold tracking-tight text-white ' +
            'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white">' +
            "STEAM Teams CC</a>" +
          '<nav id="shell-nav" class="hidden md:flex items-center gap-6" aria-label="Primary">' + navHtml + "</nav>" +
          '<div id="shell-identity" class="ml-auto flex items-center gap-2">' + identityHtml + "</div>" +
          burgerHtml +
        "</div>" +
      "</header>"
    );
  }

  // ── §10.2.5 Mobile drawer — same five items as desktop nav, no more, no fewer ──
  function renderDrawer() {
    var links = NAV_ITEMS.map(function (it) {
      return '<a href="' + it.route + '" class="block min-h-[44px] flex items-center px-6 text-[16px] text-white ' +
        'border-b border-white/10 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 ' +
        'focus-visible:outline-white">' + esc(it.label) + "</a>";
    }).join("");
    return (
      '<div id="shell-drawer-backdrop" class="hidden fixed inset-0 z-[45] bg-black/50"></div>' +
      '<div id="shell-drawer" class="hidden fixed top-0 right-0 z-50 h-full w-[88vw] max-w-[360px] bg-[#1C355E] ' +
        'shadow-2xl flex flex-col" role="dialog" aria-modal="true" aria-label="Menu">' +
        '<div class="flex items-center justify-end p-4">' +
          '<button id="shell-drawer-close" aria-label="Close menu" class="text-white w-8 h-8 flex items-center ' +
          'justify-center focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 ' +
          'focus-visible:outline-white"><span class="material-symbols-outlined">close</span></button>' +
        "</div>" +
        '<nav aria-label="Mobile">' + links + "</nav>" +
      "</div>"
    );
  }

  // ── §10.5 Login modal (single markup block, one instance ever) ──
  function renderModal() {
    return (
      '<div id="shell-login-modal" class="hidden fixed inset-0 z-[60] flex items-center justify-center p-6" ' +
        'style="background:rgba(1,31,72,0.88);backdrop-filter:blur(8px);" role="dialog" aria-modal="true" ' +
        'aria-label="Portal Login">' +
        '<div class="bg-white w-full max-w-sm relative shadow-2xl">' +
          '<button id="shell-modal-close" aria-label="Close" class="absolute top-4 right-4 w-8 h-8 flex items-center ' +
          'justify-center bg-[#f0eded] hover:bg-[#B2292E] hover:text-white transition-all text-[#1c1b1b] ' +
          'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1C355E]">' +
          '<span class="material-symbols-outlined" style="font-size:18px;">close</span></button>' +
          '<div class="p-8 space-y-6">' +
            '<h2 class="text-[24px] font-semibold uppercase">Portal Login</h2>' +
            '<p class="text-[13px] uppercase tracking-wide text-[#44474e]">Select your role to sign in</p>' +
            '<div class="flex border-b border-black/10">' +
              tabBtn("family", true) + tabBtn("student", false) + tabBtn("staff", false) +
            "</div>" +
            familyPanel() + studentPanel() + staffPanel() +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }
  function tabBtn(role, active) {
    var label = role.charAt(0).toUpperCase() + role.slice(1);
    return '<button id="shell-tab-' + role + '" data-role="' + role + '" class="shell-login-tab flex-1 py-3 ' +
      "text-[14px] font-bold uppercase focus-visible:outline focus-visible:outline-[3px] " +
      "focus-visible:outline-offset-2 focus-visible:outline-[#1C355E] " +
      (active ? "border-b-2 border-[#B2292E] text-[#B2292E]" : "text-[#44474e]") +
      '">' + label + "</button>";
  }
  var INPUT_CLS = "w-full border border-black/20 px-4 py-3 focus:border-[#B2292E] focus:ring-0 " +
    "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1C355E]";
  var SUBMIT_CLS = "w-full bg-[#1A1A1A] text-white py-4 font-bold uppercase tracking-widest " +
    "hover:bg-[#B2292E] transition-all focus-visible:outline focus-visible:outline-[3px] " +
    "focus-visible:outline-offset-2 focus-visible:outline-[#1C355E]";

  function familyPanel() {
    return (
      '<div id="shell-panel-family" class="shell-login-panel space-y-4">' +
        "<div>" +
          '<label class="block text-[13px] font-bold uppercase text-[#44474e] mb-2">Family Code</label>' +
          '<input id="shell-fam-code" type="text" autocomplete="off" inputmode="text" maxlength="7" ' +
          'placeholder="CC-XXXX" pattern="CC-[A-Z0-9]{4}" class="' + INPUT_CLS + '">' +
          '<p class="mt-1 text-xs text-[#44474e]">From your registration confirmation</p>' +
        "</div>" +
        '<div id="shell-fam-err" class="hidden text-sm text-[#B2292E] bg-[#ffdad6] px-3 py-2"></div>' +
        '<button id="shell-fam-submit" class="' + SUBMIT_CLS + '">Check My Status</button>' +
        forgotLine() +
      "</div>"
    );
  }
  function studentPanel() {
    // §10.9 open item 1 of 2: ships disabled. No RPC invented — nothing to call.
    return (
      '<div id="shell-panel-student" class="shell-login-panel space-y-4 hidden">' +
        "<div>" +
          '<label class="block text-[13px] font-bold uppercase text-[#44474e] mb-2">Username</label>' +
          '<input type="text" disabled aria-disabled="true" autocomplete="off" placeholder="e.g. chrodriguez" ' +
          'class="w-full border border-black/20 px-4 py-3 bg-black/5 opacity-60">' +
        "</div>" +
        "<div>" +
          '<label class="block text-[13px] font-bold uppercase text-[#44474e] mb-2">Access code</label>' +
          '<input type="text" disabled aria-disabled="true" autocomplete="off" placeholder="e.g. CR491" ' +
          'class="w-full border border-black/20 px-4 py-3 bg-black/5 opacity-60">' +
        "</div>" +
        '<button type="button" disabled aria-disabled="true" ' +
        'class="w-full bg-black/20 text-white/70 py-4 font-bold uppercase tracking-widest cursor-not-allowed">' +
        "Sign In</button>" +
        '<p class="text-center text-[13px] text-[#44474e]">Student logins aren’t issued yet — ask your coach.</p>' +
        forgotLine() +
      "</div>"
    );
  }
  function staffPanel() {
    return (
      '<div id="shell-panel-staff" class="shell-login-panel space-y-4 hidden">' +
        "<div>" +
          '<label class="block text-[13px] font-bold uppercase text-[#44474e] mb-2">Email</label>' +
          '<input id="shell-staff-email" type="email" autocomplete="username" placeholder="your@chambersk12.org" ' +
          'class="' + INPUT_CLS + '">' +
        "</div>" +
        "<div>" +
          '<label class="block text-[13px] font-bold uppercase text-[#44474e] mb-2">Password</label>' +
          '<input id="shell-staff-pass" type="password" autocomplete="current-password" placeholder="••••••••" ' +
          'class="' + INPUT_CLS + '">' +
        "</div>" +
        '<div id="shell-staff-err" class="hidden text-sm text-[#B2292E] bg-[#ffdad6] px-3 py-2"></div>' +
        '<button id="shell-staff-submit" class="' + SUBMIT_CLS + '">Sign In</button>' +
        forgotLine() +
      "</div>"
    );
  }
  function forgotLine() {
    return '<p class="text-center text-[13px] text-[#44474e]"><a href="mailto:stehos@chambersk12.org" ' +
      'class="text-[#B2292E] hover:underline">Forgot your login? Email the coordinator.</a></p>';
  }

  // ── §10.2.8 Footer ──────────────────────────────────────────────
  function renderFooter() {
    return (
      '<footer id="shell-footer-inner" class="bg-[#1A1A1A] text-white pt-16 pb-10">' +
        '<div class="mx-auto max-w-[1280px] grid md:grid-cols-3 gap-12 border-b border-white/10 pb-12 px-4 md:px-6">' +
          "<div class=\"space-y-3\">" +
            '<h5 class="text-[14px] font-bold uppercase text-[#B2292E]">Program</h5>' +
            '<p class="text-white/70 text-[14px]">Goblin Racing (grades 4-5)</p>' +
            '<p class="text-white/70 text-[14px]">MS Greenpower &amp; Ten80 (6-8)</p>' +
            '<p class="text-white/70 text-[14px]">HS Greenpower &amp; Ten80 (9-12)</p>' +
          "</div>" +
          "<div class=\"space-y-3\">" +
            '<h5 class="text-[14px] font-bold uppercase text-[#B2292E]">Connect</h5>' +
            '<p class="text-white/70 text-[14px]">Day-to-day updates go out on Remind.</p>' +
            '<a href="mailto:steam.teams@chambersk12.org" class="block text-white/70 hover:text-white text-[14px]">steam.teams@chambersk12.org</a>' +
            '<a href="tel:+13347488665" class="block text-white/70 hover:text-white text-[14px]">(334) 748-8665</a>' +
            '<p class="text-white/70 text-[14px]">502 Vocational DR, Lafayette, AL 36862</p>' +
          "</div>" +
          "<div class=\"space-y-3\">" +
            '<h5 class="text-[14px] font-bold uppercase text-[#B2292E]">Follow</h5>' +
            '<div class="flex gap-3">' +
              '<a href="https://facebook.com/SteamTeamsCC" target="_blank" rel="noopener" aria-label="Facebook" ' +
              'class="w-10 h-10 border border-white/20 flex items-center justify-center hover:bg-[#B2292E] transition-all">' +
              '<span class="material-symbols-outlined">share</span></a>' +
              '<a href="/coming-soon.html" aria-label="Instagram" ' +
              'class="w-10 h-10 border border-white/20 flex items-center justify-center hover:bg-[#B2292E] transition-all">' +
              '<span class="material-symbols-outlined">photo_camera</span></a>' +
              '<a href="/coming-soon.html" aria-label="LinkedIn" ' +
              'class="w-10 h-10 border border-white/20 flex items-center justify-center hover:bg-[#B2292E] transition-all">' +
              '<span class="material-symbols-outlined">business</span></a>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="mx-auto max-w-[1280px] pt-8 flex flex-col md:flex-row justify-between gap-4 px-4 md:px-6 ' +
          'text-white/40 text-[13px]">' +
          '<a href="/coming-soon.html" class="hover:text-white">Privacy Policy</a>' +
          '<p>&copy; <span id="shell-footer-year"></span> STEAM Teams CC · Inspire Academy, Chambers County Schools</p>' +
        "</div>" +
      "</footer>"
    );
  }

  // ── §10.4.8 Private route sign-in panel ─────────────────────────
  function renderSignInPanel(reason) {
    var panel = document.createElement("div");
    panel.id = "shell-signin-panel";
    panel.className = "mx-auto max-w-[480px] py-24 px-6 text-center space-y-4";
    panel.innerHTML =
      '<h1 class="text-[24px] font-semibold uppercase">Sign in to continue</h1>' +
      "<p>" + esc(reason) + "</p>" +
      '<button id="shell-signin-btn" class="bg-[#B2292E] text-white px-6 py-3 font-bold uppercase">Sign In</button>';
    var existing = document.querySelectorAll("body > *:not(#shell-root):not(#shell-footer):not(script):not(link)");
    existing.forEach(function (el) { el.style.display = "none"; });
    document.body.appendChild(panel);
    document.getElementById("shell-signin-btn").addEventListener("click", openModal);
  }

  // ── Mount / interaction wiring ───────────────────────────────────
  var mounted = false;

  function mount() {
    var root = document.getElementById("shell-root");
    var footerMount = document.getElementById("shell-footer");
    if (!root) return;
    root.innerHTML = renderHeader() + renderDrawer() + renderModal();
    if (footerMount) footerMount.innerHTML = renderFooter();
    var yearEl = document.getElementById("shell-footer-year");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
    wireEvents();
    mounted = true;

    var path = currentPathname();
    if (PRIVATE_ROUTES.indexOf(path) !== -1) guardPrivateRoute(path);
    var params = new URLSearchParams(window.location.search);
    if (params.get("login") === "1") openModal();
  }

  function rerenderShell() {
    if (!mounted) return;
    var root = document.getElementById("shell-root");
    var wasDrawerOpen = !document.getElementById("shell-drawer").classList.contains("hidden");
    root.innerHTML = renderHeader() + renderDrawer() + renderModal();
    wireEvents();
    if (wasDrawerOpen) openDrawer();
  }

  function wireEvents() {
    var loginBtn = document.getElementById("shell-login-btn");
    if (loginBtn) loginBtn.addEventListener("click", openModal);

    var burger = document.getElementById("shell-burger");
    if (burger) burger.addEventListener("click", toggleDrawer);
    var drawerClose = document.getElementById("shell-drawer-close");
    if (drawerClose) drawerClose.addEventListener("click", closeDrawer);
    var backdrop = document.getElementById("shell-drawer-backdrop");
    if (backdrop) backdrop.addEventListener("click", closeDrawer);

    var signOut = document.getElementById("shell-signout-btn");
    if (signOut) signOut.addEventListener("click", doSignOut);

    var modalClose = document.getElementById("shell-modal-close");
    if (modalClose) modalClose.addEventListener("click", closeModal);
    var modal = document.getElementById("shell-login-modal");
    if (modal) modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });

    document.querySelectorAll(".shell-login-tab").forEach(function (btn) {
      btn.addEventListener("click", function () { switchLoginTab(btn.getAttribute("data-role")); });
    });

    var famSubmit = document.getElementById("shell-fam-submit");
    if (famSubmit) famSubmit.addEventListener("click", loginFamily);
    var staffSubmit = document.getElementById("shell-staff-submit");
    if (staffSubmit) staffSubmit.addEventListener("click", loginStaff);

    var famCode = document.getElementById("shell-fam-code");
    if (famCode) famCode.addEventListener("input", function () {
      var v = famCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (v.length > 2) v = v.slice(0, 2) + "-" + v.slice(2, 6);
      famCode.value = v.slice(0, 7);
    });

    document.addEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key !== "Escape") return;
    var modal = document.getElementById("shell-login-modal");
    if (modal && !modal.classList.contains("hidden")) { closeModal(); return; }
    var drawer = document.getElementById("shell-drawer");
    if (drawer && !drawer.classList.contains("hidden")) closeDrawer();
  }

  // ── Drawer ───────────────────────────────────────────────────────
  function openDrawer() {
    document.getElementById("shell-drawer").classList.remove("hidden");
    document.getElementById("shell-drawer-backdrop").classList.remove("hidden");
    document.getElementById("shell-burger").setAttribute("aria-expanded", "true");
  }
  function closeDrawer() {
    var d = document.getElementById("shell-drawer");
    if (d) d.classList.add("hidden");
    var b = document.getElementById("shell-drawer-backdrop");
    if (b) b.classList.add("hidden");
    var burger = document.getElementById("shell-burger");
    if (burger) { burger.setAttribute("aria-expanded", "false"); burger.focus(); }
  }
  function toggleDrawer() {
    var d = document.getElementById("shell-drawer");
    if (d.classList.contains("hidden")) openDrawer(); else closeDrawer();
  }

  // ── Modal ────────────────────────────────────────────────────────
  function openModal() {
    var m = document.getElementById("shell-login-modal");
    if (!m) return;
    m.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    var m = document.getElementById("shell-login-modal");
    if (!m) return;
    m.classList.add("hidden");
    document.body.style.overflow = "";
  }
  function switchLoginTab(role) {
    document.querySelectorAll(".shell-login-panel").forEach(function (p) { p.classList.add("hidden"); });
    var panel = document.getElementById("shell-panel-" + role);
    if (panel) panel.classList.remove("hidden");
    document.querySelectorAll(".shell-login-tab").forEach(function (b) {
      var active = b.getAttribute("data-role") === role;
      b.classList.toggle("border-b-2", active);
      b.classList.toggle("border-[#B2292E]", active);
      b.classList.toggle("text-[#B2292E]", active);
      b.classList.toggle("text-[#44474e]", !active);
    });
  }

  function showErr(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
  }
  function hideErr(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  }

  // ── §10.5.3 Login handlers — no redirect, chip appears in place ──
  function loginFamily() {
    var code = document.getElementById("shell-fam-code").value.trim().toUpperCase();
    hideErr("shell-fam-err");
    if (!code.match(/^CC-[A-Z0-9]{4}$/)) {
      showErr("shell-fam-err", "We don’t recognise that family code. Check the letter case and try again, or email stehos@chambersk12.org.");
      return;
    }
    var btn = document.getElementById("shell-fam-submit");
    btn.disabled = true; btn.textContent = "Looking up…";
    // Never validated client-side — RLS blocks a direct anon read of `families`
    // (01-family-05 revoked it deliberately). get_family_dashboard() is the
    // only valid entry point and family-dashboard.html calls it. Preserved.
    //
    // KNOWN GAP (flagged, not invented around): without that lookup this page
    // cannot know the family's real initials at the moment of login — showing
    // them would require the read this section exists to avoid re-introducing.
    // The chip falls back to a neutral "•" placeholder for family until
    // family-dashboard.html (3.9c) resolves get_family_dashboard() and can
    // write real initials back into the session. See wave card.
    sessionStorage.setItem("st_family_code", code);
    writeSession({ identity: "family", initials: "", displayName: code, familyCode: code, studentUsername: null, staffRole: null });
    btn.disabled = false; btn.textContent = "Check My Status";
    closeModal();
    state.identity = "family"; state.initials = ""; state.displayName = code; state.staffRole = null;
    rerenderShell();
  }

  function loginStaff() {
    var email = document.getElementById("shell-staff-email").value.trim();
    var pass = document.getElementById("shell-staff-pass").value;
    hideErr("shell-staff-err");
    if (!email || !pass) { showErr("shell-staff-err", "Email or password is incorrect."); return; }
    var btn = document.getElementById("shell-staff-submit");
    btn.disabled = true; btn.textContent = "Signing in…";
    sbAuth({ email: email, password: pass }).then(function (data) {
      btn.disabled = false; btn.textContent = "Sign In";
      if (!data || !data.access_token) {
        showErr("shell-staff-err", "Email or password is incorrect.");
        return;
      }
      sessionStorage.setItem("st_staff_token", data.access_token);
      var meta = (data.user && data.user.user_metadata) || {};
      var first = meta.first_name || email.split("@")[0];
      var last = meta.last_name || "";
      var initials = ((first[0] || "") + (last[0] || first[1] || "")).toUpperCase();
      var role = meta.role || null;
      writeSession({ identity: "staff", initials: initials, displayName: first, familyCode: null, studentUsername: null, staffRole: role });
      closeModal();
      state.identity = "staff"; state.initials = initials; state.displayName = first; state.staffRole = role;
      rerenderShell();
    }).catch(function () {
      btn.disabled = false; btn.textContent = "Sign In";
      showErr("shell-staff-err", "We couldn’t reach the portal just now. Try again in a moment.");
    });
  }

  function doSignOut() {
    var wasPrivate = PRIVATE_ROUTES.indexOf(currentPathname()) !== -1;
    clearSession();
    sessionStorage.removeItem("st_family_code");
    sessionStorage.removeItem("st_staff_token");
    state.identity = "anonymous"; state.initials = ""; state.displayName = ""; state.staffRole = null;
    rerenderShell();
    if (wasPrivate) window.location.href = "/";
  }

  // ── §10.4.8 Private route guard ─────────────────────────────────
  function guardPrivateRoute(path) {
    var sess = readSession();
    if (!sess) {
      renderSignInPanel("This part of the portal is for signed-in families, students, or staff.");
      openModal();
      return;
    }
    var okFor = { "/family": "family", "/student": "student", "/dashboard": "staff", "/tasks-export": "staff" };
    if (okFor[path] && okFor[path] !== sess.identity) {
      var who = { family: "a family", student: "a student", staff: "staff" }[sess.identity];
      var need = { family: "families", student: "students", staff: "staff" }[okFor[path]];
      renderSignInPanel("This page is for " + need + ". You're signed in as " + who + ".");
    }
  }

  // ── §10.4.6 Optimistic render + session resolution ───────────────
  function resolveIdentity() {
    var sess = readSession();
    if (!sess) { state.identity = "anonymous"; return; }
    if (sess.identity === "staff") {
      // Staff revalidation authority is the Supabase auth session. This wave
      // mirrors the sessionStorage token dashboard.html already reads (D8
      // fix is out of scope here) rather than inventing a second check.
      var tok = sessionStorage.getItem("st_staff_token");
      if (!tok) { clearSession(); state.identity = "anonymous"; return; }
    }
    state.identity = sess.identity;
    state.initials = sess.initials || "";
    state.displayName = sess.displayName || "";
    state.staffRole = sess.staffRole || null;
  }

  window.addEventListener("storage", function (e) {
    if (e.key !== SESSION_KEY) return;
    resolveIdentity();
    rerenderShell();
  });

  document.addEventListener("DOMContentLoaded", function () {
    resolveIdentity();
    mount();
  });

  // §10.2.3 — elevation on scroll, passive listener
  window.addEventListener("scroll", function () {
    var h = document.getElementById("shell-header");
    if (!h) return;
    h.classList.toggle("shell-scrolled", window.scrollY > 0);
  }, { passive: true });
})();
