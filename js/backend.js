/* Supabase initialization and auth only. SDK owns all session/token storage. */
(function (root) {
  "use strict";
  function validateConfig(config) {
    const url = config?.SUPABASE_URL?.trim();
    const key = (
      config?.SUPABASE_PUBLISHABLE_KEY ||
      config?.SUPABASE_ANON_KEY ||
      ""
    ).trim();
    if (!url || !key)
      throw new Error(
        "Fold is not connected yet. Add your Supabase project URL and public key to config.js.",
      );
    const parsed = new URL(url);
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "")
    )
      throw new Error("Use your Supabase project base URL.");
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname)
      )
    )
      throw new Error("Supabase requires an HTTPS project URL.");
    if (key.startsWith("sb_secret_"))
      throw new Error(
        "A secret key cannot be used in the browser. Use a publishable key.",
      );
    if (!key.startsWith("sb_publishable_")) {
      let payload;
      try {
        payload = JSON.parse(
          atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        );
      } catch {
        throw new Error("Use a Supabase publishable key or legacy anon key.");
      }
      if (payload.role !== "anon")
        throw new Error("Only a public anon key is allowed in the browser.");
    }
    return { url: parsed.origin, key };
  }
  function createAuth(client, location) {
    // Never take redirect destinations from query strings or user input.
    const base = new URL(location.pathname, location.origin);
    const redirect = (mode) => {
      const url = new URL(base);
      url.searchParams.set("auth", mode);
      return url.href;
    };
    const checked = async (promise) => {
      const result = await promise;
      if (result.error) throw result.error;
      return result.data;
    };
    return {
      subscribe(callback) {
        return client.auth.onAuthStateChange(callback).data.subscription;
      },
      async restore() {
        // Initialization performs the SDK's PKCE code exchange exactly once.
        const initialized = await client.auth.initialize();
        if (initialized.error) throw initialized.error;
        const { session } = await checked(client.auth.getSession());
        return session;
      },
      async verifiedUser() {
        const { user } = await checked(client.auth.getUser());
        if (!user) throw new Error("Please log in again.");
        return user;
      },
      signUp(email, password) {
        return checked(
          client.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: redirect("callback") },
          }),
        );
      },
      signIn(email, password) {
        return checked(client.auth.signInWithPassword({ email, password }));
      },
      google() {
        return checked(
          client.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: redirect("callback") },
          }),
        );
      },
      recover(email) {
        return checked(
          client.auth.resetPasswordForEmail(email, {
            redirectTo: redirect("recovery"),
          }),
        );
      },
      updatePassword(password, nonce) {
        return checked(
          client.auth.updateUser({ password, ...(nonce ? { nonce } : {}) }),
        );
      },
      reauthenticate() {
        return checked(client.auth.reauthenticate());
      },
      signOut() {
        return checked(client.auth.signOut({ scope: "local" }));
      },
      redirect,
    };
  }
  function connect(config, library, location) {
    const { url, key } = validateConfig(config);
    if (!library?.createClient)
      throw new Error(
        "The account service could not load. Refresh and try again.",
      );
    const client = library.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
      global: {
        fetch: (input, init = {}) => {
          const timeout = AbortSignal.timeout(20000);
          const signal = init.signal
            ? AbortSignal.any([init.signal, timeout])
            : timeout;
          return fetch(input, { ...init, signal });
        },
      },
    });
    return { client, auth: createAuth(client, location) };
  }
  const api = { connect, validateConfig, createAuth };
  if (typeof module !== "undefined") module.exports = api;
  else root.FoldBackend = api;
})(globalThis);
