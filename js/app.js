/* NectarSpend: approved views, backed by Supabase authentication and user-owned data. */
(() => {
  "use strict";
  const C = { ...NectarCore, ...NectarRecords };
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
  Object.assign(categories, {
    Salary: "briefcase",
    Shopping: "shopping-bag",
    Entertainment: "gamepad-2",
    Savings: "target",
    Sales: "store",
    Stock: "package",
    Delivery: "truck",
    Rent: "building",
    Utilities: "receipt",
    Wages: "users",
    "Owner funding": "banknote",
    Loan: "notebook",
    "Owner draw": "user",
    "Loan repayment": "receipt",
  });
  let activityCategory = "",
    dateFrom = "",
    dateTo = "",
    summaryPeriod = "month",
    summaryDate = C.localDate();
  const emptyState = () => ({
    profile: {
      name: "",
      email: "",
      currency: "NGN",
      startingBalance: 0,
      monthlySpendCap: 0,
    },
    workspaces: [],
    workspace: null,
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
    if (error?.code || error?.status || !(error instanceof Error))
      return "Couldn’t complete this request. Check your connection and try again.";
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
    activityCategory = "";
    dateFrom = "";
    dateTo = "";
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
    return `${brand()}<section class="empty" role="status"><p>Loading your NectarSpend…</p></section>`;
  }
  function renderLoadError() {
    return `${brand()}<section class="empty"><h1 tabindex="-1">A moment, please.</h1><p class="error" role="alert">${escape(loadError)}</p><button class="primary" data-action="retry">Try again</button><button class="link" data-action="logout">Log out</button></section>`;
  }
  function passwordForm(recovering = false) {
    return `<form id="password-form" class="sheet-form"><label class="field">New password<span class="password-wrap"><input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="At least 8 characters"><button type="button" data-action="toggle-password" aria-label="Show password">${icon("eye")}</button></span></label><label class="field">Confirm password<input type="password" name="confirmation" autocomplete="new-password" minlength="8" maxlength="128" required></label>${recovering ? "" : `<label class="field">Security code <span class="muted">(if requested)</span><input name="nonce" inputmode="numeric" autocomplete="one-time-code" maxlength="12"></label><button type="button" class="link" data-action="reauthenticate">Send a security code</button>`}<p class="error" role="alert" id="password-error"></p><button class="primary">Save new password</button></form>`;
  }
  function renderResetPassword() {
    return `${brand()}<div class="auth-heading"><h1 tabindex="-1">A fresh start</h1><p>Choose a new password for your NectarSpend.</p></div>${passwordForm(true)}<button class="link" data-action="logout">Cancel and log out</button>`;
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
      force &&
      ["home", "history", "goals", "you", "balance", "records"].includes(page)
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
        const repository = NectarData.createRepository(backend.client, id);
        if (recovery) {
          currentUser = user;
          repo = repository;
          authStatus = "SIGNED_IN";
          cleanCallback(true);
          page = "reset-password";
          render();
          return;
        }
        const notebook = await repository.load(
          user,
          preferredWorkspace(user.id),
        );
        if (ticket !== epoch) return;
        state = notebook;
        setupStep = state.workspaces.length ? 1 : 0;
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
        backend = NectarBackend.connect(
          window.NECTARSPEND_CONFIG || window.FOLD_CONFIG,
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
      [
        "home",
        "history",
        "goals",
        "you",
        "balance",
        "records",
        "setup",
      ].includes(next) &&
      !currentUser
    )
      next = "welcome";
    if (
      currentUser &&
      !state.setupComplete &&
      ["home", "history", "goals", "you", "balance", "records"].includes(next)
    )
      next = "setup";
    if (next === "goals" && business()) next = "records";
    page = next;
    render();
    window.scrollTo(0, 0);
    $("#app h1")?.focus({ preventScroll: true });
  }
  function header(kicker, title, action = "") {
    return `<header class="page-header row"><div><p class="kicker">${kicker}</p><h1 tabindex="-1">${escape(title)}</h1></div>${action}</header>`;
  }
  const brand = () =>
    '<div class="brand"><div class="display">NectarSpend</div><p>Know your money.</p></div>';
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
      .map((t) => {
        const kind = C.kindOf(t),
          style = kind === "expense" ? "spent" : "saved";
        return `<button class="transaction" data-action="transaction" data-id="${escape(t.id)}"><span class="category-icon ${style}">${icon(categories[t.category] || "receipt")}</span><span class="transaction-body"><span class="transaction-copy"><span class="transaction-title">${escape(t.note || t.category)}</span><small>${kind === "saving" ? "Savings allocation" : escape(t.category)}${kind === "income" && C.isSavings(t) ? " · savings" : ""}</small></span><span class="transaction-amount"><span class="${style}">${kind === "expense" ? "−" : kind === "income" ? "+" : ""}${money(t.amount)}</span><small>${history ? new Date(t.createdAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" }) : relativeDate(t.date)}</small></span></span></button>`;
      })
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
    return `${workspaceControl()}${header("NectarSpend", greeting + (state.profile.name ? ", " + state.profile.name : ""), avatar())}<button class="card balance-card" data-action="nav" data-page="balance"><span class="row"><span class="kicker">${business() ? "RECORDED CASH BALANCE" : "CALCULATED BALANCE"}</span><span class="inline muted">Details ${icon("chevron-right")}</span></span><div class="display money">${money(t.balance)}</div><small>Based on your records. No money is held here.</small></button><section class="summary" aria-label="This month"><article class="saved"><p class="kicker">Money in</p><p class="display money">${money(t.monthIncome)}</p><small>This month</small></article><article class="spent"><p class="kicker">Money out</p><p class="display money">${money(t.monthSpent)}</p><small>This month</small></article></section>${business() ? "" : `<div class="savings-line row"><span>Recorded savings <small>(all time)</small></span><span class="saved money">${money(t.saved)}</span></div>`}${!business() && state.profile.monthlySpendCap > 0 ? `<section class="cap"><div class="row"><span class="muted">Monthly spending cap</span><span>${money(t.monthSpent)} <span class="muted">/ ${money(state.profile.monthlySpendCap)}</span></span></div>${bar(t.monthSpent, state.profile.monthlySpendCap, t.monthSpent / state.profile.monthlySpendCap >= 0.8 ? "over" : "")}<small>${t.monthSpent > state.profile.monthlySpendCap ? "Above your recorded spending limit" : "Within your recorded spending limit"}</small></section>` : ""}<div class="section-title row"><h2>Recent records</h2><button class="text-button" data-action="nav" data-page="history">View all</button></div>${state.transactions.length ? renderTransactions(sortedTransactions().slice(0, 5)) : '<div class="empty"><p>No records yet. Use the plus button to record money in or money out.</p></div>'}<button class="setting summary-link" data-action="nav" data-page="records">${icon("chart-no-axes-column")} Weekly & monthly summaries ${icon("chevron-right")}</button>${!business() && goal ? `<div class="section-title row"><h2>Savings goals</h2><button class="text-button" data-action="nav" data-page="goals">See all</button></div>${goalCard(goal, false)}` : ""}`;
  }

  function historyResults() {
    const rows = sortedTransactions().filter(
      (t) =>
        (filter === "all" ||
          (filter === "saving" ? C.isSavings(t) : C.kindOf(t) === filter)) &&
        (!activityCategory || t.category === activityCategory) &&
        (!dateFrom || t.date >= dateFrom) &&
        (!dateTo || t.date <= dateTo) &&
        `${t.note} ${t.category} ${t.amount} ${money(t.amount)}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    if (dateFrom && dateTo && dateFrom > dateTo)
      return '<p class="error">Choose an end date on or after the start date.</p>';
    if (!rows.length)
      return '<div class="empty"><h2>No matching records</h2><p>Try different filters or record a new entry.</p></div>';
    let date = "";
    return rows
      .map((t) => {
        const h =
          date !== t.date
            ? `<h2 class="date-heading">${relativeDate(t.date)}</h2>`
            : "";
        date = t.date;
        return h + renderTransactions([t], true);
      })
      .join("");
  }

  function renderHistory() {
    const cats = [...new Set(state.transactions.map((t) => t.category))].sort();
    return `${workspaceControl()}${header("YOUR RECORDS", "Activity")}<div class="search-wrap">${icon("search")}<input id="history-search" class="search" type="search" aria-label="Search notes and amounts" placeholder="Search notes, amounts…" value="${escape(query)}"></div><div class="segments">${[["all", "All"], ["income", "Money in"], ["expense", "Money out"], ...(!business() ? [["saving", "Savings"]] : [])].map(([key, label]) => `<button data-action="filter" data-filter="${key}" aria-pressed="${filter === key}" class="${filter === key ? "active" : ""}">${label}</button>`).join("")}</div><details class="activity-filters" ${activityCategory || dateFrom || dateTo ? "open" : ""}><summary>Category & dates</summary><label class="field">Category<select id="activity-category"><option value="">All categories</option>${cats.map((c) => `<option ${activityCategory === c ? "selected" : ""}>${escape(c)}</option>`).join("")}</select></label><div class="date-filters"><label class="field">From<input id="date-from" type="date" value="${escape(dateFrom)}"></label><label class="field">To<input id="date-to" type="date" value="${escape(dateTo)}"></label></div><button class="link" data-action="reset-filters">Reset filters</button></details><section id="history-results" aria-live="polite">${historyResults()}</section>`;
  }

  function renderGoals() {
    return `${header("SAVING FOR", "Goals", `<button class="primary compact" data-action="new-goal">${icon("plus")} New goal</button>`)}${state.goals.length ? state.goals.map((g) => goalCard(g)).join("") : `<div class="empty">${icon("target")}<h2>No goals yet</h2><p>Name something you are saving for.<br>When you record savings, you can put it toward that goal.</p></div>`}<div class="goal-banner"><h3>Save for what matters.</h3><p class="muted">Little by little, it adds up.<br>Give your next save something to work toward.</p><button class="primary" data-action="${state.goals.length ? "record-savings" : "new-goal"}" data-type="saved">${icon("plus")} ${state.goals.length ? "Record savings" : "Create your first goal"}</button></div>`;
  }
  function setting(label, glyph, action, value = "", extra = "") {
    return `<button class="setting ${extra}" data-action="${action}">${icon(glyph)}<span>${label}</span>${value ? `<span class="setting-value">${escape(value)}</span>` : ""}${icon("chevron-right").replace("aria-hidden", 'class="chevron" aria-hidden')}</button>`;
  }
  function renderProfile() {
    return `${workspaceControl()}${header("ACCOUNT", "You", avatar())}<div class="card profile-card"><span class="avatar large">${state.profile.name ? escape(state.profile.name[0].toUpperCase()) : icon("user")}</span><div><h2>${escape(state.profile.name || "Your name")}</h2><p class="muted">${escape(state.profile.email)}</p><small>Records saved to your account.</small></div></div><h2 class="settings-title">PERSONAL</h2><div class="settings-group">${setting("Your name", "user", "edit-name", state.profile.name || "Add your name")}</div><h2 class="settings-title">${escape(state.workspace.name.toUpperCase())}</h2><div class="settings-group">${setting("Currency", "globe", "edit-currency", state.profile.currency)}${setting("Starting balance", "notebook", "edit-startingBalance", money(state.profile.startingBalance))}${!business() ? setting("Monthly spending cap", "target", "edit-monthlySpendCap", state.profile.monthlySpendCap ? money(state.profile.monthlySpendCap) : "Not set") : ""}${setting("Workspaces", "layers", "workspaces")}</div><h2 class="settings-title">ACCOUNT</h2><div class="settings-group">${setting("Change password", "lock", "password")}${setting("Log out", "log-out", "logout", "", "danger")}</div><footer class="profile-footer"><div class="display">NectarSpend</div><p>Know your money.</p><p>No money moves through NectarSpend.</p></footer>`;
  }

  function renderBalance() {
    const t = C.totals(state);
    return `<button class="back-link" data-action="nav" data-page="home">${icon("arrow-left")} Home</button><p class="kicker">CALCULATED FROM RECORDS</p><h1 class="details-balance money">${money(t.balance)}</h1><p class="muted">Starting balance, plus recorded income, minus recorded expenses. Savings allocations do not add money to this balance.</p><div class="card ledger">${[
      ["Starting balance", state.profile.startingBalance, ""],
      ["Income, all time", t.income, "saved"],
      ["Expenses, all time", t.spent, "spent"],
      ["Calculated balance", t.balance, ""],
    ]
      .map(
        ([label, value, cls]) =>
          `<div class="row"><span>${label}</span><span class="${cls} money">${money(value)}</span></div>`,
      )
      .join(
        "",
      )}</div><button class="secondary" data-action="nav" data-page="records">View summaries</button>`;
  }

  function renderWelcome() {
    return `<section class="welcome">${brand()}<p class="welcome-description">Record what came in. Record what went out. Understand your personal or business money, one record at a time.</p><div class="preview" aria-label="Example records and savings goals"><div class="preview-panel"><p class="kicker">Example balance</p><p class="display">₦55,500</p>${[
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
      )}</div><div class="preview-panel"><p class="kicker">Saving for</p><h3>School books</h3><p>₦5,000 <span class="muted">of ₦15,000</span></p>${bar(5000, 15000)}<small>33%</small><h3>New phone</h3><p>One record closer.</p></div></div><div class="welcome-actions"><button class="primary" data-action="nav" data-page="signup">Create a NectarSpend account</button><button class="secondary" data-action="nav" data-page="login">Log in</button></div><footer>Know your money.</footer></section>`;
  }
  const googleMark =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.61 0-4.83-1.76-5.62-4.12H3.04v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.38 13.93a6 6 0 0 1 0-3.86V7.48H3.04a10 10 0 0 0 0 9.04Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z"/></svg>';
  function renderAuth(signup) {
    return `<button class="icon-button auth-back" data-action="nav" data-page="welcome" aria-label="Back to welcome">${icon("arrow-left")}</button>${brand()}<div class="auth-heading"><h1 tabindex="-1">${signup ? "Create your account" : "Welcome back"}</h1><p>${signup ? "Keep your records with you,<br>wherever you use NectarSpend." : "Your records are right<br>where you left them."}</p></div><button class="google" data-action="google">${googleMark} Continue with Google</button><div class="divider">or</div><form id="auth-form" class="auth-form"><label class="field">Email<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254"></label><label class="field">Password<span class="password-wrap"><input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="••••••••" required minlength="${signup ? 8 : 1}" maxlength="128"><button type="button" data-action="toggle-password" aria-label="Show password">${icon("eye")}</button></span></label>${signup ? "" : '<button type="button" class="forgot" data-action="forgot">Forgot password?</button>'}<p id="auth-error" class="error" role="alert"></p><button class="primary" type="submit">${signup ? "Create account" : "Log in"}</button></form>${signup ? '<p class="auth-legal">By creating an account, you agree to our<br><button class="link" data-action="terms">Terms of Service</button> and <button class="link" data-action="privacy">Privacy Policy</button>.</p>' : ""}<p class="auth-bottom">${signup ? "Already have a NectarSpend account?" : "New to NectarSpend?"} <button class="link" data-action="nav" data-page="${signup ? "login" : "signup"}">${signup ? "Log in" : "Create account"}</button></p>`;
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
        "How will you use NectarSpend?",
        "Your everyday currency",
        "Start with your records",
        "A little room to spend",
        "You're ready.",
      ],
      descriptions = [
        "Choose Personal, Business, or Both. You can add more workspaces later.",
        `Currency for ${state.workspace?.name || "your workspace"}.`,
        "Enter the balance you had before these records.",
        "Optional. Track your monthly personal spending limit.",
        "Know your money.",
      ];
    return `${brand()}<section class="setup"><div class="step-dots" aria-label="Step ${setupStep + 1} of 5">${[0, 1, 2, 3, 4].map((i) => `<span class="${i <= setupStep ? "on" : ""}"></span>`).join("")}</div><h1 tabindex="-1">${titles[setupStep]}</h1><p>${escape(descriptions[setupStep])}</p><form id="setup-form">${setupStep === 0 ? '<label class="field">Use NectarSpend for<select name="value"><option value="personal">Personal</option><option value="business">Business</option><option value="both">Both</option></select></label>' : setupStep === 1 ? `<label class="field">Currency<select name="value">${currencyOptions(state.profile.currency)}</select></label>` : setupStep < 4 ? `<label class="field">${setupStep === 2 ? "Starting balance" : "Monthly spending cap"}<input name="value" type="number" inputmode="decimal" min="0" max="999999999" step="0.01" value="${state.profile[setupStep === 2 ? "startingBalance" : "monthlySpendCap"] || 0}" required></label>` : ""}<p class="error" role="alert"></p><button class="primary">${setupStep === 4 ? "Continue to workspace" : "Continue"} ${icon("arrow-right")}</button>${setupStep === 3 ? '<button type="button" class="link" data-action="skip-cap">Skip for now</button>' : ""}</form><button class="link" data-action="logout">Log out</button></section>`;
  }

  function renderNavigation() {
    const visible = [
      "home",
      "history",
      "goals",
      "you",
      "balance",
      "records",
    ].includes(page);
    $("#navigation").innerHTML = visible
      ? `<div class="dock"><nav aria-label="Main navigation">${[["home", "house", "Home"], ["history", "clock", "Activity"], business() ? ["records", "notebook-pen", "Records"] : ["goals", "target", "Goals"], ["you", "user", "You"]].map(([key, glyph, title]) => `<button data-action="nav" data-page="${key}" class="${page === key ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${title}</span></button>`).join("")}</nav><button class="fab" data-action="add" aria-label="Add record">${icon("plus")}</button></div>`
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
      records: renderRecords,
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
    const kind = type === "spent" ? "expense" : "income",
      choices = C.categories[business() ? "business" : "personal"];
    if (fresh)
      draft = {
        type,
        kind,
        category: choices[kind][0],
        amount: "",
        note: "",
        date: C.localDate(),
        goalId: "",
        isSavings: false,
      };
    const allocation = draft.kind === "saving",
      cats = allocation
        ? ["Savings"]
        : choices[draft.type === "spent" ? "expense" : "income"];
    if (!cats.includes(draft.category)) draft.category = cats[0];
    openSheet(
      draft.edit ? "Edit record" : "Add record",
      `<div class="type-toggle">${[
        ["saved", "Money in"],
        ["spent", "Money out"],
      ]
        .map(
          ([t, label]) =>
            `<button data-action="money-type" data-type="${t}" class="${draft.type === t ? "active " : ""}${t}" aria-pressed="${draft.type === t}">${icon(t === "spent" ? "circle-minus" : "circle-plus")} ${label}</button>`,
        )
        .join(
          "",
        )}</div><form id="money-form" class="sheet-form" novalidate><label class="field">Amount<span class="amount-wrap"><span>${symbols[state.profile.currency]}</span><input id="money-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" value="${escape(draft.amount)}" placeholder="0" aria-describedby="amount-words money-error"></span></label><p id="amount-words" class="amount-words">${draft.amount ? C.numberToWords(Number(String(draft.amount).replace(/,/g, ""))) : "Type the amount to record"}</p>${!business() && draft.type === "saved" ? `<label class="check-field"><input type="checkbox" name="isSavings" id="record-savings" ${draft.isSavings ? "checked" : ""}> Record as savings</label>${draft.isSavings ? `<label class="field">Savings source<select name="source" id="savings-source"><option value="income" ${!allocation ? "selected" : ""}>From this new income</option><option value="saving" ${allocation ? "selected" : ""}>From my existing balance</option></select></label><p class="muted summary-note">${allocation ? "An allocation only. This does not increase or decrease your calculated balance." : "This amount counts once as income, and is also marked as savings."}</p>` : ""}` : ""}<fieldset><legend>Category</legend><div class="chips">${cats.map((c) => `<button type="button" data-action="category" data-category="${escape(c)}" class="${c === draft.category ? "active" : ""}" aria-pressed="${c === draft.category}">${icon(categories[c] || "receipt")} ${escape(c)}</button>`).join("")}</div></fieldset>${draft.isSavings && state.goals.length ? `<label class="field">Savings goal <span class="muted">(optional)</span><select name="goalId"><option value="">No goal</option>${state.goals.map((g) => `<option value="${escape(g.id)}" ${draft.goalId === g.id ? "selected" : ""}>${escape(g.name)}</option>`).join("")}</select></label>` : ""}<label class="field">Note <span class="muted">(optional)</span><input name="note" maxlength="120" placeholder="What was this for?" value="${escape(draft.note)}"></label><label class="field">Date<input name="date" type="date" min="0001-01-01" max="9999-12-31" required value="${escape(draft.date)}"></label><p id="money-error" class="error" role="alert"></p><button class="primary">${icon("check")} ${draft.edit ? "Save changes" : "Save record"}</button></form>`,
      "Record activity that happened outside NectarSpend. No money moves here.",
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
        ? "Amounts keep their numeric value. NectarSpend does not convert exchange rates."
        : field === "monthlySpendCap"
          ? "Set to 0 to turn off your monthly cap."
          : "",
    );
  }
  const business = () => state.workspace?.kind === "business";

  function workspaceControl() {
    return `<button class="workspace-switch row" data-action="workspaces" aria-label="Switch workspace"><span>${icon(business() ? "store" : "user")} ${escape(state.workspace?.name || "Choose workspace")}</span>${icon("chevron-down")}</button>`;
  }

  function renderRecords() {
    const s = C.summary(state, summaryPeriod, summaryDate),
      signed = (n) => (n > 0 ? "+" : "") + money(n);
    return `${workspaceControl()}${header("BASED ON YOUR RECORDS", business() ? "Records" : "Summaries")}<div class="segments">${[
      ["week", "Week"],
      ["month", "Month"],
    ]
      .map(
        ([key, label]) =>
          `<button data-action="summary-period" data-period="${key}" class="${summaryPeriod === key ? "active" : ""}" aria-pressed="${summaryPeriod === key}">${label}</button>`,
      )
      .join(
        "",
      )}</div><label class="field">A date in the period<input id="summary-date" type="date" value="${summaryDate}"></label><p class="muted">${escape(s.from)} — ${escape(s.to)} · ${s.count} record${s.count === 1 ? "" : "s"}</p>${!s.count ? '<div class="empty"><h2>No records in this period</h2><p>Your summaries will appear as you record activity.</p></div>' : `<div class="card ledger">${[["Recorded money in", s.income, "saved"], ["Recorded money out", s.expenses, "spent"], ["Difference", s.difference, s.difference < 0 ? "spent" : "saved"], ...(!business() ? [["Recorded savings", s.saved, "saved"]] : [])].map(([label, value, cls]) => `<div class="row"><span>${label}</span><span class="money ${cls}">${label === "Difference" ? signed(value) : money(value)}</span></div>`).join("")}</div>${business() ? `<div class="card ledger"><div class="row"><span>Recorded sales revenue</span><span>${money(s.revenue)}</span></div><div class="row"><span>Operating costs</span><span>${money(s.operatingCosts)}</span></div><div class="row"><span>Simple operating result</span><span class="${s.operatingResult < 0 ? "spent" : "saved"}">${signed(s.operatingResult)}</span></div></div><p class="muted summary-note">Revenue less recorded operating costs, not accounting profit. Excludes stock purchases (${money(s.stock)}), owner funding/draws, loans, tax and unrecorded costs. Money in/out above includes every cash record.</p>` : ""}<div class="section-title"><h2>Expense categories</h2></div>${s.categories.length ? `<p class="muted">Largest: ${escape(s.categories[0].name)}</p>` : '<p class="muted">No expenses in this period.</p>'}${s.categories.map((c) => `<div class="bar-row spent"><div class="row"><span>${escape(c.name)}</span><span>${money(c.amount)}</span></div>${bar(c.amount, s.expenses)}</div>`).join("")}`}`;
  }

  function openWorkspaces() {
    openSheet(
      "Your workspaces",
      `<div class="settings-group workspace-list">${state.workspaces.map((w) => `<button class="setting" data-action="switch-workspace" data-id="${escape(w.id)}">${icon(w.kind === "business" ? "store" : "user")}<span>${escape(w.name)}<small>${w.kind === "business" ? "Business" : "Personal"} · ${w.currency}</small></span>${w.id === state.workspace?.id ? icon("check") : icon("chevron-right")}</button>`).join("")}</div><button class="primary" data-action="new-workspace">${icon("plus")} New workspace</button>`,
    );
  }

  function openNewWorkspace() {
    openSheet(
      "New workspace",
      `<form id="workspace-form"><label class="field">Name<input name="name" required maxlength="60" placeholder="e.g. My Store"></label><label class="field">Type<select name="kind"><option value="personal">Personal</option><option value="business">Business</option></select></label><p class="error" role="alert"></p><button class="primary">Create workspace</button></form>`,
      "Keep a separate set of records. Workspace type is fixed once created.",
    );
  }

  function applyWorkspace(w) {
    state.workspace = w;
    state.workspaces = state.workspaces.map((x) => (x.id === w.id ? w : x));
    Object.assign(state.profile, {
      currency: w.currency,
      startingBalance: w.startingBalance,
      monthlySpendCap: w.monthlySpendCap,
    });
  }

  function preferredWorkspace(userId) {
    try {
      return localStorage.getItem("nectarspend-workspace:" + userId);
    } catch {
      return null;
    }
  }

  async function reloadWorkspace(id, next = "home") {
    if (!currentUser || !repo) throw new Error("Please log in again.");
    const user = currentUser,
      repository = repo,
      ticket = ++epoch;
    closeSheet();
    state = emptyState();
    draft = {};
    filter = "all";
    query = "";
    activityCategory = "";
    dateFrom = "";
    dateTo = "";
    page = "loading";
    render();
    try {
      const notebook = await repository.load(user, id);
      if (ticket !== epoch) return;
      state = notebook;
      setupStep = state.workspaces.length ? 1 : 0;
      try {
        if (state.workspace)
          localStorage.setItem(
            "nectarspend-workspace:" + user.id,
            state.workspace.id,
          );
      } catch {}
      authStatus = state.setupComplete ? "SIGNED_IN" : "ONBOARDING_REQUIRED";
      go(state.setupComplete ? next : "setup");
    } catch (error) {
      if (ticket !== epoch) return;
      loadError = errorMessage(error);
      page = "load-error";
      render();
    }
  }

  async function handleAction(button) {
    const action = button.dataset.action,
      id = button.dataset.id;
    if (action === "nav") go(button.dataset.page);
    else if (action === "close") closeSheet();
    else if (action === "retry") await boot();
    else if (action === "workspaces") openWorkspaces();
    else if (action === "new-workspace") openNewWorkspace();
    else if (action === "switch-workspace") {
      if (!state.workspaces.some((w) => w.id === id))
        throw new Error("Choose one of your workspaces.");
      await runPending(button, () => reloadWorkspace(id));
    } else if (action === "summary-period") {
      summaryPeriod = button.dataset.period;
      render();
    } else if (action === "reset-filters") {
      activityCategory = "";
      dateFrom = "";
      dateTo = "";
      query = "";
      filter = "all";
      render();
    } else if (action === "add") openMoney(button.dataset.type || "spent");
    else if (action === "money-type") {
      captureDraft();
      draft.type = button.dataset.type;
      draft.kind = draft.type === "spent" ? "expense" : "income";
      draft.isSavings = false;
      draft.goalId = "";
      draft.category =
        C.categories[business() ? "business" : "personal"][draft.kind][0];
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
        `<p class="sheet-copy">${money(C.progress(state, id))} recorded toward ${money(g.target)}.</p><div class="sheet-actions"><button class="primary" data-action="allocate" data-id="${escape(id)}">${icon("plus")} Record savings</button><button class="secondary danger" data-action="delete-goal" data-id="${escape(id)}">${icon("trash-2")} Delete goal</button></div>`,
      );
    } else if (action === "allocate" || action === "record-savings") {
      openMoney("saved");
      draft.goalId = id || "";
      draft.kind = "saving";
      draft.isSavings = true;
      draft.category = "Savings";
      openMoney("saved", false);
    } else if (action === "delete-goal")
      confirmAction(
        "Delete this goal?",
        "Historical records stay in this workspace without a goal attached.",
        "confirm-goal",
        id,
      );
    else if (action === "confirm-goal")
      await runPending(button, () =>
        write(
          (r) => r.deleteGoal(id, state.workspace.id),
          () => C.deleteGoal(state, id),
          "Goal deleted. Records kept.",
        ),
      );
    else if (action === "transaction") {
      const t = state.transactions.find((x) => x.id === id);
      if (!t) return;
      const g = state.goals.find((x) => x.id === t.goalId);
      openSheet(
        t.note || t.category,
        `<div class="display details-balance ${t.type}">${C.kindOf(t) === "expense" ? "−" : C.kindOf(t) === "income" ? "+" : ""}${money(t.amount)}</div><p class="muted">${escape(t.category)} · ${relativeDate(t.date)}</p>${C.kindOf(t) === "saving" ? '<p class="sheet-copy">Savings allocation. No change to calculated balance.</p>' : ""}${g ? `<p class="sheet-copy">Goal: ${escape(g.name)}</p>` : ""}<div class="sheet-actions"><button class="primary" data-action="edit-record" data-id="${escape(id)}">${icon("pencil")} Edit record</button><button class="secondary danger" data-action="delete-entry" data-id="${escape(id)}">${icon("trash-2")} Delete this entry</button></div>`,
      );
    } else if (action === "edit-record") {
      const t = state.transactions.find((x) => x.id === id);
      if (!t) return;
      draft = {
        ...t,
        edit: true,
        isSavings: C.isSavings(t),
        goalId: t.goalId || "",
      };
      openMoney(t.type, false);
    } else if (action === "delete-entry")
      confirmAction(
        "Delete this entry?",
        "This removes the record from this workspace and updates its summaries.",
        "confirm-entry",
        id,
      );
    else if (action === "confirm-entry")
      await runPending(button, () =>
        write(
          (r) => r.deleteTransaction(id, state.workspace.id),
          () => {
            state.transactions = state.transactions.filter((t) => t.id !== id);
          },
          "Entry deleted. Totals updated.",
        ),
      );
    else if (action.startsWith("edit-")) openEdit(action.slice(5));
    else if (action === "skip-cap")
      await runPending(button, async () => {
        const ticket = epoch,
          w = await repo.updateWorkspace(state.workspace.id, {
            monthlySpendCap: 0,
          });
        if (ticket !== epoch) return;
        applyWorkspace(w);
        setupStep = 4;
        render();
      });
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
        "NectarSpend is a personal record of the amounts you enter. It does not move money or connect to your bank. The operator must publish final service terms before public launch.",
      );
    else if (action === "privacy")
      info(
        "Your privacy",
        "Your account is managed by Supabase Auth. Financial entries and settings are stored in your account’s database records. NectarSpend does not store your password in browser storage. The Supabase client manages your session on this device. Google Fonts loads the interface fonts. The operator must publish their full privacy policy before public launch.",
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
  document.addEventListener("change", (event) => {
    if (
      event.target.id === "record-savings" ||
      event.target.id === "savings-source"
    ) {
      captureDraft();
      draft.isSavings = !!$("#record-savings")?.checked;
      draft.kind = draft.isSavings
        ? $("#savings-source")?.value || "income"
        : "income";
      if (!draft.isSavings) draft.goalId = "";
      openMoney(draft.type, false);
    }
    if (
      ["activity-category", "date-from", "date-to"].includes(event.target.id)
    ) {
      activityCategory = $("#activity-category").value;
      dateFrom = $("#date-from").value;
      dateTo = $("#date-to").value;
      $("#history-results").innerHTML = historyResults();
      refreshIcons();
    }
    if (event.target.id === "summary-date" && event.target.value) {
      summaryDate = event.target.value;
      render();
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
          const raw = String(data.get("amount")).replace(/,/g, "").trim();
          if (!/^\d+(\.\d{1,2})?$/.test(raw))
            throw new Error(
              "Enter an amount greater than zero, with up to two decimal places.",
            );
          draft.id ||= C.id();
          const savings =
              !business() && draft.type === "saved" && data.has("isSavings"),
            kind =
              draft.type === "spent"
                ? "expense"
                : savings && data.get("source") === "saving"
                  ? "saving"
                  : "income";
          const entry = {
            id: draft.id,
            kind,
            isSavings: savings,
            amount: Number(raw),
            category: kind === "saving" ? "Savings" : draft.category,
            note: String(data.get("note")).trim(),
            date: String(data.get("date")),
            goalId: savings ? data.get("goalId") || null : null,
          };
          C.validateRecord(entry, state.workspace.kind);
          const workspaceId = state.workspace.id,
            workspaceKind = state.workspace.kind,
            editing = draft.edit;
          await write(
            (r) =>
              editing
                ? r.updateTransaction(entry, workspaceId, workspaceKind)
                : r.createTransaction(entry, workspaceId, workspaceKind),
            (row) => {
              state.transactions = state.transactions.filter(
                (t) => t.id !== row.id,
              );
              state.transactions.push(row);
            },
            editing ? "Record updated." : "Record saved.",
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
            (r) =>
              r.createGoal(
                { id: form.dataset.id, name, target },
                state.workspace.id,
              ),
            (row) => {
              state.goals = state.goals.filter((g) => g.id !== row.id);
              state.goals.push(row);
            },
            "Goal created.",
          );
        } else if (form.id === "profile-form") {
          const key = form.dataset.field,
            value = ["startingBalance", "monthlySpendCap"].includes(key)
              ? Number(data.get("value"))
              : String(data.get("value")).trim();
          await write(
            (r) =>
              key === "name"
                ? r.updateProfile({ name: value })
                : r.updateWorkspace(state.workspace.id, { [key]: value }),
            (result) => {
              if (key === "name")
                state.profile = { ...state.profile, ...result.profile };
              else applyWorkspace(result);
            },
            "Changes saved.",
          );
        } else if (form.id === "workspace-form") {
          const name = String(data.get("name")).trim();
          if (!name) throw new Error("Give your workspace a name.");
          form.dataset.id ||= C.id();
          const ticket = epoch;
          const w = await repo.createWorkspace({
            id: form.dataset.id,
            name,
            kind: String(data.get("kind")),
            currency: state.profile.currency,
          });
          if (ticket !== epoch) return;
          await reloadWorkspace(w.id);
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
              "If this address can be registered, a confirmation link is on its way. Open it in this browser, then return to NectarSpend. If you already have an account, log in or reset your password.",
            );
          else if (result.session) await activateSession(result.session);
          else throw new Error("No session was created. Please log in again.");
        } else if (form.id === "setup-form") {
          const ticket = epoch;
          if (setupStep === 0) {
            await repo.initializeWorkspaces(String(data.get("value")));
            if (ticket !== epoch) return;
            await reloadWorkspace(null);
          } else if (setupStep === 4) {
            const id = state.workspace.id;
            await repo.completeWorkspace(id);
            if (ticket !== epoch) return;
            await reloadWorkspace(id);
          } else {
            const patch =
              setupStep === 1
                ? { currency: data.get("value") }
                : setupStep === 2
                  ? { startingBalance: Number(data.get("value")) }
                  : { monthlySpendCap: Number(data.get("value") || 0) };
            const w = await repo.updateWorkspace(state.workspace.id, patch);
            if (ticket !== epoch) return;
            applyWorkspace(w);
            setupStep = setupStep === 2 && business() ? 4 : setupStep + 1;
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
        .then((session) => {
          if (ticket === epoch) return activateSession(session, true);
        })
        .catch(() => {
          if (ticket !== epoch) return;
          loadError = "Couldn’t refresh your NectarSpend. Try again.";
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
