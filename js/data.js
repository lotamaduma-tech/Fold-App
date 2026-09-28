/* Supabase repository: all financial operations are scoped to owner AND workspace. */
(function (root) {
  "use strict";
  const Errors =
    typeof module !== "undefined" ? require("./errors.js") : root.NectarErrors;
  const Core =
    typeof module !== "undefined" ? require("./core.js") : root.NectarCore;
  const Records =
    typeof module !== "undefined"
      ? require("./records.js")
      : root.NectarRecords;
  const columns = {
    profiles: "user_id,name,onboarding_completed,usage_mode",
    workspaces:
      "id,user_id,name,kind,currency,starting_balance,monthly_spend_cap,setup_completed,created_at",
    goals: "id,user_id,workspace_id,name,target,created_at",
    transactions:
      "id,user_id,workspace_id,type,record_kind,is_savings,amount,category,note,date,goal_id,created_at",
  };
  const workspace = (r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    currency: r.currency,
    startingBalance: Number(r.starting_balance),
    monthlySpendCap: Number(r.monthly_spend_cap),
    setupComplete: r.setup_completed,
    createdAt: r.created_at,
  });
  const goal = (r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    target: Number(r.target),
    createdAt: r.created_at,
  });
  const record = (r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    type: r.type,
    kind: r.record_kind,
    isSavings: r.is_savings,
    amount: Number(r.amount),
    category: r.category,
    note: r.note || "",
    date: r.date,
    goalId: r.goal_id,
    createdAt: r.created_at,
  });
  function createRepository(client, userId) {
    if (!userId) throw new Error("Authentication is required.");
    const checked = async (
      request,
      operation = "data.write",
      shape = "any",
    ) => {
      let result;
      try {
        result = await request;
      } catch (error) {
        throw Errors.from(error, { operation });
      }
      if (!result || typeof result !== "object")
        throw Errors.from({ code: "INVALID_RESPONSE" }, { operation });
      const { data, error, status } = result;
      if (error) throw Errors.from(error, { status, operation });
      const object = (value) =>
        value && typeof value === "object" && !Array.isArray(value);
      if (
        (shape === "list" && !Array.isArray(data)) ||
        (shape === "object" && !object(data)) ||
        (shape === "nullable" && data !== null && !object(data))
      )
        throw Errors.from({ code: "INVALID_RESPONSE" }, { status, operation });
      return data;
    };
    const own = (table, workspaceId) => {
      let q = client.from(table).select(columns[table]).eq("user_id", userId);
      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      return q;
    };
    async function all(table, workspaceId) {
      const rows = [];
      for (let offset = 0; ;) {
        const batch = await checked(
          own(table, workspaceId)
            .order("created_at")
            .order("id")
            .range(offset, offset + 499),
          table + ".load",
          "list",
        );
        rows.push(...batch);
        if (!batch.length) return rows;
        offset += batch.length;
      }
    }
    function requireWorkspace(id) {
      if (!id) throw new Error("Choose a workspace first.");
      return id;
    }
    async function insertOnce(table, row, map) {
      const result = await client
        .from(table)
        .insert({ ...row, user_id: userId })
        .select(columns[table])
        .single();
      if (!result.error) {
        if (
          !result.data ||
          typeof result.data !== "object" ||
          Array.isArray(result.data)
        )
          throw Errors.from(
            { code: "INVALID_RESPONSE" },
            { status: result.status, operation: table + ".insert" },
          );
        return map(result.data);
      }
      if (result.error.code === "23505")
        return map(
          await checked(
            own(table, row.workspace_id).eq("id", row.id).single(),
            table + ".retry",
            "object",
          ),
        );
      throw Errors.from(result.error, {
        status: result.status,
        operation: table + ".insert",
      });
    }
    function payload(t) {
      return {
        record_kind: t.kind,
        is_savings: !!t.isSavings,
        amount: t.amount,
        category: t.category,
        note: t.note || null,
        date: t.date,
        goal_id: t.goalId || null,
      };
    }
    return {
      async load(user, preferredId) {
        if (user.id !== userId)
          throw new Error("Your account changed. Please reload.");
        let p = await checked(
          own("profiles").maybeSingle(),
          "profiles.load",
          "nullable",
        );
        if (!p) {
          const name =
            String(
              user.user_metadata?.full_name || user.user_metadata?.name || "",
            )
              .slice(0, 40)
              .trim() || null;
          const result = await client
            .from("profiles")
            .insert({ user_id: userId, name })
            .select(columns.profiles)
            .single();
          if (result.error && result.error.code !== "23505")
            throw Errors.from(result.error, {
              status: result.status,
              operation: "profiles.insert",
            });
          p =
            result.data ||
            (await checked(
              own("profiles").single(),
              "profiles.retry",
              "object",
            ));
        }
        const workspaces = (await all("workspaces")).map(workspace);
        const active =
          (!p.onboarding_completed &&
            workspaces.find((w) => !w.setupComplete)) ||
          workspaces.find((w) => w.id === preferredId) ||
          workspaces[0] ||
          null;
        const [goals, transactions] = active
          ? await Promise.all([
              all("goals", active.id),
              all("transactions", active.id),
            ])
          : [[], []];
        return {
          profile: {
            name: p.name || "",
            email: user.email || "",
            currency: active?.currency || "NGN",
            startingBalance: active?.startingBalance || 0,
            monthlySpendCap: active?.monthlySpendCap || 0,
          },
          workspaces,
          workspace: active,
          usageMode: p.usage_mode,
          goals: goals.map(goal),
          transactions: transactions.map(record),
          setupComplete: !!(p.onboarding_completed && active?.setupComplete),
        };
      },
      async updateProfile(patch) {
        if (Object.keys(patch).some((k) => k !== "name"))
          throw new Error("Unknown profile field.");
        if (typeof patch.name !== "string" || patch.name.length > 40)
          throw new Error("Keep your name within 40 characters.");
        const p = await checked(
          client
            .from("profiles")
            .update(patch)
            .eq("user_id", userId)
            .select(columns.profiles)
            .single(),
          "profiles.update",
          "object",
        );
        return { profile: { name: p.name || "" } };
      },
      async updateWorkspace(id, patch) {
        requireWorkspace(id);
        const fields = {
            name: "name",
            currency: "currency",
            startingBalance: "starting_balance",
            monthlySpendCap: "monthly_spend_cap",
          },
          row = {};
        for (const [key, value] of Object.entries(patch)) {
          if (!fields[key]) throw new Error("Unknown workspace field.");
          if (key === "currency" && !Core.currencies.includes(value))
            throw new Error("Choose a supported currency.");
          if (
            key === "name" &&
            (typeof value !== "string" || !value.trim() || value.length > 60)
          )
            throw new Error("Give your workspace a name within 60 characters.");
          if (["startingBalance", "monthlySpendCap"].includes(key))
            validateAmount(value, true);
          row[fields[key]] = value;
        }
        return workspace(
          await checked(
            client
              .from("workspaces")
              .update(row)
              .eq("user_id", userId)
              .eq("id", id)
              .select(columns.workspaces)
              .single(),
            "workspaces.update",
            "object",
          ),
        );
      },
      createWorkspace(w) {
        if (
          !w.name?.trim() ||
          w.name.length > 60 ||
          !["personal", "business"].includes(w.kind) ||
          !Core.currencies.includes(w.currency)
        )
          throw new Error(
            "Choose a workspace name, type and supported currency.",
          );
        return insertOnce(
          "workspaces",
          { id: w.id, name: w.name, kind: w.kind, currency: w.currency },
          workspace,
        );
      },
      async initializeWorkspaces(mode) {
        if (!["personal", "business", "both"].includes(mode))
          throw new Error("Choose Personal, Business, or Both.");
        await checked(
          client.rpc("nectar_initialize_workspaces", {
            p_expected_user_id: userId,
            p_mode: mode,
          }),
          "workspaces.initialize",
        );
      },
      async completeWorkspace(id) {
        await checked(
          client.rpc("nectar_complete_workspace", {
            p_expected_user_id: userId,
            p_workspace_id: requireWorkspace(id),
          }),
          "workspaces.complete",
        );
      },
      createTransaction(t, workspaceId, workspaceKind) {
        Records.validateRecord(t, workspaceKind);
        return insertOnce(
          "transactions",
          {
            id: t.id,
            workspace_id: requireWorkspace(workspaceId),
            ...payload(t),
          },
          record,
        );
      },
      async updateTransaction(t, workspaceId, workspaceKind) {
        Records.validateRecord(t, workspaceKind);
        return record(
          await checked(
            client
              .from("transactions")
              .update(payload(t))
              .eq("user_id", userId)
              .eq("workspace_id", requireWorkspace(workspaceId))
              .eq("id", t.id)
              .select(columns.transactions)
              .single(),
            "transactions.update",
            "object",
          ),
        );
      },
      createGoal(g, workspaceId) {
        if (!g.name?.trim() || g.name.length > 60)
          throw new Error("Give your goal a name within 60 characters.");
        validateAmount(g.target);
        return insertOnce(
          "goals",
          {
            id: g.id,
            workspace_id: requireWorkspace(workspaceId),
            name: g.name,
            target: g.target,
          },
          goal,
        );
      },
      async deleteTransaction(id, workspaceId) {
        await checked(
          client
            .from("transactions")
            .delete()
            .eq("user_id", userId)
            .eq("workspace_id", requireWorkspace(workspaceId))
            .eq("id", id),
        );
      },
      async deleteGoal(id, workspaceId) {
        await checked(
          client
            .from("goals")
            .delete()
            .eq("user_id", userId)
            .eq("workspace_id", requireWorkspace(workspaceId))
            .eq("id", id),
        );
      },
    };
  }
  function validateAmount(value, zero = false) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (!zero && value === 0) ||
      value > 999999999 ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.00001
    )
      throw new Error("Enter a valid amount with up to two decimal places.");
  }
  const api = { createRepository, columns: Object.freeze(columns) };
  if (typeof module !== "undefined") module.exports = api;
  else root.NectarData = api;
})(globalThis);
