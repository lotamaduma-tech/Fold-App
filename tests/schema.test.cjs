const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002";
const GA = "10000000-0000-4000-8000-000000000001",
  GB = "10000000-0000-4000-8000-000000000002";
const TA = "20000000-0000-4000-8000-000000000001";
let db;
const sql = fs.readFileSync("supabase/schema.sql", "utf8");
async function as(user) {
  await db.exec(
    `reset role; set role authenticated; set request.jwt.claim.sub='${user}';`,
  );
}
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth,public to anon,authenticated; grant execute on function auth.uid() to anon,authenticated; insert into auth.users values ('${A}'),('${B}');`,
  );
  await db.exec(sql);
  await db.exec(sql); // Migration is rerunnable without destroying data.
  await as(A);
  await db.query("insert into profiles(user_id) values ($1)", [A]);
  await db.query(
    "insert into goals(id,user_id,name,target) values ($1,$2,$3,1000)",
    [GA, A, "Alice goal"],
  );
  await as(B);
  await db.query("insert into profiles(user_id) values ($1)", [B]);
  await db.query(
    "insert into goals(id,user_id,name,target) values ($1,$2,$3,2000)",
    [GB, B, "Bob goal"],
  );
});
after(async () => {
  await db?.close();
});
test("RLS is enabled and forced on all financial tables", async () => {
  await db.exec("reset role");
  const { rows } = await db.query(
    "select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('profiles','transactions','goals')",
  );
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity));
});
test("authenticated user cannot select, update, delete, insert or take ownership of another user records", async () => {
  await as(A);
  for (const table of ["profiles", "goals", "transactions"])
    assert.equal(
      (await db.query(`select * from ${table} where user_id=$1`, [B])).rows
        .length,
      0,
    );
  assert.equal(
    (
      await db.query(
        "update profiles set starting_balance=999 where user_id=$1 returning *",
        [B],
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query("delete from goals where user_id=$1 returning *", [B])).rows
      .length,
    0,
  );
  await assert.rejects(
    db.query("insert into goals(user_id,name,target) values ($1,$2,10)", [
      B,
      "Intrusion",
    ]),
    /row-level security/,
  );
  await assert.rejects(
    db.query("update goals set user_id=$1 where id=$2", [B, GA]),
    /row-level security/,
  );
  await assert.rejects(
    db.query("update profiles set user_id=$1 where user_id=$2", [B, A]),
    /row-level security/,
  );
});
test("same-owner composite foreign key rejects cross-user goal association", async () => {
  await as(A);
  await assert.rejects(
    db.query(
      "insert into transactions(user_id,type,amount,category,date,goal_id) values ($1,'saved',10,'Work',current_date,$2)",
      [A, GB],
    ),
    /foreign key/,
  );
});
test("goal deletion unlinks transactions atomically without changing money", async () => {
  await as(A);
  await db.query(
    "insert into transactions(id,user_id,type,amount,category,date,goal_id) values ($1,$2,'saved',125.50,'Work',current_date,$3)",
    [TA, A, GA],
  );
  await db.query("delete from goals where id=$1", [GA]);
  const { rows } = await db.query(
    "select user_id,amount,goal_id from transactions where id=$1",
    [TA],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].goal_id, null);
  assert.equal(Number(rows[0].amount), 125.5);
  assert.equal(rows[0].user_id, A);
});
test("money, currencies and categories have server constraints", async () => {
  await as(A);
  for (const amount of [0, -1, 1000000000])
    await assert.rejects(
      db.query(
        "insert into transactions(user_id,type,amount,category,date) values ($1,'spent',$2,'Food',current_date)",
        [A, amount],
      ),
      /check constraint/,
    );
  await assert.rejects(
    db.query(
      "insert into transactions(user_id,type,amount,category,date) values ($1,'spent',10,'Work',current_date)",
      [A],
    ),
    /check constraint/,
  );
  await assert.rejects(
    db.query("update profiles set currency='XYZ' where user_id=$1", [A]),
    /check constraint/,
  );
});
test("confirmed sample/reset RPC stays scoped, preserves identity, rolls back failures", async () => {
  await as(A);
  await db.query("select fold_replace_notebook($1,true,$2)", [A, "2026-09-27"]);
  let totals = await db.query(
    "select sum(case when type='saved' then amount else -amount end) as net,count(*)::int as count from transactions",
  );
  assert.equal(totals.rows[0].count, 7);
  assert.equal(Number(totals.rows[0].net), 10500);
  await assert.rejects(
    db.query("select fold_replace_notebook($1,false,$2)", [B, "2026-09-27"]),
    /Authentication changed/,
  );
  assert.equal(
    (await db.query("select count(*)::int as n from transactions")).rows[0].n,
    7,
  );
  await assert.rejects(
    db.query("select fold_replace_notebook($1,true,$2)", [A, "0001-01-01"]),
    /Invalid sample date/,
  );
  assert.equal(
    (await db.query("select count(*)::int as n from transactions")).rows[0].n,
    7,
  );
  await db.query("select fold_replace_notebook($1,false,$2)", [
    A,
    "2026-09-27",
  ]);
  assert.equal((await db.query("select * from transactions")).rows.length, 0);
  assert.equal(
    (await db.query("select * from profiles")).rows[0].onboarding_completed,
    false,
  );
  await as(B);
  assert.equal((await db.query("select * from goals")).rows[0].id, GB);
});
test("anonymous callers have no financial table or reset privileges", async () => {
  await db.exec("reset role;set role anon;");
  await assert.rejects(db.query("select * from profiles"), /permission denied/);
  await assert.rejects(db.query("select * from goals"), /permission denied/);
  await assert.rejects(
    db.query("select * from transactions"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select fold_replace_notebook($1,true,current_date)", [A]),
    /permission denied/,
  );
});
