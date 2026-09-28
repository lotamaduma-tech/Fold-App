/* Test-only Auth/PostgREST transport. Official SDK + real PostgreSQL RLS.
   This fixture is never served to application users. */
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  crypto = require("node:crypto");
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002";
async function fixture() {
  const db = new PGlite(),
    accounts = new Map(),
    calls = [];
  let failWrite = false,
    schemaFailure = false,
    failLoad = false,
    delayWrite = 0,
    queue = Promise.resolve();
  const serial = (fn) => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`,
  );
  await db.exec(fs.readFileSync("supabase/schema.sql", "utf8"));
  function account(id, email, confirmed = true) {
    return {
      id,
      email,
      password: "fixture-password-123",
      confirmed,
      user: {
        id,
        email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [{ id, user_id: id, provider: "email" }],
        created_at: new Date().toISOString(),
      },
    };
  }
  accounts.set("alice@example.test", account(A, "alice@example.test"));
  accounts.set("bob@example.test", account(B, "bob@example.test"));
  await db.query("insert into auth.users values ($1),($2)", [A, B]);
  await db.query(
    "insert into profiles(user_id,starting_balance,monthly_spend_cap,onboarding_completed) values ($1,45000,25000,true)",
    [A],
  );
  const seed = require("./sample.cjs").sampleData();
  for (const g of seed.goals)
    await db.query(
      "insert into goals(id,user_id,name,target) values ($1,$2,$3,$4)",
      [g.id, A, g.name, g.target],
    );
  for (const t of seed.transactions)
    await db.query(
      "insert into transactions(id,user_id,type,amount,category,note,date,goal_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        t.id,
        A,
        t.type,
        t.amount,
        t.category,
        t.note,
        t.date,
        t.goalId,
        t.createdAt,
      ],
    );
  await db.exec(
    fs.readFileSync("supabase/migrations/002_workspaces.sql", "utf8"),
  );
  function session(a) {
    const now = Math.floor(Date.now() / 1000),
      encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
    return {
      access_token:
        encode({ alg: "HS256", typ: "JWT" }) +
        "." +
        encode({
          sub: a.id,
          aud: "authenticated",
          role: "authenticated",
          exp: now + 3600,
          iat: now,
        }) +
        ".fixture-signature",
      refresh_token: "fixture-refresh-" + a.id,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      user: a.user,
    };
  }
  function userFor(req) {
    try {
      const uid = JSON.parse(
        Buffer.from(
          req.headers().authorization.split(" ")[1].split(".")[1],
          "base64url",
        ),
      ).sub;
      return [...accounts.values()].find((a) => a.id === uid);
    } catch {
      return null;
    }
  }
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: {
        "x-supabase-api-version": "2024-01-01",
        "access-control-expose-headers": "X-Supabase-Api-Version",
      },
      body:
        status === 204
          ? ""
          : JSON.stringify(
              body?.code ? { ...body, error_code: body.code } : body,
            ),
    });
  async function routeRequest(route) {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method(),
      body = req.postDataJSON() || {};
    calls.push({ path, method });
    if (path === "/auth/v1/signup") {
      if (!accounts.has(body.email)) {
        const a = account(crypto.randomUUID(), body.email, true);
        a.password = body.password;
        accounts.set(body.email, a);
        await serial(async () => {
          await db.exec("reset role");
          await db.query("insert into auth.users values ($1)", [a.id]);
        });
      }
      return json(route, session(accounts.get(body.email)));
    }
    if (path === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      let a;
      if (grant === "password") {
        a = accounts.get(body.email);
        if (!a || a.password !== body.password)
          return json(
            route,
            { code: "invalid_credentials", msg: "Invalid login credentials" },
            400,
          );
        if (!a.confirmed)
          return json(
            route,
            { code: "email_not_confirmed", msg: "Email not confirmed" },
            400,
          );
      } else if (grant === "pkce") {
        a = accounts.get(
          body.auth_code === "recovery-code"
            ? "alice@example.test"
            : "bob@example.test",
        );
        if (!body.code_verifier)
          return json(
            route,
            { code: "validation_failed", msg: "Missing verifier" },
            400,
          );
      } else if (grant === "refresh_token")
        a = [...accounts.values()].find(
          (x) => body.refresh_token === "fixture-refresh-" + x.id,
        );
      return a
        ? json(route, session(a))
        : json(route, { msg: "Invalid request" }, 400);
    }
    if (path === "/auth/v1/user") {
      const a = userFor(req);
      if (!a)
        return json(route, { code: "bad_jwt", msg: "Not signed in" }, 401);
      if (method === "PUT" && body.password) a.password = body.password;
      return json(route, a.user);
    }
    if (path === "/auth/v1/logout") return json(route, null, 204);
    if (path === "/auth/v1/recover" || path === "/auth/v1/reauthenticate")
      return json(route, {});
    if (path === "/auth/v1/authorize")
      return route.fulfill({
        contentType: "text/html",
        body: "<h1>OAuth provider fixture</h1>",
      });
    if (path.startsWith("/rest/v1/")) {
      const a = userFor(req);
      if (!a)
        return json(
          route,
          { code: "42501", message: "Authentication required" },
          401,
        );
      if (method === "GET" && failLoad)
        return json(route, { message: "Could not load. Try again." }, 503);
      if (method === "GET" && schemaFailure)
        return json(
          route,
          {
            code: "42703",
            message: "column profiles.usage_mode does not exist",
            details: "PRIVATE provider details",
          },
          400,
        );
      if (method !== "GET" && failWrite) {
        failWrite = false;
        return json(route, { message: "Could not save. Try again." }, 503);
      }
      if (method !== "GET" && delayWrite) {
        const ms = delayWrite;
        delayWrite = 0;
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
      try {
        const response = await serial(async () => {
          await db.exec(
            `reset role;set role authenticated;set request.jwt.claim.sub='${a.id}';`,
          );
          if (path.endsWith("/rpc/nectar_initialize_workspaces")) {
            await db.query("select nectar_initialize_workspaces($1,$2)", [
              body.p_expected_user_id,
              body.p_mode,
            ]);
            return { rows: null };
          }
          if (path.endsWith("/rpc/nectar_complete_workspace")) {
            await db.query("select nectar_complete_workspace($1,$2)", [
              body.p_expected_user_id,
              body.p_workspace_id,
            ]);
            return { rows: null };
          }
          const table = path.split("/").at(-1);
          if (
            !["profiles", "goals", "transactions", "workspaces"].includes(table)
          )
            throw Error("Unknown table");
          const allowed = new Set([
            "workspace_id",
            "record_kind",
            "is_savings",
            "usage_mode",
            "kind",
            "setup_completed",
            "is_legacy_default",
            "id",
            "user_id",
            "name",
            "currency",
            "starting_balance",
            "monthly_spend_cap",
            "onboarding_completed",
            "target",
            "type",
            "amount",
            "category",
            "note",
            "date",
            "goal_id",
            "created_at",
          ]);
          const parameters = [],
            conditions = [],
            param = (v) => {
              parameters.push(v);
              return "$" + parameters.length;
            };
          for (const [k, v] of url.searchParams)
            if (allowed.has(k) && v.startsWith("eq."))
              conditions.push('"' + k + '"=' + param(v.slice(3)));
          const selected = url.searchParams.get("select");
          const projection = selected
            ? selected
                .split(",")
                .map((column) => {
                  if (!allowed.has(column))
                    throw Object.assign(new Error("Unknown selected column"), {
                      code: "42703",
                    });
                  return '"' + column + '"';
                })
                .join(",")
            : "*";
          let sql;
          if (method === "GET") {
            sql =
              `select ${projection} from ${table}` +
              (conditions.length ? " where " + conditions.join(" and ") : "");
            if (url.searchParams.get("order")) sql += " order by created_at,id";
            sql += ` limit ${Number(url.searchParams.get("limit") || 1000)} offset ${Number(url.searchParams.get("offset") || 0)}`;
          } else if (method === "POST") {
            const cols = Object.keys(body);
            if (cols.some((k) => !allowed.has(k)))
              throw Error("Unknown column");
            sql = `insert into ${table} (${cols.map((k) => '"' + k + '"').join(",")}) values (${cols.map((k) => param(body[k])).join(",")}) returning ${projection}`;
          } else if (method === "PATCH") {
            const cols = Object.keys(body);
            if (cols.some((k) => !allowed.has(k)))
              throw Error("Unknown column");
            sql = `update ${table} set ${cols.map((k) => '"' + k + '"=' + param(body[k])).join(",")} where ${conditions.join(" and ")} returning ${projection}`;
          } else if (method === "DELETE")
            sql = `delete from ${table} where ${conditions.join(" and ")} returning *`;
          else throw Error("Unsupported method");
          return db.query(sql, parameters);
        });
        if (Array.isArray(response.rows))
          response.rows.forEach((row) => {
            if (row.date instanceof Date)
              row.date = row.date.toISOString().slice(0, 10);
          });
        if (req.headers().accept?.includes("vnd.pgrst.object+json")) {
          if (response.rows.length !== 1)
            return json(
              route,
              {
                code: "PGRST116",
                details: `The result contains ${response.rows.length} rows`,
                message: "Cannot coerce to a single JSON object",
              },
              406,
            );
          return json(route, response.rows[0]);
        }
        return json(route, response.rows);
      } catch (error) {
        return json(
          route,
          { code: error.code || "fixture", message: error.message },
          error.code === "23505" ? 409 : 400,
        );
      }
    }
    return json(route, { message: "Unknown fixture route" }, 404);
  }
  return {
    A,
    B,
    calls,
    db,
    accounts,
    session,
    failNextWrite() {
      failWrite = true;
    },
    failNextLoad() {
      failLoad = true;
    },
    failSchemaLoad() {
      schemaFailure = true;
    },
    restoreNetwork() {
      failLoad = false;
      schemaFailure = false;
    },
    delayNextWrite(ms) {
      delayWrite = ms;
    },
    async install(context) {
      await context.route("**/config.js", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: 'window.NECTARSPEND_CONFIG={SUPABASE_URL:"https://nectar-tests.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture_only"};',
        }),
      );
      await context.route("https://nectar-tests.supabase.co/**", (route) =>
        routeRequest(route).catch((error) => {
          console.error("Fixture transport failure:", error.message);
          return route.abort();
        }),
      );
    },
    async close() {
      await queue;
      await db.close();
    },
  };
}
module.exports = { fixture };
