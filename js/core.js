/* Pure ledger utilities, shared by the interface and regression tests. */
(function (root) {
  "use strict";
  const currencies = ["NGN", "USD", "GBP", "EUR", "GHS", "KES"];
  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  const id = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function sampleData() {
    const goals = [
      {
        id: id(),
        name: "School books",
        target: 15000,
        createdAt: new Date().toISOString(),
      },
      {
        id: id(),
        name: "New phone",
        target: 80000,
        createdAt: new Date().toISOString(),
      },
    ];
    const rows = [
      [0, "spent", 2000, "Food", "Lunch", null],
      [0, "saved", 5000, "Allowance", "Saved for books", goals[0].id],
      [1, "spent", 800, "Transport", "Bus home", null],
      [3, "spent", 3500, "Fun", "Cinema", null],
      [5, "saved", 10000, "Work", "Weekend job", goals[1].id],
      [6, "spent", 1200, "Food", "Snacks", null],
      [10, "saved", 3000, "Gift", "Birthday money", goals[0].id],
    ];
    return {
      version: 1,
      profile: {
        name: "",
        email: "",
        currency: "NGN",
        startingBalance: 45000,
        monthlySpendCap: 25000,
      },
      goals,
      transactions: rows.map(
        ([days, type, amount, category, note, goalId], i) => {
          const d = new Date();
          d.setDate(d.getDate() - days);
          d.setHours(12 - (i % 3), 30, 0, 0);
          return {
            id: id(),
            type,
            amount,
            category,
            note,
            goalId,
            date: localDate(d),
            createdAt: d.toISOString(),
          };
        },
      ),
      session: false,
      setupComplete: false,
    };
  }
  function totals(state, month = localDate().slice(0, 7)) {
    const sum = (type, monthly = false) =>
      state.transactions
        .filter(
          (t) => t.type === type && (!monthly || t.date.startsWith(month)),
        )
        .reduce((n, t) => n + Math.round(t.amount * 100), 0) / 100;
    const saved = sum("saved"),
      spent = sum("spent");
    return {
      saved,
      spent,
      balance:
        (Math.round(state.profile.startingBalance * 100) +
          Math.round(saved * 100) -
          Math.round(spent * 100)) /
        100,
      monthSaved: sum("saved", true),
      monthSpent: sum("spent", true),
    };
  }
  const progress = (state, goalId) =>
    state.transactions
      .filter((t) => t.type === "saved" && t.goalId === goalId)
      .reduce((n, t) => n + Math.round(t.amount * 100), 0) / 100;
  function deleteGoal(state, goalId) {
    state.goals = state.goals.filter((g) => g.id !== goalId);
    state.transactions.forEach((t) => {
      if (t.goalId === goalId) t.goalId = null;
    });
  }
  function formatCurrency(value, currency = "NGN") {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }
  function numberToWords(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0 || n > 999999999) return "";
    const small = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
      "thirteen",
      "fourteen",
      "fifteen",
      "sixteen",
      "seventeen",
      "eighteen",
      "nineteen",
    ];
    const tens = [
      "",
      "",
      "twenty",
      "thirty",
      "forty",
      "fifty",
      "sixty",
      "seventy",
      "eighty",
      "ninety",
    ];
    function words(x) {
      if (x < 20) return small[x];
      if (x < 100)
        return tens[Math.floor(x / 10)] + (x % 10 ? "-" + small[x % 10] : "");
      for (const [unit, label] of [
        [1000000, "million"],
        [1000, "thousand"],
        [100, "hundred"],
      ])
        if (x >= unit)
          return (
            words(Math.floor(x / unit)) +
            " " +
            label +
            (x % unit ? " " + words(x % unit) : "")
          );
    }
    const result = words(n);
    return result[0].toUpperCase() + result.slice(1);
  }
  const api = {
    currencies,
    localDate,
    id,
    sampleData,
    totals,
    progress,
    deleteGoal,
    formatCurrency,
    numberToWords,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.FoldCore = api;
})(globalThis);
