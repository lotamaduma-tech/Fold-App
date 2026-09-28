const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002",
  N = "00000000-0000-4000-8000-000000000003";
const GA = "10000000-0000-4000-8000-000000000001",
  GB = "10000000-0000-4000-8000-000000000002",
  TA = "20000000-0000-4000-8000-000000000001";
const base = fs.readFileSync("supabase/schema.sql", "utf8"),
  migration = fs.readFileSync("supabase/migrations/002_workspaces.sql", "utf8");
let db, WA, WB, BIZ, SECOND;
async function as(user) {
  await db.exec(
    `reset role;set role authenticated;set request.jwt.claim.sub='${user}';`,
  );
}
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;insert into auth.users values ('${A}'),('${B}'),('${N}');`,
  );
  await db.exec(base);
  await db.exec(base);
  await db.query(
    "insert into profiles(user_id,starting_balance,monthly_spend_cap,onboarding_completed) values ($1,45000,25000,true),($2,0,0,true)",
    [A, B],
  );
  await db.query(
    "insert into goals(id,user_id,name,target) values ($1,$2,'Alice goal',1000),($3,$4,'Bob goal',2000)",
    [GA, A, GB, B],
  );
  await db.query(
    "insert into transactions(id,user_id,type,amount,category,date,goal_id) values ($1,$2,'saved',125.50,'Work','2026-09-27',$3)",
    [TA, A, GA],
  );
  await db.exec(migration);
  await db.exec(migration);
  WA = (await db.query("select id from workspaces where user_id=$1", [A]))
    .rows[0].id;
  WB = (await db.query("select id from workspaces where user_id=$1", [B]))
    .rows[0].id;
  await as(A);
  BIZ = (
    await db.query(
      "insert into workspaces(user_id,name,kind) values ($1,'My Store','business') returning id",
      [A],
    )
  ).rows[0].id;
  SECOND = (
    await db.query(
      "insert into workspaces(user_id,name,kind) values ($1,'Second Personal','personal') returning id",
      [A],
    )
  ).rows[0].id;
});
after(async () => db?.close());
test("additive migration preserves legacy records, savings, goal links, budgets and IDs; rerun does not duplicate", async () => {
  await as(A);
  const t = (await db.query("select * from transactions where id=$1", [TA]))
    .rows[0];
  assert.equal(t.workspace_id, WA);
  assert.equal(t.record_kind, "income");
  assert.equal(t.is_savings, true);
  assert.equal(Number(t.amount), 125.5);
  assert.equal(t.goal_id, GA);
  const w = (await db.query("select * from workspaces where id=$1", [WA]))
    .rows[0];
  assert.equal(Number(w.starting_balance), 45000);
  assert.equal(Number(w.monthly_spend_cap), 25000);
  assert.equal(w.setup_completed, true);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from workspaces where is_legacy_default",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select to_regprocedure('public.fold_replace_notebook(uuid,boolean,date)') x",
      )
    ).rows[0].x,
    null,
  );
});
test("RLS is enabled and forced on every user-owned table", async () => {
  await db.exec("reset role");
  const { rows } = await db.query(
    "select relrowsecurity,relforcerowsecurity from pg_class where relname in ('profiles','goals','transactions','workspaces')",
  );
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity));
});
test("owner RLS blocks cross-user reads, writes, deletion and ownership changes", async () => {
  await as(A);
  for (const table of ["profiles", "goals", "transactions", "workspaces"]) {
    assert.equal(
      (await db.query(`select * from ${table} where user_id=$1`, [B])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query(`delete from ${table} where user_id=$1 returning *`, [B]))
        .rows.length,
      0,
    );
  }
  assert.equal(
    (
      await db.query(
        "update workspaces set starting_balance=999 where id=$1 returning *",
        [WB],
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    db.query(
      "insert into workspaces(user_id,name,kind) values ($1,'Intrusion','personal')",
      [B],
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.query("update profiles set user_id=$1 where user_id=$2", [B, A]),
    /row-level security/,
  );
  await assert.rejects(
    db.query("update goals set user_id=$1 where id=$2", [B, GA]),
    /personal workspace|row-level security/,
  );
});
test("composite foreign keys reject another workspace goal, including another workspace owned by the same user", async () => {
  await as(A);
  for (const [wid, gid] of [
    [WA, GB],
    [SECOND, GA],
    [WB, GB],
  ])
    await assert.rejects(
      db.query(
        "insert into transactions(user_id,workspace_id,record_kind,is_savings,amount,category,date,goal_id) values ($1,$2,'income',true,10,'Work',current_date,$3)",
        [A, wid, gid],
      ),
      /foreign key|Workspace is not available/,
    );
});
test("record editing persists and goal deletion unlinks historical records without changing amounts", async () => {
  await as(A);
  await db.query("update transactions set amount=175.50,note=$1 where id=$2", [
    "Edited",
    TA,
  ]);
  await db.query("delete from goals where id=$1", [GA]);
  const t = (await db.query("select * from transactions where id=$1", [TA]))
    .rows[0];
  assert.equal(t.goal_id, null);
  assert.equal(Number(t.amount), 175.5);
  assert.equal(t.note, "Edited");
  assert.equal(t.workspace_id, WA);
});
test("server constraints reject invalid money, dates, kinds, categories and business savings", async () => {
  await as(A);
  for (const amount of [0, -1, 1000000000, "NaN", "Infinity"])
    await assert.rejects(
      db.query(
        "insert into transactions(user_id,workspace_id,record_kind,is_savings,amount,category,date) values ($1,$2,'expense',false,$3,'Food',current_date)",
        [A, WA, amount],
      ),
    );
  for (const [kind, saved, cat, wid] of [
    ["invalid", false, "Other", WA],
    ["expense", false, "Work", WA],
    ["income", true, "Sales", BIZ],
    ["saving", true, "Savings", BIZ],
    ["expense", false, "Food", BIZ],
  ])
    await assert.rejects(
      db.query(
        "insert into transactions(user_id,workspace_id,record_kind,is_savings,amount,category,date) values ($1,$2,$3,$4,10,$5,current_date)",
        [A, wid, kind, saved, cat],
      ),
      /category|savings|constraint/,
    );
  await assert.rejects(
    db.query(
      "insert into transactions(user_id,workspace_id,record_kind,is_savings,amount,category,date) values ($1,$2,'income',false,10,'Work','2026-02-30')",
      [A, WA],
    ),
    /date/,
  );
  await assert.rejects(
    db.query("update workspaces set currency='XYZ' where id=$1", [WA]),
    /check constraint/,
  );
  await assert.rejects(
    db.query("update workspaces set kind='business' where id=$1", [WA]),
    /cannot be changed/,
  );
  await assert.rejects(
    db.query(
      "insert into goals(user_id,workspace_id,name,target) values ($1,$2,'Invalid',10)",
      [A, BIZ],
    ),
    /personal workspace/,
  );
  await db.query(
    "insert into transactions(user_id,workspace_id,record_kind,is_savings,amount,category,date) values ($1,$2,'income',false,1000,'Sales',current_date)",
    [A, BIZ],
  );
});
test("onboarding Both is idempotent, scoped and only completes after both workspaces", async () => {
  await as(N);
  await db.query("insert into profiles(user_id) values ($1)", [N]);
  await assert.rejects(
    db.query("select nectar_initialize_workspaces($1,$2)", [A, "both"]),
    /Authentication required/,
  );
  await db.query("select nectar_initialize_workspaces($1,$2)", [N, "both"]);
  await db.query("select nectar_initialize_workspaces($1,$2)", [N, "both"]);
  const { rows } = await db.query(
    "select * from workspaces order by created_at",
  );
  assert.deepEqual(
    rows.map((w) => w.kind),
    ["personal", "business"],
  );
  assert.equal((await db.query("select * from transactions")).rows.length, 0);
  await db.query("select nectar_complete_workspace($1,$2)", [N, rows[0].id]);
  assert.equal(
    (await db.query("select onboarding_completed from profiles")).rows[0]
      .onboarding_completed,
    false,
  );
  await assert.rejects(
    db.query("select nectar_complete_workspace($1,$2)", [N, WA]),
    /not available/,
  );
  await db.query("select nectar_complete_workspace($1,$2)", [N, rows[1].id]);
  assert.equal(
    (await db.query("select onboarding_completed from profiles")).rows[0]
      .onboarding_completed,
    true,
  );
});
test("anonymous users cannot read financial tables or call onboarding RPCs", async () => {
  await db.exec("reset role;set role anon;");
  for (const table of ["profiles", "goals", "transactions", "workspaces"])
    await assert.rejects(
      db.query(`select * from ${table}`),
      /permission denied/,
    );
  await assert.rejects(
    db.query("select nectar_initialize_workspaces($1,$2)", [A, "both"]),
    /permission denied/,
  );
});
