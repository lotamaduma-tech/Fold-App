const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs"),
  crypto = require("node:crypto");
test("local server serves the app, denies development files, sends security headers", async () => {
  const port = 4189,
    child = spawn(process.execPath, ["serve.cjs"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error("Server exited " + code)));
    });
    for (const resource of [
      "/",
      "/config.js",
      "/terms.html",
      "/privacy.html",
      "/disclaimer.html",
      "/css/legal.css",
      "/js/backend.js",
      "/assets/supabase.js",
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${resource}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    for (const resource of [
      "/package.json",
      "/.env",
      "/node_modules/@supabase/supabase-js/package.json",
      "/tests/supabase-fixture.cjs",
      "/supabase/schema.sql",
      "/supabase/functions/delete-account/index.ts",
    ])
      assert.equal(
        (await fetch(`http://127.0.0.1:${port}${resource}`)).status,
        404,
      );
  } finally {
    child.kill();
  }
});
test("bundled Supabase client matches the locked official package", () => {
  const hash = (filename) =>
    crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
  assert.equal(
    hash("assets/supabase.js"),
    hash("node_modules/@supabase/supabase-js/dist/umd/supabase.js"),
  );
});
