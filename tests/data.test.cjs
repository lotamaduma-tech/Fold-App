const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");
const { createRepository } = require("../js/data.js");
const uid = "00000000-0000-4000-8000-000000000001";
const wid = "30000000-0000-4000-8000-000000000001";
const workspace = {
  id: wid,
  user_id: uid,
  name: "Personal",
  kind: "personal",
  currency: "NGN",
  starting_balance: "0",
  monthly_spend_cap: "0",
  setup_completed: true,
  created_at: "2026-09-27T12:00:00Z",
};
const profile = {
  user_id: uid,
  name: null,
  currency: "NGN",
  starting_balance: "0",
  monthly_spend_cap: "0",
  onboarding_completed: true,
};
function client(fetcher) {
  return createClient(
    "https://fixture.supabase.co",
    "sb_publishable_fixture_only",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: fetcher },
    },
  );
}
const respond = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
test("repository pages past the API row cap and scopes every query to owner", async () => {
  const calls = [];
  const sdk = client(async (url, options) => {
    url = new URL(url);
    calls.push(url);
    assert.equal(url.searchParams.get("user_id"), "eq." + uid);
    if (url.pathname.endsWith("/profiles")) return respond(profile);
    if (url.pathname.endsWith("/workspaces"))
      return respond(Number(url.searchParams.get("offset")) ? [] : [workspace]);
    assert.equal(url.searchParams.get("workspace_id"), "eq." + wid);
    if (url.pathname.endsWith("/goals")) return respond([]);
    const offset = Number(url.searchParams.get("offset"));
    const rows = Array.from(
      { length: Math.max(0, Math.min(500, 1001 - offset)) },
      (_, i) => ({
        id: String(offset + i),
        user_id: uid,
        type: "saved",
        record_kind: "income",
        is_savings: true,
        workspace_id: wid,
        amount: "1.25",
        category: "Work",
        note: null,
        date: "2026-09-27",
        created_at: "2026-09-27T12:00:00Z",
        goal_id: null,
      }),
    );
    return respond(rows);
  });
  const result = await createRepository(sdk, uid).load({
    id: uid,
    email: "test@example.test",
  });
  assert.equal(result.transactions.length, 1001);
  assert.equal(result.transactions[0].amount, 1.25);
  assert.equal(result.transactions[0].kind, "income");
  assert.equal(result.transactions[0].isSavings, true);
  assert.equal(result.workspace.id, wid);
  assert.equal(result.profile.email, "test@example.test");
  assert.ok(calls.some((u) => u.searchParams.get("offset") === "1001"));
});
test("lost insert response can be retried without inserting a duplicate", async () => {
  const id = "20000000-0000-4000-8000-000000000001",
    record = {
      id,
      user_id: uid,
      type: "saved",
      record_kind: "income",
      is_savings: false,
      workspace_id: wid,
      amount: 50,
      category: "Work",
      note: "Saved",
      date: "2026-09-27",
      goal_id: null,
      created_at: "2026-09-27T12:00:00Z",
    };
  let inserted = false,
    posts = 0;
  const sdk = client(async (url, options) => {
    url = new URL(url);
    if (options.method === "POST") {
      posts++;
      assert.equal(JSON.parse(options.body).user_id, uid);
      if (inserted)
        return respond({ code: "23505", message: "duplicate" }, 409);
      inserted = true;
      throw new TypeError("network response lost");
    }
    assert.equal(url.searchParams.get("user_id"), "eq." + uid);
    assert.equal(url.searchParams.get("id"), "eq." + id);
    assert.equal(url.searchParams.get("workspace_id"), "eq." + wid);
    return respond(record);
  });
  const repo = createRepository(sdk, uid),
    entry = {
      id,
      type: "saved",
      kind: "income",
      isSavings: false,
      amount: 50,
      category: "Work",
      note: "Saved",
      date: "2026-09-27",
      goalId: null,
    };
  await assert.rejects(repo.createTransaction(entry, wid, "personal"));
  const result = await repo.createTransaction(entry, wid, "personal");
  assert.equal(result.id, id);
  assert.equal(result.amount, 50);
  assert.equal(posts, 2);
});
test("delete and workspace update include owner and workspace filters; onboarding RPC validates expected owner", async () => {
  const sdk = client(async (url, options) => {
    url = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.pathname.includes("/rpc/")) {
      assert.equal(body.p_expected_user_id, uid);
      return respond(null);
    }
    assert.equal(url.searchParams.get("user_id"), "eq." + uid);
    if (options.method === "DELETE") {
      assert.equal(url.searchParams.get("id"), "eq.record-id");
      assert.equal(url.searchParams.get("workspace_id"), "eq." + wid);
      return respond([]);
    }
    assert.deepEqual(body, { starting_balance: 10 });
    assert.equal(url.searchParams.get("id"), "eq." + wid);
    return respond({ ...workspace, starting_balance: 10 });
  });
  const repo = createRepository(sdk, uid);
  await repo.deleteGoal("record-id", wid);
  await repo.deleteTransaction("record-id", wid);
  assert.equal(
    (await repo.updateWorkspace(wid, { startingBalance: 10 })).startingBalance,
    10,
  );
  await repo.initializeWorkspaces("both");
  await repo.completeWorkspace(wid);
});
test("editing scopes owner, workspace and record ID and maps numeric results", async () => {
  const sdk = client(async (url, options) => {
    url = new URL(url);
    assert.equal(options.method, "PATCH");
    assert.equal(url.searchParams.get("user_id"), "eq." + uid);
    assert.equal(url.searchParams.get("workspace_id"), "eq." + wid);
    assert.equal(url.searchParams.get("id"), "eq.edit-id");
    const body = JSON.parse(options.body);
    assert.equal(body.record_kind, "expense");
    assert.equal(body.goal_id, null);
    return respond({
      ...body,
      id: "edit-id",
      workspace_id: wid,
      user_id: uid,
      type: "spent",
      amount: "12.50",
    });
  });
  const row = await createRepository(sdk, uid).updateTransaction(
    {
      id: "edit-id",
      kind: "expense",
      isSavings: false,
      amount: 12.5,
      category: "Food",
      date: "2026-09-27",
    },
    wid,
    "personal",
  );
  assert.equal(row.amount, 12.5);
  assert.equal(row.kind, "expense");
  assert.equal(row.workspaceId, wid);
});
test("an unowned preferred workspace never becomes the active workspace", async () => {
  const sdk = client(async (url) => {
    url = new URL(url);
    if (url.pathname.endsWith("/profiles")) return respond(profile);
    if (url.pathname.endsWith("/workspaces"))
      return respond(Number(url.searchParams.get("offset")) ? [] : [workspace]);
    assert.equal(url.searchParams.get("workspace_id"), "eq." + wid);
    return respond([]);
  });
  assert.equal(
    (await createRepository(sdk, uid).load({ id: uid }, "unowned-id")).workspace
      .id,
    wid,
  );
});
