const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAuth } = require("../js/backend.js");

for (const origin of [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://nectarspend.vercel.app",
  "https://nectarspend.com",
  "https://www.nectarspend.com",
]) {
  test(`Google, signup and recovery SDK requests preserve ${origin}`, async () => {
    const calls = [];
    const capture =
      (method) =>
      async (...args) => {
        calls.push([method, ...args]);
        return { data: {}, error: null };
      };
    const auth = createAuth(
      {
        auth: {
          signInWithOAuth: capture("google"),
          signUp: capture("signup"),
          resetPasswordForEmail: capture("recovery"),
        },
      },
      {
        origin,
        pathname: "/",
        search:
          "?redirectTo=https://evil.example&redirect=https://evil.example&next=//evil.example&auth=recovery",
      },
    );
    await auth.google();
    await auth.signUp("test@example.com", "test-password");
    await auth.recover("test@example.com");
    assert.deepEqual(calls, [
      [
        "google",
        {
          provider: "google",
          options: { redirectTo: `${origin}/?auth=callback` },
        },
      ],
      [
        "signup",
        {
          email: "test@example.com",
          password: "test-password",
          options: { emailRedirectTo: `${origin}/?auth=callback` },
        },
      ],
      [
        "recovery",
        "test@example.com",
        { redirectTo: `${origin}/?auth=recovery` },
      ],
    ]);
  });
}
test("callbacks preserve all expected local and production origins", () => {
  for (const origin of [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "https://nectarspend.vercel.app",
    "https://nectarspend.com",
    "https://www.nectarspend.com",
    "http://127.0.0.1:4174",
  ]) {
    const auth = createAuth(
      { auth: {} },
      { origin, pathname: "/", search: "?next=https://evil.example" },
    );
    assert.equal(auth.redirect("callback"), origin + "/?auth=callback");
    assert.equal(auth.redirect("recovery"), origin + "/?auth=recovery");
  }
});
test("unexpected origins and protocol-relative callback paths cannot redirect off-site", () => {
  for (const origin of [
    "https://nectarspend.com.evil.example",
    "https://evil.example",
    "http://nectarspend.com",
    "https://untrusted-preview.vercel.app",
    "http://localhost:9000",
  ])
    assert.throws(
      () => createAuth({ auth: {} }, { origin, pathname: "/" }),
      /not configured/,
    );
  const auth = createAuth(
    { auth: {} },
    {
      origin: "https://nectarspend.com",
      pathname: "//evil.example/steal",
      search: "?redirect=https://evil.example",
    },
  );
  assert.equal(
    auth.redirect("callback"),
    "https://nectarspend.com/?auth=callback",
  );
});
