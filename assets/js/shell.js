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
  // W3.9d-d, 2026-08-16: "/student" REMOVED from this list, by Seth's decision.
  //
  // §10 contradicts itself here. §10.3 row 5 and §10.7.1 both make /student a
  // route that coming-soon.html serves, with its own placeholder copy, and
  // §10.4.5's amendment table lists "/student placeholder" explicitly under
  // PUBLIC surfaces. But §10.4.8 lists it as private, and this array is what
  // the code obeyed — so the guard hid the placeholder on every visit.
  //
  // What a student actually got: "Sign in to continue" -> open the modal ->
  // the Student tab, whose submit does not exist because student credentials
  // are unbuilt (§10.9 Open Item 1, Gate row C7). A dead end, with the correct
  // copy — "Student accounts have not been issued yet. Ask your coach…" —
  // sitting in the DOM at display:none.
  //
  // Guarding a route whose portal does not exist protects nothing. Put it back
  // in this array in W6, in the same change that builds the student dashboard.
  var PRIVATE_ROUTES = ["/family", "/dashboard", "/tasks-export"];

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
  // ── W4.5, 2026-08-24 — staff token moved into this record; see below. ──
  var SESSION_KEY = "steamteams_session";
  // Family/student lifetime — UNCHANGED, Design Spec v5 §10.4.7. Out of this
  // wave's scope (Touches: shell.js session logic for STAFF; family/student
  // credential paths are explicitly untouched).
  var SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
  // Staff lifetime — Seth's ruling, 2026-08-21: a FIXED 24-hour window from
  // sign-in, never extended by activity. This is a policy boundary, not a
  // security control — anyone with the console can edit the stamp. The real
  // security boundary is the Supabase JWT's own short lifetime (read live,
  // per-response, below) plus server-side revocation of the refresh token.
  var STAFF_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Set when a session ends for a reason worth telling the person about
  // (expired / a refresh was rejected / a request was rejected outright).
  // Read by guardPrivateRoute() and endSessionVisibly() to choose the
  // message. Cleared by writeSession() the next time a sign-in succeeds —
  // never "consumed" on a single read, so two render passes in the same
  // failure (e.g. an early check during boot, then the shell's own mount)
  // show the same message instead of one specific and one generic.
  var SESSION_END_REASON_KEY = "st_session_end_reason";

  function sessionEndMessage(reason) {
    if (reason === "expired") {
      return "Your session expired 24 hours after you signed in. Please sign in again.";
    }
    if (reason === "refresh_failed" || reason === "rejected") {
      return "We couldn’t keep you signed in. Please sign in again.";
    }
    return "This part of the portal is for signed-in families, students, or staff.";
  }

  // A failed localStorage write must surface, not vanish — Project Instructions,
  // "no empty catch blocks, no silent no-ops": *"writeSession() swallowing its
  // errors is what let a launch blocker hide behind a successful login for a
  // weekend."* This wave fixes that literally, in the three functions named.
  // shell.js has no toast system of its own (that lives page-side, e.g.
  // dashboard.html's toast()), so this is a minimal, self-contained banner —
  // visible on every surface, since every surface loads this file.
  function surfaceStorageError(action) {
    try {
      var el = document.getElementById("shell-storage-error");
      if (!el) {
        el = document.createElement("div");
        el.id = "shell-storage-error";
        el.setAttribute("role", "alert");
        el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:70;" +
          "background:#B2292E;color:#fff;text-align:center;padding:10px 16px;" +
          "font-size:14px;font-weight:500;";
        document.body.appendChild(el);
      }
      el.textContent = "Your browser blocked " + action + ". Check your privacy/cookie " +
        "settings, or try a different browser — the portal can’t sign you in reliably like this.";
    } catch (e2) { /* nothing further we can do without storage or a DOM */ }
  }

  function readSession() {
    var raw;
    try { raw = localStorage.getItem(SESSION_KEY); }
    catch (e) { surfaceStorageError("reading your saved sign-in"); return null; }
    if (!raw) return null;
    var rec;
    try { rec = JSON.parse(raw); } catch (e) { return null; }
    if (!rec || !rec.signedInAt) {
      // No timestamp at all — either corrupt, or a pre-W4.5 record (the shape
      // changed: `issuedAt` -> `signedInAt`, and staff records now carry their
      // tokens here instead of a per-tab sessionStorage key). Either way it
      // cannot be trusted; discard rather than guess.
      clearSession();
      return null;
    }
    var ttl = rec.identity === "staff" ? STAFF_SESSION_TTL_MS : SESSION_TTL_MS;
    if ((Date.now() - rec.signedInAt) > ttl) {
      endSession(rec.identity === "staff" ? "expired" : null);
      return null;
    }
    return rec;
  }
  function writeSession(rec) {
    // Stamped once, at first write, and preserved on every later write for the
    // same sign-in (e.g. a token refresh calls writeSession() again with the
    // same object) — that is what makes the 24-hour window FIXED rather than
    // rolling. Do not reset this on every write; that would silently turn a
    // fixed window back into an inactivity timer.
    if (!rec.signedInAt) rec.signedInAt = Date.now();
    try { sessionStorage.removeItem(SESSION_END_REASON_KEY); } catch (e) {}
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(rec)); }
    catch (e) { surfaceStorageError("saving your sign-in"); }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); }
    catch (e) { surfaceStorageError("signing you out completely"); }
  }
  // Ends the session for a specific, recorded reason, without touching the UI —
  // used from low-level checks (readSession's own TTL check, a rejected
  // refresh) that may run before the shell has mounted anything to re-render.
  function endSession(reason) {
    if (reason) { try { sessionStorage.setItem(SESSION_END_REASON_KEY, reason); } catch (e) {} }
    clearSession();
  }
  // Ends the session AND reflects it on screen immediately — for a failure
  // discovered mid-session, after the page has already rendered as signed in.
  // (A failure discovered during the initial mount does not need this: mount()
  // calls guardPrivateRoute() right after resolveIdentity(), and that already
  // reads the session-end reason and renders the right message on its own.)
  function endSessionVisibly(reason) {
    endSession(reason);
    state.identity = "anonymous"; state.initials = ""; state.displayName = ""; state.staffRole = null;
    if (!mounted) return;
    rerenderShell();
    if (PRIVATE_ROUTES.indexOf(currentPathname()) !== -1) {
      renderSignInPanel(sessionEndMessage(reason));
      openModal();
    }
  }

  // ── W4.5 — refresh on demand ─────────────────────────────────────
  // Exchanges the refresh token for a new access token BEFORE a caller uses
  // it, when the current one is expired or within REFRESH_SKEW_MS of expiring
  // — "before the call rather than after a failure" per the wave brief.
  // dashboard.html (and anything else that needs an authorised REST call)
  // gets a token through window.SteamTeamsAuth.getValidAccessToken(), never
  // by reading the session record's accessToken directly, so this check
  // always runs first.
  var REFRESH_SKEW_MS = 60 * 1000;
  var refreshInFlight = null; // dedupe concurrent refreshes within one tab

  function getValidAccessToken() {
    var sess = readSession();
    if (!sess || sess.identity !== "staff" || !sess.accessToken) return Promise.resolve(null);
    var msLeft = (sess.accessTokenExpiresAt || 0) - Date.now();
    if (msLeft > REFRESH_SKEW_MS) return Promise.resolve(sess.accessToken);
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = refreshAccessToken(sess).then(function (tok) {
      refreshInFlight = null;
      return tok;
    }, function () {
      refreshInFlight = null;
      return null;
    });
    return refreshInFlight;
  }

  function refreshAccessToken(sess) {
    if (!sess.refreshToken) {
      endSessionVisibly("refresh_failed");
      return Promise.resolve(null);
    }
    return fetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: SB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: sess.refreshToken })
    }).then(function (r) {
      // A refresh Supabase actually answers (even with a rejection) is
      // conclusive: the refresh token is dead. End the session visibly —
      // never retry silently, never leave a record claiming a session that
      // is gone.
      if (!r.ok) { endSessionVisibly("refresh_failed"); return null; }
      return r.json();
    }).then(function (data) {
      if (!data || !data.access_token) { endSessionVisibly("refresh_failed"); return null; }
      sess.accessToken = data.access_token;
      sess.refreshToken = data.refresh_token || sess.refreshToken;
      // Read live off the response every time — do not assume 3600.
      sess.accessTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
      writeSession(sess); // signedInAt is already set on `sess`; preserved, not reset
      return sess.accessToken;
    }).catch(function () {
      // A NETWORK failure mid-refresh is not the same as Supabase rejecting the
      // refresh token. Ending the session on a network blip would be the same
      // silent-overreaction bug §10.4.7's `resolveIdentity()` fix exists to
      // prevent. Leave the session alone; the caller's own request fails and
      // can be retried, and the next attempt will try the refresh again.
      return null;
    });
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
  // Set when the guard has hidden a page's own body, so a later successful
  // sign-in knows there is something to restore. See restoreGuardedPage().
  var guardHidPage = false;

  function renderSignInPanel(reason) {
    guardHidPage = true;
    // ── W4.5 — idempotent. ──────────────────────────────────────────
    // A session can now end mid-visit (a refresh rejected, a request 401s)
    // as well as at initial load, and both paths call this. Appending a
    // second panel on the second call would stack two "Sign in to continue"
    // boxes; update the existing one in place instead.
    var panel = document.getElementById("shell-signin-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "shell-signin-panel";
      panel.className = "mx-auto max-w-[480px] py-24 px-6 text-center space-y-4";
      var existing = document.querySelectorAll("body > *:not(#shell-root):not(#shell-footer):not(script):not(link)");
      existing.forEach(function (el) { if (el !== panel) el.style.display = "none"; });
      document.body.appendChild(panel);
    }
    panel.innerHTML =
      '<h1 class="text-[24px] font-semibold uppercase">Sign in to continue</h1>' +
      "<p>" + esc(reason) + "</p>" +
      '<button id="shell-signin-btn" class="bg-[#B2292E] text-white px-6 py-3 font-bold uppercase">Sign In</button>';
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

  // ── §10.4.8, completion — restore the page after a guard-panel sign-in ──
  // The guard hides a private page's body and opens the modal. Signing in from
  // that modal wrote the session and re-rendered the HEADER, but nothing ever
  // put the page back: the header said signed-in while the body still said
  // "Sign in to continue". Every private page was left to compensate for itself
  // (family-dashboard.html polled sessionStorage on a 400ms interval), which is
  // three copies of one fix the moment /student and /dashboard exist — the same
  // mechanism that produced four different headers.
  //
  // Reloading is the restore: the URL is preserved, so §10.5.3's "no redirect,
  // the user stays where they were" still holds, and the page re-runs its own
  // init with a session present. No page needs any recovery code of its own.
  function restoreGuardedPage() {
    if (!guardHidPage) return;
    var sess = readSession();
    if (!sess) return;
    var path = currentPathname();
    var okFor = { "/family": "family", "/student": "student", "/dashboard": "staff", "/tasks-export": "staff" };
    if (okFor[path] && okFor[path] !== sess.identity) return; // still the wrong identity — leave the panel up
    window.location.reload();
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

    // ── W3.9d-e — Enter submits the panel you are on. ──────────────
    // §10.5.1 fixes the modal's fields and behaviour but never says how a
    // submission is triggered, and nothing here bound the keyboard: the modal
    // has no <form>, so pressing Enter did literally nothing — no submit, no
    // error, no feedback. Every credential path in the portal was affected.
    // A parent typing CC-ZZ01 and hitting Go on a phone keyboard got silence
    // and no way to tell they had done nothing wrong. Found 2026-08-16 during
    // the walkthrough, reported as "I tried my login and nothing happens".
    //
    // Bound to the modal element, which rerenderShell() recreates each time,
    // so this cannot accumulate duplicate listeners.
    var SUBMIT_FOR = { family: "shell-fam-submit", staff: "shell-staff-submit" };
    if (modal) modal.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var field = e.target;
      if (!field || field.tagName !== "INPUT") return;
      var panel = field.closest(".shell-login-panel");
      if (!panel) return;
      var role = (panel.id || "").replace("shell-panel-", "");
      // Resolved by id, never "the first button in the panel" — the panel also
      // carries the Forgot-your-login link, and the student panel ships with a
      // permanently disabled submit (§10.9 open item 1) that must stay inert.
      var btn = document.getElementById(SUBMIT_FOR[role] || "");
      if (!btn || btn.disabled) return;   // disabled also means a request is in flight
      e.preventDefault();
      btn.click();
    });

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
    restoreGuardedPage();
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

      // ── W3.9d-f — role and name come from staff_accounts, not user_metadata ──
      // `user_metadata.role` is EMPTY on every account in this project, so every
      // session carried staffRole: null. Walked live 2026-08-16 across all six
      // roles: admin, coordinator, asst_coordinator, paid_coach, volunteer_coach
      // and volunteer_coordinator ALL rendered "Coordinator", because nothing
      // downstream could tell them apart. That is what failed Gate row D14, and
      // it is why no coordinator-tier UI gate can be built (§10.4.2's Task
      // Export, §10.9).
      //
      // The authority is `staff_accounts.role`. RLS policy "Staff can read own
      // account" is `auth.uid() = id`, so this returns exactly the caller's own
      // row — limit=1 is the whole result, not a slice of a larger set.
      finishStaffLogin(data, email);
    }).catch(function () {
      btn.disabled = false; btn.textContent = "Sign In";
      showErr("shell-staff-err", "We couldn’t reach the portal just now. Try again in a moment.");
    });
  }

  // Completes a staff sign-in once Supabase has accepted the credentials.
  // Split out so the profile read cannot leave the login half-done: whether it
  // succeeds, fails, or is refused, this always writes a session and always
  // re-renders. A failed profile read degrades the LABEL, never the login —
  // the alternative is stranding someone whose credentials were accepted,
  // which is the class of silent failure that cost this project a weekend.
  //
  // ── W4.5, 2026-08-24 — `data` (the full /auth/v1/token response), not just
  // the access token. Ruling: keep `refresh_token` and refresh on demand,
  // rather than raising the Supabase JWT lifetime to 24h (a stolen token would
  // then be valid a full day with no revocation — the opposite direction from
  // W9b/W9c) or shortening the app's 24h window to match the JWT (would force
  // an hourly re-sign-in on a race day). `expires_in` is read live off this
  // response, never assumed — see getValidAccessToken()/refreshAccessToken().
  function finishStaffLogin(data, email) {
    var token = data.access_token;
    var fallbackName = email.split("@")[0];

    function complete(fullName, role) {
      var name = fullName || fallbackName;
      var parts = String(name).trim().split(/\s+/);
      var initials = ((parts[0] || "")[0] || "") + ((parts[1] || "")[0] || (parts[0] || "")[1] || "");
      initials = initials.toUpperCase();
      var displayName = parts[0] || fallbackName;
      writeSession({
        identity: "staff", initials: initials, displayName: displayName,
        familyCode: null, studentUsername: null, staffRole: role || null,
        // The record IS the session now — shared via localStorage, so every
        // open tab sees the same token without waiting on a `storage` event
        // race. See resolveIdentity() below for what this replaces.
        accessToken: token,
        refreshToken: data.refresh_token || null,
        accessTokenExpiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
      });
      closeModal();
      state.identity = "staff";
      state.initials = initials;
      state.displayName = displayName;
      state.staffRole = role || null;
      rerenderShell();
      restoreGuardedPage();
    }

    fetch(SB_URL + "/rest/v1/staff_accounts?select=full_name,role&limit=1", {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + token }
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (rows) {
      var row = (rows && rows.length) ? rows[0] : null;
      // No readable row is not a reason to refuse a login Supabase already
      // accepted — dashboard.html handles that case with a visible message
      // (§10.4.7). Here it only means the label falls back.
      complete(row && row.full_name, row && row.role);
    }).catch(function () {
      complete(null, null);
    });
  }

  function doSignOut() {
    var wasPrivate = PRIVATE_ROUTES.indexOf(currentPathname()) !== -1;
    clearSession();
    sessionStorage.removeItem("st_family_code");
    // `st_staff_token` (sessionStorage, per-tab) no longer exists as of W4.5 —
    // the staff token now lives inside the shared `steamteams_session` record
    // and clearSession() above already removed it, in every tab, via the
    // `storage` event.
    try { sessionStorage.removeItem(SESSION_END_REASON_KEY); } catch (e) {}
    state.identity = "anonymous"; state.initials = ""; state.displayName = ""; state.staffRole = null;
    rerenderShell();
    if (wasPrivate) window.location.href = "/";
  }

  // ── §10.4.8 Private route guard ─────────────────────────────────
  function guardPrivateRoute(path) {
    var sess = readSession();
    if (!sess) {
      var reason = null;
      try { reason = sessionStorage.getItem(SESSION_END_REASON_KEY); } catch (e) {}
      renderSignInPanel(sessionEndMessage(reason));
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
  // ── W4.5, 2026-08-24 — the cross-tab blocker is CURED here, not contained. ──
  // Until this wave, staff identity depended on `sessionStorage.st_staff_token`
  // (PER-TAB) alongside the shared `localStorage` record — so a second tab
  // could never have the token, and the W3.9d-f containment fix (2026-08-17)
  // had to stop this function from deleting the shared record on that
  // per-tab absence, turning silent data loss into a cosmetic difference
  // instead of curing it. The invariant that fix protected — "a tab must
  // never clear shared state on evidence local to itself" — still holds, and
  // now holds trivially: the token lives INSIDE the shared record (see
  // finishStaffLogin()), so there is no separate per-tab fact left to check
  // against it. Every tab reads the same token from the same place. A second
  // open tab shows signed in the instant this function runs, no `storage`
  // event required to fix a mistake, because there is no longer a mistake to
  // fix — see the wave card for the live two-tab proof.
  //
  // Whether the record itself is still valid (24-hour window, or an already-
  // dead refresh token) is readSession()'s job, not this function's — it
  // already discarded an expired or unwritable record before returning it.
  function resolveIdentity() {
    var sess = readSession();
    if (!sess) { state.identity = "anonymous"; state.initials = ""; state.displayName = ""; state.staffRole = null; return; }
    state.identity = sess.identity;
    state.initials = sess.initials || "";
    state.displayName = sess.displayName || "";
    state.staffRole = sess.staffRole || null;
  }

  window.addEventListener("storage", function (e) {
    if (e.key !== SESSION_KEY) return;
    resolveIdentity();
    rerenderShell();
    restoreGuardedPage();
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

  // ── W4.5 — minimal public API for pages that make authorised REST calls. ──
  // shell.js is the single owner of the session record (§10.4.7) and, as of
  // this wave, of the staff access/refresh token inside it. A page like
  // dashboard.html needs a currently-valid token before every call, not the
  // one it happened to get at boot — that is what "refresh on demand" means.
  // Two separate script files can't share a JS module here (no build step),
  // so this is the deliberate seam: read-only outside this file.
  window.SteamTeamsAuth = {
    getSession: readSession,
    getValidAccessToken: getValidAccessToken,
    endSessionVisibly: endSessionVisibly,
    signOut: doSignOut
  };
})();
