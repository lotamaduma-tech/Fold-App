const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateConfig, createAuth } = require("../js/backend.js");
const { createRepository } = require("../js/data.js");
test("configuration requires public credentials and rejects privileged keys", () => {
  assert.throws(() => validateConfig({}), /not connected/);
  assert.throws(
    () =>
      validateConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_not_allowed",
      }),
    /secret key/,
  );
  const jwt = (role) =>
    "eyJhbGciOiJIUzI1NiJ9." +
    Buffer.from(JSON.stringify({ role })).toString("base64url") +
    ".fixture";
  assert.throws(
    () =>
      validateConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: jwt("service_role"),
      }),
    /public anon/,
  );
  assert.ok(
    validateConfig({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: jwt("anon"),
    }),
  );
  assert.throws(
    () =>
      validateConfig({
        SUPABASE_URL: "https://example.supabase.co/?redirect=evil",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
      }),
    /base URL/,
  );
});
test("auth forwards real SDK calls with controlled PKCE callback destinations", async () => {
  const calls = [],
    sdk = {};
  for (const name of [
    "signUp",
    "signInWithPassword",
    "signInWithOAuth",
    "resetPasswordForEmail",
    "updateUser",
    "signOut",
    "reauthenticate",
  ])
    sdk[name] = async (...args) => {
      calls.push([name, ...args]);
      return { data: {}, error: null };
    };
  const auth = createAuth(
    { auth: sdk },
    {
      origin: "https://nectarspend.example",
      pathname: "/index.html",
      search: "?redirect=https://evil.example",
    },
  );
  await auth.signUp("a@example.test", "test-password");
  await auth.signIn("a@example.test", "test-password");
  await auth.google();
  await auth.recover("a@example.test");
  await auth.updatePassword("new-test-password");
  await auth.signOut();
  assert.equal(
    calls[0][1].options.emailRedirectTo,
    "https://nectarspend.example/index.html?auth=callback",
  );
  assert.equal(calls[2][1].provider, "google");
  assert.equal(
    calls[2][1].options.redirectTo,
    "https://nectarspend.example/index.html?auth=callback",
  );
  assert.equal(
    calls[3][2].redirectTo,
    "https://nectarspend.example/index.html?auth=recovery",
  );
  assert.equal(calls[4][0], "updateUser");
  assert.equal(calls[5][1].scope, "local");
  sdk.signInWithPassword = async () => ({
    error: { code: "invalid_credentials" },
  });
  await assert.rejects(
    auth.signIn("a@example.test", "wrong"),
    (e) => e.code === "invalid_credentials",
  );
});
test("repository prevents anonymous construction and unknown profile fields", async () => {
  assert.throws(() => createRepository({}, null), /Authentication/);
  await assert.rejects(
    createRepository({}, "owner").updateProfile({ user_id: "other" }),
    /Unknown profile field/,
  );
});
test("original paper stylesheet is preserved beneath workspace extensions", () => {
  const fs = require("node:fs"),
    crypto = require("node:crypto");
  assert.equal(
    crypto
      .createHash("sha256")
      .update(fs.readFileSync("css/style.css", "utf8").split("/* Workspace and record controls")[0])
      .digest("hex"),
    "30a1f5dc46bea184a9f239f099153af2edb107b4d391d8aacd38299b0db57838",
  );
});
