const { test } = require("node:test");
const assert = require("node:assert/strict");
const Errors = require("../js/errors.js");
test("schema, access, auth, validation, service and network failures stay distinct", () => {
  for (const [code, status, kind] of [
    ["42703", 400, "schema"],
    ["PGRST205", 404, "schema"],
    ["PGRST202", 404, "schema"],
    ["42501", 403, "access"],
    ["bad_jwt", 401, "auth"],
    ["23514", 400, "validation"],
    ["23503", 409, "reference"],
    ["", 503, "unavailable"],
    ["INVALID_RESPONSE", 200, "response"],
  ]) {
    const e = Errors.from(
      { code, message: "private provider detail" },
      { status, operation: "profiles.load" },
    );
    assert.equal(e.kind, kind);
    assert.ok(!e.message.includes("private"));
    assert.ok(!e.message.includes("connection"));
  }
  const offline = Errors.from(new TypeError("Failed to fetch"), {
    operation: "profiles.load",
  });
  assert.equal(offline.kind, "network");
  assert.match(offline.message, /connection/);
});
test("development diagnostics contain safe context only, with no payloads or production logging", () => {
  const e = Errors.from(
      { code: "42703", message: "SECRET token email note", details: "PRIVATE" },
      { status: 400, operation: "profiles.load" },
    ),
    logs = [];
  Errors.diagnose(
    e,
    { hostname: "localhost" },
    { error: (...args) => logs.push(args) },
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].code, "42703");
  assert.equal(logs[0][1].requiredMigration, "002_workspaces.sql");
  assert.ok(!JSON.stringify(logs).includes("SECRET"));
  assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
  Errors.diagnose(
    e,
    { hostname: "nectarspend.com" },
    { error: (...args) => logs.push(args) },
  );
  assert.equal(logs.length, 1);
});
