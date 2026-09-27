const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");
const { createRepository } = require("../js/data.js");
const uid = "00000000-0000-4000-8000-000000000001";
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
    if (url.pathname.endsWith("/goals")) return respond([]);
    const offset = Number(url.searchParams.get("offset"));
    const rows = Array.from(
      { length: Math.max(0, Math.min(500, 1001 - offset)) },
      (_, i) => ({
        id: String(offset + i),
        user_id: uid,
        type: "saved",
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
  assert.equal(result.profile.email, "test@example.test");
  assert.ok(calls.some((u) => u.searchParams.get("offset") === "1001"));
});
test("lost insert response can be retried without inserting a duplicate", async () => {
  const id = "20000000-0000-4000-8000-000000000001",
    record = {
      id,
      user_id: uid,
      type: "saved",
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
    return respond(record);
  });
  const repo = createRepository(sdk, uid),
    entry = {
      id,
      type: "saved",
      amount: 50,
      category: "Work",
      note: "Saved",
      date: "2026-09-27",
      goalId: null,
    };
  await assert.rejects(repo.createTransaction(entry));
  const result = await repo.createTransaction(entry);
  assert.equal(result.id, id);
  assert.equal(result.amount, 50);
  assert.equal(posts, 2);
});
test("delete and profile update include owner filters; reset validates expected session owner", async () => {
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
      return respond([]);
    }
    assert.deepEqual(body, { starting_balance: 10 });
    return respond({ ...profile, starting_balance: 10 });
  });
  const repo = createRepository(sdk, uid);
  await repo.deleteGoal("record-id");
  await repo.deleteTransaction("record-id");
  assert.equal(
    (await repo.updateProfile({ startingBalance: 10 })).profile.startingBalance,
    10,
  );
  await repo.replaceNotebook(false, "2026-09-27");
});
