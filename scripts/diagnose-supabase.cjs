/* Read-only schema probes: no login, no writes, no rows or credentials logged. */
const fs = require("node:fs");
const vm = require("node:vm");
const { validateConfig } = require("../js/backend.js");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync("config.js", "utf8"), context, {
  timeout: 1000,
});
const { url, key } = validateConfig(
  context.window.NECTARSPEND_CONFIG || context.window.FOLD_CONFIG,
);
const selects = {
  profiles: "user_id,name,onboarding_completed,usage_mode",
  workspaces:
    "id,user_id,name,kind,currency,starting_balance,monthly_spend_cap,setup_completed,created_at",
  goals: "id,user_id,workspace_id,name,target,created_at",
  transactions:
    "id,user_id,workspace_id,type,record_kind,is_savings,amount,category,note,date,goal_id,created_at",
};
(async () => {
  for (const [table, columns] of Object.entries(selects)) {
    const target = new URL("/rest/v1/" + table, url);
    target.searchParams.set("select", columns);
    target.searchParams.set("limit", "0");
    const headers = { apikey: key };
    if (!key.startsWith("sb_publishable_"))
      headers.Authorization = "Bearer " + key;
    try {
      const response = await fetch(target, {
        headers,
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      const code =
        typeof data.code === "string" && /^[A-Z0-9_]+$/.test(data.code)
          ? data.code
          : undefined;
      // Only match identifiers already present in our public schema contract.
      const missing =
        code === "42703"
          ? columns
              .split(",")
              .filter(
                (c) =>
                  String(data.message).includes("." + c + " ") ||
                  String(data.message).includes('"' + c + '"'),
              )
          : [];
      console.log(
        JSON.stringify({
          table,
          status: response.status,
          code,
          missing,
          scope: "anonymous schema probe; no records requested",
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          table,
          kind: "network",
          name: error.name,
          code: error.cause?.code || null,
        }),
      );
      process.exitCode = 1;
    }
  }
})();
