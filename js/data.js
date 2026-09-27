/* All financial data comes from Supabase. No financial localStorage cache. */
(function (root) {
  "use strict";
  const profileColumns =
    "user_id,name,currency,starting_balance,monthly_spend_cap,onboarding_completed";
  const goalColumns = "id,user_id,name,target,created_at";
  const transactionColumns =
    "id,user_id,type,amount,category,note,date,goal_id,created_at";
  const profile = (row) => ({
    name: row.name || "",
    currency: row.currency,
    startingBalance: Number(row.starting_balance),
    monthlySpendCap: Number(row.monthly_spend_cap),
  });
  const goal = (row) => ({
    id: row.id,
    name: row.name,
    target: Number(row.target),
    createdAt: row.created_at,
  });
  const transaction = (row) => ({
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    category: row.category,
    note: row.note || "",
    date: row.date,
    goalId: row.goal_id,
    createdAt: row.created_at,
  });
  function createRepository(client, userId) {
    if (!userId) throw new Error("Authentication is required.");
    const checked = async (request) => {
      const { data, error } = await request;
      if (error) throw error;
      return data;
    };
    const own = (table) =>
      client
        .from(table)
        .select(
          table === "profiles"
            ? profileColumns
            : table === "goals"
              ? goalColumns
              : transactionColumns,
        )
        .eq("user_id", userId);
    // Fetch beyond the default API row cap. Stable ordering avoids silent truncation.
    async function all(table) {
      const rows = [];
      for (let offset = 0; ;) {
        const batch = await checked(
          own(table)
            .order("created_at")
            .order("id")
            .range(offset, offset + 499),
        );
        rows.push(...batch);
        if (!batch.length) return rows;
        offset += batch.length;
      }
    }
    async function insertOnce(table, row, columns, map) {
      const result = await client
        .from(table)
        .insert({ ...row, user_id: userId })
        .select(columns)
        .single();
      if (!result.error) return map(result.data);
      // A lost response can be retried with the same draft UUID, without double logging.
      if (result.error.code === "23505")
        return map(await checked(own(table).eq("id", row.id).single()));
      throw result.error;
    }
    return {
      async load(user) {
        if (user.id !== userId)
          throw new Error("Your account changed. Please reload.");
        let p = await checked(own("profiles").maybeSingle());
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
            .select(profileColumns)
            .single();
          if (result.error && result.error.code !== "23505") throw result.error;
          p = result.data || (await checked(own("profiles").single()));
        }
        const [goals, transactions] = await Promise.all([
          all("goals"),
          all("transactions"),
        ]);
        return {
          profile: { ...profile(p), email: user.email || "" },
          goals: goals.map(goal),
          transactions: transactions.map(transaction),
          setupComplete: p.onboarding_completed,
        };
      },
      async updateProfile(patch) {
        const fields = {
            name: "name",
            currency: "currency",
            startingBalance: "starting_balance",
            monthlySpendCap: "monthly_spend_cap",
            setupComplete: "onboarding_completed",
          },
          row = {};
        for (const [key, value] of Object.entries(patch)) {
          if (!fields[key]) throw new Error("Unknown profile field.");
          row[fields[key]] = value;
        }
        const result = await checked(
          client
            .from("profiles")
            .update(row)
            .eq("user_id", userId)
            .select(profileColumns)
            .single(),
        );
        return {
          profile: profile(result),
          setupComplete: result.onboarding_completed,
        };
      },
      createTransaction(t) {
        return insertOnce(
          "transactions",
          {
            id: t.id,
            type: t.type,
            amount: t.amount,
            category: t.category,
            note: t.note,
            date: t.date,
            goal_id: t.type === "saved" ? t.goalId : null,
          },
          transactionColumns,
          transaction,
        );
      },
      createGoal(g) {
        return insertOnce(
          "goals",
          { id: g.id, name: g.name, target: g.target },
          goalColumns,
          goal,
        );
      },
      async deleteTransaction(id) {
        await checked(
          client
            .from("transactions")
            .delete()
            .eq("user_id", userId)
            .eq("id", id),
        );
      },
      async deleteGoal(id) {
        await checked(
          client.from("goals").delete().eq("user_id", userId).eq("id", id),
        );
      },
      async replaceNotebook(sample, today) {
        await checked(
          client.rpc("fold_replace_notebook", {
            p_expected_user_id: userId,
            p_sample: sample,
            p_today: today,
          }),
        );
      },
    };
  }
  const api = { createRepository };
  if (typeof module !== "undefined") module.exports = api;
  else root.FoldData = api;
})(globalThis);
