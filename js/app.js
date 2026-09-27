/* FOLD: approved views, backed by Supabase authentication and user-owned data. */
(() => {
  "use strict";
  const C = FoldCore;
  const $ = (s) => document.querySelector(s);
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const categories = {
    Food: "utensils",
    Transport: "bus",
    School: "book-open",
    Fun: "gamepad-2",
    Bills: "receipt",
    Allowance: "banknote",
    Work: "briefcase",
    Gift: "gift",
    Other: "ellipsis",
  };
  const typeCategories = {
    spent: ["Food", "Transport", "School", "Fun", "Bills", "Other"],
    saved: ["Allowance", "Work", "Gift", "Other"],
  };
  const emptyState = () => ({
    profile: {
      name: "",
      email: "",
      currency: "NGN",
      startingBalance: 0,
      monthlySpendCap: 0,
    },
    transactions: [],
    goals: [],
    setupComplete: false,
  });
  let state = emptyState(),
    page = "loading",
    filter = "all",
    query = "",
    setupStep = 0,
    draft = {},
    toastTimer,
    lastFocus;
  let authStatus = "LOADING_SESSION",
    connectionError = "",
    loadError = "",
    backend,
    auth,
    repo,
    currentUser = null;
  let epoch = 0,
    sessionOwner = null,
    loadingOwner = null,
    loadPromise = null,
    booting = true,
    pending = false;
  let recovery =
    new URLSearchParams(location.search).get("auth") === "recovery";
  function errorMessage(error) {
    const messages = {
      invalid_credentials: "Email or password is incorrect.",
      email_not_confirmed: "Confirm your email before logging in.",
      user_already_exists:
        "An account may already exist. Try logging in or resetting your password.",
      over_email_send_rate_limit:
        "Please wait a little before requesting another email.",
      weak_password: "Use a stronger password with at least 8 characters.",
      same_password: "Choose a password you have not used before.",
      reauthentication_needed:
        "Request a security code below, then enter it to change your password.",
      reauthentication_not_valid:
        "That security code is not valid. Request a new code and try again.",
      23503:
        "That goal is no longer available. Close this form and reload your notebook.",
      42501: "Your session cannot access this record. Reload and try again.",
    };
    if (messages[error?.code]) return messages[error.code];
    if (
      error?.name === "AbortError" ||
      error?.name === "TimeoutError" ||
      /fetch|network/i.test(error?.message || "")
    )
      return "Couldn’t connect. Check your connection and try again.";
    // Provider messages are rendered through textContent/escape, never raw HTML.
    return error?.message || "Couldn’t save. Try again.";
  }
  function eraseUser() {
    epoch++;
    currentUser = null;
    sessionOwner = null;
    loadingOwner = null;
    loadPromise = null;
    repo = null;
    state = emptyState();
    draft = {};
    filter = "all";
    query = "";
    setupStep = 0;
    if ($("#sheet").open) $("#sheet").close();
    $("#sheet").innerHTML = "";
    lastFocus = null;
    clearTimeout(toastTimer);
    $("#toast").textContent = "";
    $("#toast").classList.remove("visible");
  }
  function cleanCallback(keepRecovery = false) {
    history.replaceState(
      null,
      "",
      location.pathname + (keepRecovery ? "?auth=recovery" : ""),
    );
  }
  function renderLoading() {
    return `${brand()}<section class="empty" role="status"><p>Loading your Fold…</p></section>`;
  }
  function renderLoadError() {
    return `${brand()}<section class="empty"><h1 tabindex="-1">A moment, please.</h1><p class="error" role="alert">${escape(loadError)}</p><button class="primary" data-action="retry">Try again</button><button class="link" data-action="logout">Log out</button></section>`;
  }
  function passwordForm(recovering = false) {
    return `<form id="password-form" class="sheet-form"><label class="field">New password<span class="password-wrap"><input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="At least 8 characters"><button type="button" data-action="toggle-password" aria-label="Show password">${icon("eye")}</button></span></label><label class="field">Confirm password<input type="password" name="confirmation" autocomplete="new-password" minlength="8" maxlength="128" required></label>${recovering ? "" : `<label class="field">Security code <span class="muted">(if requested)</span><input name="nonce" inputmode="numeric" autocomplete="one-time-code" maxlength="12"></label><button type="button" class="link" data-action="reauthenticate">Send a security code</button>`}<p class="error" role="alert" id="password-error"></p><button class="primary">Save new password</button></form>`;
  }
  function renderResetPassword() {
    return `${brand()}<div class="auth-heading"><h1 tabindex="-1">A fresh start</h1><p>Choose a new password for your Fold.</p></div>${passwordForm(true)}<button class="link" data-action="logout">Cancel and log out</button>`;
  }
  function sessionChanged(event, session) {
    if (event === "PASSWORD_RECOVERY") {
      recovery = true;
      eraseUser();
      page = "loading";
      render();
    }
    if (event === "SIGNED_OUT") {
      eraseUser();
      authStatus = "SIGNED_OUT";
      recovery = false;
      cleanCallback();
      page = "welcome";
      render();
      return;
    }
    const next = session?.user?.id;
    if (next && sessionOwner && next !== sessionOwner) {
      eraseUser();
      page = "loading";
      render();
    }
    if (booting) return;
    // No awaited SDK call inside onAuthStateChange (the SDK holds its auth lock).
    const eventEpoch = epoch;
    if (session)
      setTimeout(() => {
        if (eventEpoch === epoch) activateSession(session);
      }, 0);
  }
  function activateSession(session, force = false) {
    const returnPage =
      force && ["home", "history", "goals", "you", "balance"].includes(page)
        ? page
        : "home";
    const id = session?.user?.id;
    if (!id) {
      eraseUser();
      authStatus = "SIGNED_OUT";
      page = "welcome";
      render();
      return Promise.resolve();
    }
    if (
      !force &&
      currentUser?.id === id &&
      ["SIGNED_IN", "ONBOARDING_REQUIRED"].includes(authStatus)
    )
      return Promise.resolve();
    if (!force && loadingOwner === id) return loadPromise;
    eraseUser();
    sessionOwner = id;
    loadingOwner = id;
    const ticket = epoch;
    authStatus = "LOADING_SESSION";
    page = "loading";
    render();
    loadPromise = (async () => {
      try {
        const user = await auth.verifiedUser();
        if (ticket !== epoch) return;
        if (user.id !== id)
          throw new Error("Your session changed. Please log in again.");
        const repository = FoldData.createRepository(backend.client, id);
        if (recovery) {
          currentUser = user;
          repo = repository;
          authStatus = "SIGNED_IN";
          cleanCallback(true);
          page = "reset-password";
          render();
          return;
        }
        const notebook = await repository.load(user);
        if (ticket !== epoch) return;
        state = notebook;
        currentUser = user;
        repo = repository;
        connectionError = "";
        authStatus = state.setupComplete ? "SIGNED_IN" : "ONBOARDING_REQUIRED";
        cleanCallback();
        go(state.setupComplete ? returnPage : "setup");
      } catch (error) {
        if (ticket !== epoch) return;
        loadError = errorMessage(error);
        authStatus = "LOAD_ERROR";
        page = "load-error";
        render();
      } finally {
        if (ticket === epoch) loadingOwner = null;
      }
    })();
    return loadPromise;
  }
  async function boot() {
    booting = true;
    eraseUser();
    page = "loading";
    render();
    try {
      if (!backend) {
        backend = FoldBackend.connect(
          window.FOLD_CONFIG,
          window.supabase,
          location,
        );
        auth = backend.auth;
        auth.subscribe(sessionChanged);
      }
      const params = new URLSearchParams(location.search),
        hash = new URLSearchParams(location.hash.slice(1));
      const callbackError = params.get("error") || hash.get("error");
      if (callbackError) {
        cleanCallback();
        recovery = false;
        throw new Error(
          callbackError === "access_denied"
            ? "Sign-in was cancelled or the link has expired. Please try again."
            : "The sign-in link could not be used. Please request a new one.",
        );
      }
      const session = await auth.restore();
      booting = false;
      connectionError = "";
      if (!session && recovery) {
        recovery = false;
        cleanCallback();
        throw new Error(
          "That recovery link has expired or was opened in a different browser. Request a new link here.",
        );
      }
      await activateSession(session);
    } catch (error) {
      booting = false;
      eraseUser();
      recovery = false;
      cleanCallback();
      connectionError = errorMessage(error);
      authStatus = "SIGNED_OUT";
      page = "welcome";
      render();
    }
  }
  function requireAuth() {
    if (!auth)
      throw new Error(
        connectionError || "Configure Supabase in config.js first.",
      );
    return auth;
  }
  async function runPending(element, work, errorTarget) {
    if (pending) return;
    pending = true;
    const ticket = epoch,
      controls = [...document.querySelectorAll("button,input,select")].map(
        (el) => [el, el.disabled],
      );
    controls.forEach(([el]) => (el.disabled = true));
    const old = element?.innerHTML;
    if (element) {
      const formId = element.closest("form")?.id;
      element.textContent =
        element.dataset.action === "google"
          ? "Connecting…"
          : formId === "auth-form"
            ? page === "signup"
              ? "Creating account…"
              : "Logging in…"
            : formId === "recovery-form"
              ? "Sending…"
              : "Saving…";
      element.setAttribute("aria-busy", "true");
    }
    let target =
      errorTarget || element?.closest("form")?.querySelector(".error");
    if (target) target.textContent = "";
    try {
      await work();
    } catch (error) {
      if (ticket !== epoch) return;
      const message = errorMessage(error);
      if (!target && $("#sheet").open) {
        target = document.createElement("p");
        target.className = "error";
        target.setAttribute("role", "alert");
        $("#sheet").append(target);
      }
      if (target?.isConnected) target.textContent = message;
      else showToast(message);
    } finally {
      pending = false;
      controls.forEach(([el, disabled]) => {
        if (el.isConnected) el.disabled = disabled;
      });
      if (element?.isConnected) {
        element.innerHTML = old;
        element.removeAttribute("aria-busy");
        refreshIcons();
      }
    }
  }
  async function write(operation, apply, message) {
    if (!currentUser || !repo) throw new Error("Please log in again.");
    const ticket = epoch,
      repository = repo;
    const result = await operation(repository);
    if (ticket !== epoch || repo !== repository) return false;
    apply(result);
    closeSheet();
    render();
    showToast(message);
    return true;
  }

  const money = (n) => C.formatCurrency(n, state.profile.currency);
  const symbols = {
    NGN: "₦",
    USD: "$",
    GBP: "£",
    EUR: "€",
    GHS: "GH₵",
    KES: "KSh",
  };
  function refreshIcons() {
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.75 } });
  }
  function showToast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      3800,
    );
  }
  function go(next) {
    if (
      ["home", "history", "goals", "you", "balance", "setup"].includes(next) &&
      !currentUser
    )
      next = "welcome";
    if (
      currentUser &&
      !state.setupComplete &&
      ["home", "history", "goals", "you", "balance"].includes(next)
    )
      next = "setup";
    page = next;
    render();
    window.scrollTo(0, 0);
    $("#app h1")?.focus({ preventScroll: true });
  }
  function header(kicker, title, action = "") {
    return `<header class="page-header row"><div><p class="kicker">${kicker}</p><h1 tabindex="-1">${escape(title)}</h1></div>${action}</header>`;
  }
  const brand = () =>
    '<div class="brand"><div class="display">FOLD</div><p>Your money, simply kept.</p></div>';
  const avatar = () =>
    `<button class="avatar" data-action="nav" data-page="you" aria-label="Open your profile">${state.profile.name ? escape(state.profile.name[0].toUpperCase()) : icon("user")}</button>`;
  const bar = (value, total, extra = "") =>
    `<div class="track ${extra}" role="meter" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round((value / (total || 1)) * 100))}"><span style="width:${Math.min(100, Math.max(0, (value / (total || 1)) * 100))}%"></span></div>`;
  function relativeDate(date) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return date === C.localDate()
      ? "Today"
      : date === C.localDate(yesterday)
        ? "Yesterday"
        : new Date(date + "T12:00:00").toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
  }
  function sortedTransactions() {
    return [...state.transactions].sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  }
  function renderTransactions(rows, history = false) {
    return rows
      .map(
        (t) =>
          `<button class="transaction" data-action="transaction" data-id="${escape(t.id)}" aria-label="${escape(t.note || t.category)}, ${t.type}, ${escape(money(t.amount))}"><span class="category-icon ${t.type}">${icon(categories[t.category] || "ellipsis")}</span><span class="transaction-body"><span class="transaction-copy"><span class="transaction-title">${escape(t.note || t.category)}</span><small>${escape(t.category)}</small></span><span class="transaction-amount"><span class="${t.type}">${t.type === "spent" ? "−" : "+"}${money(t.amount)}</span><small>${history ? new Date(t.createdAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }) : relativeDate(t.date)}</small></span></span></button>`,
      )
      .join("");
  }
  function goalCard(g, controls = true) {
    const current = C.progress(state, g.id),
      percent = Math.round((current / g.target) * 100);
    return `<article class="card goal-card"><div class="row"><h3>${escape(g.name)}</h3>${controls ? `<button class="icon-button" data-action="goal-options" data-id="${escape(g.id)}" aria-label="Options for ${escape(g.name)}">${icon("ellipsis")}</button>` : ""}</div><p><span class="money">${money(current)}</span> <span class="muted">of ${money(g.target)}</span></p>${bar(current, g.target)}<small>${current >= g.target ? "Reached. Nice work." : `${money(g.target - current)} to go · ${percent}%`}</small></article>`;
  }
  function renderHome() {
    const t = C.totals(state),
      hour = new Date().getHours(),
      greeting =
        hour < 12
          ? "Good morning"
          : hour < 17
            ? "Good afternoon"
            : "Good evening",
      goal = state.goals.find((g) => C.progress(state, g.id) < g.target);
    return `${header("FOLD", greeting + (state.profile.name ? ", " + state.profile.name : ""), avatar())}<button class="card balance-card" data-action="nav" data-page="balance"><span class="row"><span class="kicker">BALANCE</span><span class="inline muted">Details ${icon("chevron-right")}</span></span><div class="display money">${money(t.balance)}</div><small>Tap to see how this number is made</small></button><section class="summary" aria-label="This month"><article class="spent"><p class="kicker">Spent</p><p class="display money">${money(t.monthSpent)}</p><small>This month</small></article><article class="saved"><p class="kicker">Saved</p><p class="display money">${money(t.monthSaved)}</p><small>This month</small></article></section>${state.profile.monthlySpendCap > 0 ? `<section class="cap"><div class="row"><span class="muted">Monthly spend cap</span><span class="money">${money(t.monthSpent)} <span class="muted">/ ${money(state.profile.monthlySpendCap)}</span></span></div>${bar(t.monthSpent, state.profile.monthlySpendCap, t.monthSpent / state.profile.monthlySpendCap >= 0.8 ? "over" : "")}</section>` : ""}<section><div class="section-title row"><h2>Recent activity</h2><button class="text-button" data-action="nav" data-page="history">View all</button></div>${state.transactions.length ? renderTransactions(sortedTransactions().slice(0, 5)) : '<div class="empty"><p>Nothing logged yet. Tap the plus button to write down a spend or a save.</p></div>'}</section>${goal ? `<section><div class="section-title row"><h2>Something to look forward to</h2><button class="text-button" data-action="nav" data-page="goals">See all</button></div>${goalCard(goal, false)}</section>` : ""}`;
  }
  function historyResults() {
    const rows = sortedTransactions().filter(
      (t) =>
        (filter === "all" || t.type === filter) &&
        `${t.note} ${t.category} ${t.amount} ${money(t.amount)}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    if (!rows.length)
      return (
        '<div class="empty">' +
        icon("search") +
        "<h2>No entries found</h2><p>Try another search or log something new.</p></div>"
      );
    let date = "";
    return rows
      .map((t) => {
        const heading =
          date !== t.date
            ? `<h2 class="date-heading">${relativeDate(t.date)}</h2>`
            : "";
        date = t.date;
        return heading + renderTransactions([t], true);
      })
      .join("");
  }
  function renderHistory() {
    return `${header("ACTIVITY", "History")}<div class="search-wrap">${icon("search")}<input class="search" id="history-search" type="search" aria-label="Search notes and amounts" placeholder="Search notes, amounts…" value="${escape(query)}"></div><div class="segments" aria-label="Filter activity">${["all", "spent", "saved"].map((f) => `<button data-action="filter" data-filter="${f}" aria-pressed="${filter === f}" class="${filter === f ? "active" : ""}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}</div><section id="history-results" aria-live="polite">${historyResults()}</section>`;
  }
  function renderGoals() {
    return `${header("SAVING FOR", "Goals", `<button class="primary compact" data-action="new-goal">${icon("plus")} New goal</button>`)}${state.goals.length ? state.goals.map((g) => goalCard(g)).join("") : `<div class="empty">${icon("target")}<h2>No goals yet</h2><p>Name something you are saving for.<br>When you log a save, you can put it toward that goal.</p></div>`}<div class="goal-banner"><h3>Save for what matters.</h3><p class="muted">Little by little, it adds up.<br>Give your next save something to work toward.</p><button class="primary" data-action="${state.goals.length ? "add" : "new-goal"}" data-type="saved">${icon("plus")} ${state.goals.length ? "Put money toward a goal" : "Create your first goal"}</button></div>`;
  }
  function setting(label, glyph, action, value = "", extra = "") {
    return `<button class="setting ${extra}" data-action="${action}">${icon(glyph)}<span>${label}</span>${value ? `<span class="setting-value">${escape(value)}</span>` : ""}${icon("chevron-right").replace("aria-hidden", 'class="chevron" aria-hidden')}</button>`;
  }
  function renderProfile() {
    return `${header("ACCOUNT", "You", avatar())}<div class="card profile-card"><span class="avatar large">${state.profile.name ? escape(state.profile.name[0].toUpperCase()) : icon("user")}</span><div><h2>${escape(state.profile.name || "Your name")}</h2>${state.profile.email ? `<p class="muted">${escape(state.profile.email)}</p>` : ""}<small>Saved to your account.</small></div></div><h2 class="settings-title">PERSONAL</h2><div class="settings-group">${setting("Your name", "user", "edit-name", state.profile.name || "Add your name")}${setting("Currency", "globe", "edit-currency", state.profile.currency)}</div><h2 class="settings-title">BUDGET</h2><div class="settings-group">${setting("Starting balance", "wallet", "edit-startingBalance", money(state.profile.startingBalance))}${setting("Monthly spend cap", "target", "edit-monthlySpendCap", state.profile.monthlySpendCap ? money(state.profile.monthlySpendCap) : "Not set")}</div><h2 class="settings-title">ACCOUNT</h2><div class="settings-group">${setting("Change password", "lock", "password")}${setting("Log out", "log-out", "logout", "", "danger")}</div><h2 class="settings-title">DATA</h2><div class="settings-group">${setting("Restore sample data", "rotate-ccw", "restore")}${setting("Clear everything", "trash-2", "clear", "", "danger")}</div><footer class="profile-footer"><div class="display">FOLD</div><p>Your money, simply kept.</p></footer>`;
  }
  function renderBalance() {
    const t = C.totals(state),
      max = Math.max(t.monthSpent, t.monthSaved, 1),
      groups = {};
    state.transactions
      .filter(
        (x) =>
          x.type === "spent" && x.date.startsWith(C.localDate().slice(0, 7)),
      )
      .forEach(
        (x) => (groups[x.category] = (groups[x.category] || 0) + x.amount),
      );
    return `<button class="back-link" data-action="nav" data-page="home">${icon("arrow-left")} Home</button><p class="kicker">YOUR BALANCE</p><h1 class="details-balance money" tabindex="-1">${money(t.balance)}</h1><p class="muted">Starting money, plus everything you saved,<br>minus everything you spent.</p><div class="card ledger">${[
      ["Starting amount", state.profile.startingBalance, ""],
      ["Saved, all time", t.saved, "saved"],
      ["Spent, all time", t.spent, "spent"],
      ["Current balance", t.balance, ""],
    ]
      .map(
        ([label, value, cls]) =>
          `<div class="row"><span>${label}</span><span class="money ${cls}">${cls === "spent" ? "−" : cls === "saved" ? "+" : ""}${money(value)}</span></div>`,
      )
      .join("")}</div><p class="kicker">THIS MONTH</p>${[
      ["Spent", t.monthSpent, "spent"],
      ["Saved", t.monthSaved, "saved"],
    ]
      .map(
        ([label, value, cls]) =>
          `<div class="bar-row ${cls}"><div class="row"><span>${label}</span><span>${money(value)}</span></div>${bar(value, max)}</div>`,
      )
      .join(
        "",
      )}<p class="kicker" style="margin-top:30px">WHERE SPENDING WENT</p>${
      Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([cat, value]) =>
            `<div class="bar-row spent"><div class="row"><span class="inline">${icon(categories[cat] || "ellipsis")} ${escape(cat)}</span><span>${money(value)}</span></div>${bar(value, t.monthSpent)}</div>`,
        )
        .join("") || '<p class="muted">No spending this month.</p>'
    }`;
  }
  function renderWelcome() {
    return `<section class="welcome">${brand()}<p class="welcome-description">A quiet way to track what you spend and save. Set goals, build better habits, and keep your money with you wherever you go.</p><div class="preview" aria-label="Preview of a Fold balance and savings goal"><div class="preview-panel"><p class="kicker">Balance</p><p class="display">₦55,500</p>${[
      ["Food", "Lunch", "−₦2,000", "spent"],
      ["Allowance", "Saved for books", "+₦5,000", "saved"],
      ["Transport", "Bus home", "−₦800", "spent"],
      ["Work", "Weekend job", "+₦10,000", "saved"],
    ]
      .map(
        ([cat, n, amount, type]) =>
          `<div class="mini-row"><span class="category-icon ${type}">${icon(categories[cat])}</span><b>${n}</b><span class="${type}">${amount}</span></div>`,
      )
      .join(
        "",
      )}</div><div class="preview-panel"><p class="kicker">Saving for</p><h3>School books</h3><p>₦5,000 <span class="muted">of ₦15,000</span></p>${bar(5000, 15000)}<small>33%</small><h3>New phone</h3><p>One save closer.</p></div></div><div class="welcome-actions"><button class="primary" data-action="nav" data-page="signup">Create a Fold account</button><button class="secondary" data-action="nav" data-page="login">Log in</button></div><footer>Your money, simply kept.</footer></section>`;
  }
  const googleMark =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.61 0-4.83-1.76-5.62-4.12H3.04v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.38 13.93a6 6 0 0 1 0-3.86V7.48H3.04a10 10 0 0 0 0 9.04Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z"/></svg>';
  function renderAuth(signup) {
    return `<button class="icon-button auth-back" data-action="nav" data-page="welcome" aria-label="Back to welcome">${icon("arrow-left")}</button>${brand()}<div class="auth-heading"><h1 tabindex="-1">${signup ? "Create your Fold" : "Welcome back"}</h1><p>${signup ? "Keep your money with you,<br>wherever you use Fold." : "Your money notebook is right<br>where you left it."}</p></div><button class="google" data-action="google">${googleMark} Continue with Google</button><div class="divider">or</div><form id="auth-form" class="auth-form"><label class="field">Email<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254"></label><label class="field">Password<span class="password-wrap"><input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="••••••••" required minlength="${signup ? 8 : 1}" maxlength="128"><button type="button" data-action="toggle-password" aria-label="Show password">${icon("eye")}</button></span></label>${signup ? "" : '<button type="button" class="forgot" data-action="forgot">Forgot password?</button>'}<p id="auth-error" class="error" role="alert"></p><button class="primary" type="submit">${signup ? "Create account" : "Log in"}</button></form>${signup ? '<p class="auth-legal">By creating an account, you agree to our<br><button class="link" data-action="terms">Terms of Service</button> and <button class="link" data-action="privacy">Privacy Policy</button>.</p>' : ""}<p class="auth-bottom">${signup ? "Already have a Fold account?" : "New to Fold?"} <button class="link" data-action="nav" data-page="${signup ? "login" : "signup"}">${signup ? "Log in" : "Create account"}</button></p>`;
  }
  const currencyOptions = (value) =>
    C.currencies
      .map(
        (c) =>
          `<option value="${c}" ${c === value ? "selected" : ""}>${c} — ${{ NGN: "Nigerian naira", USD: "US dollar", GBP: "British pound", EUR: "Euro", GHS: "Ghanaian cedi", KES: "Kenyan shilling" }[c]}</option>`,
      )
      .join("");
  function renderSetup() {
    const titles = [
        "Your everyday currency",
        "Start with what you have",
        "A little room to spend",
        "You're ready.",
      ],
      descriptions = [
        "Choose the currency for your notebook.",
        "The money you already have before you start logging.",
        "Optional. Fold can show how close you are to your limit.",
        "Your money, simply kept.",
      ];
    return `${brand()}<section class="setup"><div class="step-dots" aria-label="Step ${setupStep + 1} of 4">${[0, 1, 2, 3].map((i) => `<span class="${i <= setupStep ? "on" : ""}"></span>`).join("")}</div><h1 tabindex="-1">${titles[setupStep]}</h1><p>${descriptions[setupStep]}</p><form id="setup-form">${setupStep === 0 ? `<label class="field">Currency<select name="value">${currencyOptions(state.profile.currency)}</select></label>` : setupStep < 3 ? `<label class="field">${setupStep === 1 ? "Starting balance" : "Monthly spend cap"}<input name="value" type="number" inputmode="decimal" min="0" max="999999999" step="0.01" placeholder="0" ${setupStep === 1 ? "required" : ""} value="${state.profile[setupStep === 1 ? "startingBalance" : "monthlySpendCap"] || ""}"></label>` : ""}<button class="primary">${setupStep === 3 ? "Open Fold" : "Continue"} ${icon(setupStep === 3 ? "check" : "arrow-right")}</button>${setupStep === 2 ? '<button class="demo-link" style="width:100%" type="button" data-action="skip-cap">Skip for now</button>' : ""}</form></section>`;
  }
  function renderNavigation() {
    const visible = ["home", "history", "goals", "you", "balance"].includes(
      page,
    );
    $("#navigation").innerHTML = visible
      ? `<div class="dock"><nav aria-label="Main navigation">${[
          ["home", "house", "Home"],
          ["history", "clock", "History"],
          ["goals", "target", "Goals"],
          ["you", "user", "You"],
        ]
          .map(
            ([key, glyph, title]) =>
              `<button data-action="nav" data-page="${key}" class="${page === key || (page === "balance" && key === "home") ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${title}</span></button>`,
          )
          .join(
            "",
          )}</nav><button class="fab" data-action="add" aria-label="Add money">${icon("plus")}</button></div>`
      : "";
  }
  function render() {
    $("#app").className =
      `app ${["welcome", "signup", "login", "setup", "loading", "load-error", "reset-password"].includes(page) ? "auth-page" : ""}`;
    const views = {
      home: renderHome,
      history: renderHistory,
      goals: renderGoals,
      you: renderProfile,
      balance: renderBalance,
      welcome: renderWelcome,
      signup: () => renderAuth(true),
      login: () => renderAuth(false),
      setup: renderSetup,
      loading: renderLoading,
      "load-error": renderLoadError,
      "reset-password": renderResetPassword,
    };
    $("#app").innerHTML =
      (connectionError
        ? `<p class="error" role="alert">${escape(connectionError)}</p>`
        : "") + views[page]();
    renderNavigation();
    refreshIcons();
  }
  function openSheet(title, body, description = "") {
    lastFocus = document.activeElement;
    $("#sheet").innerHTML =
      `<div class="handle"></div><div class="sheet-header row"><div><h2 id="sheet-title">${escape(title)}</h2>${description ? `<p>${description}</p>` : ""}</div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon("x")}</button></div>${body}`;
    if (!$("#sheet").open) $("#sheet").showModal();
    refreshIcons();
  }
  function closeSheet() {
    $("#sheet").close();
    lastFocus?.isConnected && lastFocus.focus();
  }
  function confirmAction(title, text, action, id = "") {
    openSheet(
      title,
      `<p class="sheet-copy">${escape(text)}</p><div class="sheet-actions"><button class="primary destructive" data-action="${action}" data-id="${escape(id)}">${icon("trash-2")} ${title}</button><button class="secondary" data-action="close">Keep it</button></div>`,
    );
  }
  function info(title, text) {
    openSheet(
      title,
      `<p class="sheet-copy">${escape(text)}</p><button class="primary" data-action="close">Got it</button>`,
    );
  }
  function captureDraft() {
    const form = $("#money-form");
    if (form) {
      const values = new FormData(form);
      ["amount", "note", "date", "goalId"].forEach((k) => {
        if (values.has(k)) draft[k] = values.get(k);
      });
    }
  }
  function openMoney(type = "spent", fresh = true) {
    if (fresh)
      draft = {
        type,
        category: typeCategories[type][0],
        amount: "",
        note: "",
        date: C.localDate(),
        goalId: "",
      };
    openSheet(
      "Add money",
      `<div class="type-toggle">${["spent", "saved"].map((t) => `<button data-action="money-type" data-type="${t}" class="${draft.type === t ? "active " : ""}${t}" aria-pressed="${draft.type === t}">${icon(t === "spent" ? "circle-minus" : "circle-plus")} I ${t}</button>`).join("")}</div><form id="money-form" class="sheet-form" novalidate><label class="field">Amount<span class="amount-wrap"><span>${symbols[state.profile.currency]}</span><input name="amount" id="money-amount" aria-describedby="amount-words money-error" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${escape(draft.amount)}"></span></label><p class="amount-words" id="amount-words">${draft.amount ? C.numberToWords(Number(String(draft.amount).replace(/,/g, ""))) : "Type how much, then save"}</p><fieldset><legend>Category</legend><div class="chips">${typeCategories[draft.type].map((c) => `<button type="button" data-action="category" data-category="${c}" class="${draft.category === c ? "active" : ""}" aria-pressed="${draft.category === c}">${icon(categories[c])} ${c}</button>`).join("")}</div></fieldset>${draft.type === "saved" && state.goals.length ? `<label class="field">Put toward a goal<select name="goalId"><option value="">Just save it</option>${state.goals.map((g) => `<option value="${escape(g.id)}" ${draft.goalId === g.id ? "selected" : ""}>${escape(g.name)} (${money(C.progress(state, g.id))} of ${money(g.target)})</option>`).join("")}</select></label>` : ""}<label class="field">Note <span class="muted">(optional)</span><input name="note" maxlength="120" placeholder="${draft.type === "spent" ? "e.g. Lunch with friends" : "e.g. A little put away"}" value="${escape(draft.note)}"></label><label class="field">Date<input name="date" type="date" required value="${escape(draft.date)}" max="9999-12-31"></label><p id="money-error" class="error" role="alert"></p><button type="submit" class="primary">${icon("check")} Save</button></form>`,
      "Write down what you spent or saved.<br>The totals update right away.",
    );
  }
  function openGoal() {
    openSheet(
      "A goal worth saving for",
      `<form id="goal-form" class="sheet-form"><label class="field">What is it for?<input name="name" placeholder="e.g. School books" maxlength="60" required></label><label class="field">Target amount (${symbols[state.profile.currency]})<input name="target" type="number" inputmode="decimal" min="0.01" max="999999999" step="0.01" placeholder="15,000" required></label><p class="error" id="goal-error" role="alert"></p><button class="primary">${icon("check")} Save goal</button></form>`,
      "Give your savings a purpose.",
    );
  }
  function openEdit(field) {
    const names = {
        name: "Your name",
        currency: "Currency",
        startingBalance: "Starting balance",
        monthlySpendCap: "Monthly spend cap",
      },
      value = state.profile[field];
    openSheet(
      names[field],
      `<form id="profile-form" data-field="${field}" class="sheet-form"><label class="field">${names[field]}${field === "currency" ? `<select name="value">${currencyOptions(value)}</select>` : `<input name="value" type="${field === "name" ? "text" : "number"}" value="${escape(value)}" ${field === "name" ? 'maxlength="40" autocomplete="given-name"' : 'min="0" max="999999999" step="0.01" required inputmode="decimal"'}>`}</label><button class="primary">Save changes</button></form>`,
      field === "currency"
        ? "Amounts keep their numeric value. Fold does not convert exchange rates."
        : field === "monthlySpendCap"
          ? "Set to 0 to turn off your monthly cap."
          : "",
    );
  }
  async function handleAction(button) {
    const action = button.dataset.action,
      id = button.dataset.id;
    if (action === "nav") go(button.dataset.page);
    else if (action === "close") closeSheet();
    else if (action === "retry") await boot();
    else if (action === "add") openMoney(button.dataset.type || "spent");
    else if (action === "money-type") {
      captureDraft();
      draft.type = button.dataset.type;
      draft.category = typeCategories[draft.type][0];
      openMoney(draft.type, false);
    } else if (action === "category") {
      draft.category = button.dataset.category;
      $("#sheet .chips")
        .querySelectorAll("button")
        .forEach((b) => {
          b.classList.toggle("active", b === button);
          b.setAttribute("aria-pressed", String(b === button));
        });
    } else if (action === "filter") {
      filter = button.dataset.filter;
      render();
    } else if (action === "new-goal") openGoal();
    else if (action === "goal-options") {
      const g = state.goals.find((x) => x.id === id);
      if (!g) return;
      openSheet(
        g.name,
        `<p class="sheet-copy">${money(C.progress(state, id))} saved toward ${money(g.target)}.</p><div class="sheet-actions"><button class="primary" data-action="allocate" data-id="${escape(id)}">${icon("plus")} Add a save</button><button class="secondary danger" data-action="delete-goal" data-id="${escape(id)}">${icon("trash-2")} Delete goal</button></div>`,
      );
    } else if (action === "allocate") {
      openMoney("saved");
      draft.goalId = id;
      openMoney("saved", false);
    } else if (action === "delete-goal")
      confirmAction(
        "Delete this goal?",
        "Your saved entries will stay in your account, without a goal attached.",
        "confirm-goal",
        id,
      );
    else if (action === "confirm-goal")
      await runPending(button, () =>
        write(
          (r) => r.deleteGoal(id),
          () => C.deleteGoal(state, id),
          "Goal deleted. Your savings are still here.",
        ),
      );
    else if (action === "transaction") {
      const t = state.transactions.find((x) => x.id === id);
      if (!t) return;
      const g = state.goals.find((x) => x.id === t.goalId);
      openSheet(
        t.note || t.category,
        `<div class="display details-balance ${t.type}">${t.type === "spent" ? "−" : "+"}${money(t.amount)}</div><p class="muted">${escape(t.category)} · ${relativeDate(t.date)}</p>${g ? `<p class="sheet-copy">Put toward ${escape(g.name)}</p>` : ""}<div class="sheet-actions"><button class="secondary danger" data-action="delete-entry" data-id="${escape(id)}">${icon("trash-2")} Delete this entry</button></div>`,
      );
    } else if (action === "delete-entry")
      confirmAction(
        "Delete this entry?",
        "This removes the entry from your account. Your balance and linked goal will update.",
        "confirm-entry",
        id,
      );
    else if (action === "confirm-entry")
      await runPending(button, () =>
        write(
          (r) => r.deleteTransaction(id),
          () => {
            state.transactions = state.transactions.filter((t) => t.id !== id);
          },
          "Entry deleted. Totals updated.",
        ),
      );
    else if (action.startsWith("edit-")) openEdit(action.slice(5));
    else if (action === "toggle-password") {
      const input = button.parentElement.querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
      button.setAttribute(
        "aria-label",
        input.type === "password" ? "Show password" : "Hide password",
      );
      button.innerHTML = icon(input.type === "password" ? "eye" : "eye-off");
      refreshIcons();
    } else if (action === "google")
      await runPending(button, () => requireAuth().google(), $("#auth-error"));
    else if (action === "forgot")
      openSheet(
        "Forgot password?",
        `<p class="sheet-copy">We’ll send you a link to choose a new password. Open it in this browser.</p><form id="recovery-form"><label class="field">Email<input type="email" name="email" placeholder="you@example.com" autocomplete="email" required maxlength="254"></label><p class="error" role="alert"></p><button class="primary">Send reset link</button></form>`,
      );
    else if (action === "password")
      openSheet(
        "Change password",
        passwordForm(),
        "Use at least 8 characters. A security code may be required.",
      );
    else if (action === "reauthenticate")
      await runPending(
        button,
        async () => {
          await requireAuth().reauthenticate();
          const p = $("#password-error");
          p.textContent = "Check your email or phone for the security code.";
        },
        $("#password-error"),
      );
    else if (action === "terms")
      info(
        "Terms of Service",
        "Fold is a personal record of the amounts you enter. It does not move money or connect to your bank. The operator must publish final service terms before public launch.",
      );
    else if (action === "privacy")
      info(
        "Your privacy",
        "Your account is managed by Supabase Auth. Financial entries and settings are stored in your account’s database records. Fold does not store your password in browser storage. The Supabase client manages your session on this device. Google Fonts loads the interface fonts. The operator must publish their full privacy policy before public launch.",
      );
    else if (action === "logout")
      await runPending(button, async () => {
        await requireAuth().signOut();
        eraseUser();
        recovery = false;
        authStatus = "SIGNED_OUT";
        cleanCallback();
        page = "welcome";
        render();
        showToast("Logged out.");
      });
    else if (action === "restore")
      confirmAction(
        "Restore sample data?",
        "This permanently replaces all your account’s entries and goals with sample records, and resets your currency and budget to the NGN example. Your name and sign-in account stay unchanged.",
        "confirm-restore",
      );
    else if (action === "clear")
      confirmAction(
        "Clear everything?",
        "This permanently removes your account’s entries, goals, name, and budget settings on every device. Your sign-in account remains. This cannot be undone.",
        "confirm-clear",
      );
    else if (action === "confirm-restore" || action === "confirm-clear")
      await runPending(button, async () => {
        const ticket = epoch,
          repository = repo,
          user = currentUser;
        if (!repository || !user) throw new Error("Please log in again.");
        await repository.replaceNotebook(
          action === "confirm-restore",
          C.localDate(),
        );
        if (ticket !== epoch) return;
        // The reset committed. Hide the old notebook while fetching authoritative rows.
        closeSheet();
        state = emptyState();
        page = "loading";
        render();
        try {
          const fresh = await repository.load(user);
          if (ticket !== epoch) return;
          state = fresh;
          setupStep = 0;
          authStatus = state.setupComplete
            ? "SIGNED_IN"
            : "ONBOARDING_REQUIRED";
          go(state.setupComplete ? "you" : "setup");
          showToast(
            action === "confirm-restore"
              ? "Sample notebook saved to your account."
              : "Your notebook has been cleared.",
          );
        } catch (error) {
          if (ticket !== epoch) return;
          loadError =
            "Your change was saved, but the notebook could not reload. Try again.";
          page = "load-error";
          render();
        }
      });
    else if (action === "skip-cap")
      await runPending(button, async () => {
        const ticket = epoch;
        const result = await repo.updateProfile({ monthlySpendCap: 0 });
        if (ticket !== epoch) return;
        state.profile = { ...state.profile, ...result.profile };
        setupStep = 3;
        render();
      });
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || pending) return;
    handleAction(button).catch((error) => showToast(errorMessage(error)));
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "history-search") {
      query = event.target.value;
      $("#history-results").innerHTML = historyResults();
      refreshIcons();
    }
    if (event.target.id === "money-amount") {
      const raw = event.target.value.replace(/,/g, "");
      $("#amount-words").textContent = raw
        ? C.numberToWords(raw) || "Enter an amount below one billion"
        : "Type how much, then save";
    }
  });
  document.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pending) return;
    const form = event.target,
      data = new FormData(form),
      button = event.submitter || form.querySelector(".primary");
    runPending(
      button,
      async () => {
        if (form.id === "money-form") {
          const raw = String(data.get("amount")).replace(/,/g, "").trim(),
            amount = Number(raw),
            date = String(data.get("date"));
          if (
            !/^\d+(\.\d{1,2})?$/.test(raw) ||
            amount <= 0 ||
            amount > 999999999
          )
            throw new Error(
              "Enter an amount first (up to two decimal places).",
            );
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(new Date(date + "T12:00:00").getTime()) ||
            C.localDate(new Date(date + "T12:00:00")) !== date
          )
            throw new Error("Choose a valid date.");
          draft.id ||= C.id();
          const entry = {
            id: draft.id,
            type: draft.type,
            amount,
            category: draft.category,
            note: String(data.get("note")).trim(),
            date,
            goalId: draft.type === "saved" ? data.get("goalId") || null : null,
          };
          await write(
            (r) => r.createTransaction(entry),
            (row) => {
              state.transactions = state.transactions.filter(
                (t) => t.id !== row.id,
              );
              state.transactions.push(row);
            },
            `Logged as ${entry.type}`,
          );
        } else if (form.id === "goal-form") {
          const name = String(data.get("name")).trim(),
            target = Number(data.get("target"));
          if (
            !name ||
            !Number.isFinite(target) ||
            target <= 0 ||
            target > 999999999
          )
            throw new Error("Add a name and a target greater than zero.");
          form.dataset.id ||= C.id();
          await write(
            (r) => r.createGoal({ id: form.dataset.id, name, target }),
            (row) => {
              state.goals = state.goals.filter((g) => g.id !== row.id);
              state.goals.push(row);
            },
            "Goal created. One step closer.",
          );
        } else if (form.id === "profile-form") {
          const key = form.dataset.field,
            value = ["startingBalance", "monthlySpendCap"].includes(key)
              ? Number(data.get("value"))
              : String(data.get("value")).trim();
          await write(
            (r) => r.updateProfile({ [key]: value }),
            (result) => {
              state.profile = { ...state.profile, ...result.profile };
            },
            "Changes saved.",
          );
        } else if (form.id === "auth-form") {
          const signup = page === "signup";
          const result = await (signup
            ? requireAuth().signUp(
                String(data.get("email")).trim(),
                String(data.get("password")),
              )
            : requireAuth().signIn(
                String(data.get("email")).trim(),
                String(data.get("password")),
              ));
          form.querySelector("[name=password]").value = "";
          if (signup && !result.session)
            info(
              "Check your email",
              "If this address can be registered, a confirmation link is on its way. Open it in this browser, then return to Fold. If you already have an account, log in or reset your password.",
            );
          else if (result.session) await activateSession(result.session);
          else throw new Error("No session was created. Please log in again.");
        } else if (form.id === "setup-form") {
          const ticket = epoch,
            patch =
              setupStep === 0
                ? { currency: data.get("value") }
                : setupStep === 1
                  ? { startingBalance: Number(data.get("value")) }
                  : setupStep === 2
                    ? { monthlySpendCap: Number(data.get("value") || 0) }
                    : { setupComplete: true };
          const result = await repo.updateProfile(patch);
          if (ticket !== epoch) return;
          state.profile = { ...state.profile, ...result.profile };
          state.setupComplete = result.setupComplete;
          if (setupStep === 3) {
            authStatus = "SIGNED_IN";
            go("home");
          } else {
            setupStep++;
            render();
          }
        } else if (form.id === "recovery-form") {
          await requireAuth().recover(String(data.get("email")).trim());
          info(
            "Check your email",
            "If an account matches that address, you’ll receive a password reset link. Open it in this browser to continue.",
          );
        } else if (form.id === "password-form") {
          const password = String(data.get("password"));
          if (password !== data.get("confirmation"))
            throw new Error("The passwords do not match.");
          if (password.length < 8)
            throw new Error("Use at least 8 characters.");
          const ticket = epoch;
          await requireAuth().updatePassword(
            password,
            String(data.get("nonce") || "").trim(),
          );
          if (ticket !== epoch) return;
          form.reset();
          closeSheet();
          if (recovery) {
            recovery = false;
            cleanCallback();
            await activateSession(await auth.restore(), true);
          }
          showToast("Password updated.");
        }
      },
      form.querySelector(".error"),
    );
  });
  $("#sheet").addEventListener("cancel", (event) => {
    if (pending) event.preventDefault();
  });
  $("#sheet").addEventListener("click", (event) => {
    if (pending) return;
    if (event.target === $("#sheet")) {
      const r = $("#sheet").getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        closeSheet();
    }
  });
  // Return from another device/tab: refresh on focus, without discarding an open form.
  window.addEventListener("focus", () => {
    const ticket = epoch;
    if (
      currentUser &&
      !pending &&
      !$("#sheet").open &&
      page !== "setup" &&
      page !== "reset-password"
    )
      auth
        .restore()
        .then((session) => { if (ticket === epoch) return activateSession(session, true); })
        .catch(() => {
          if (ticket !== epoch) return;
          loadError = "Couldn’t refresh your Fold. Try again.";
          page = "load-error";
          render();
        });
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) boot();
  });
  render();
  boot();
})();
