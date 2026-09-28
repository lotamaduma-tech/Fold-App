const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  R = require("../js/records.js");
const record = (kind, amount, category, extra = {}) => ({
  kind,
  amount,
  category,
  date: "2026-09-27",
  isSavings: kind === "saving",
  ...extra,
});
const state = (transactions) => ({
  profile: { startingBalance: 1000 },
  transactions,
});
test("personal totals count income once and savings allocations never inflate balance", () => {
  const s = state([
    record("income", 100.1, "Salary", { isSavings: true, goalId: "g" }),
    record("income", 50.2, "Work"),
    record("expense", 30.3, "Food"),
    record("saving", 20, "Savings", { goalId: "g" }),
  ]);
  assert.deepEqual(R.totals(s, "2026-09"), {
    income: 150.3,
    spent: 30.3,
    saved: 120.1,
    balance: 1120,
    monthIncome: 150.3,
    monthSpent: 30.3,
    monthSaved: 120.1,
  });
  assert.equal(R.progress(s, "g"), 120.1);
  s.transactions[0].amount = 200.1;
  assert.equal(R.totals(s).balance, 1220);
  assert.equal(R.progress(s, "g"), 220.1);
  s.transactions.splice(0, 1);
  assert.equal(R.progress(s, "g"), 20);
});
test("legacy saved records retain their original income and savings meaning", () => {
  const s = require("./sample.cjs").sampleData();
  assert.equal(R.totals(s).balance, 55500);
  assert.equal(R.totals(s).saved, 18000);
  assert.equal(R.progress(s, s.goals[0].id), 8000);
});
test("business cash movement is distinct from sales revenue and simple operating result", () => {
  const s = state([
    record("income", 1000, "Sales"),
    record("income", 500, "Loan"),
    record("income", 100, "Owner funding"),
    record("expense", 600, "Stock"),
    record("expense", 200, "Rent"),
    record("expense", 50, "Delivery"),
    record("expense", 100, "Owner draw"),
    record("expense", 100, "Loan repayment"),
  ]);
  const v = R.summary(s, "month", "2026-09-27");
  assert.equal(v.income, 1600);
  assert.equal(v.expenses, 1050);
  assert.equal(v.difference, 550);
  assert.equal(v.revenue, 1000);
  assert.equal(v.operatingCosts, 250);
  assert.equal(v.operatingResult, 750);
  assert.equal(v.stock, 600);
  assert.equal(v.categories[0].name, "Stock");
  assert.equal(R.totals(s).balance, 1550);
});
test("weekly/monthly summaries respect calendar boundaries and empty periods", () => {
  assert.deepEqual(R.periodRange("week", "2026-09-27"), {
    from: "2026-09-21",
    to: "2026-09-27",
  });
  assert.deepEqual(R.periodRange("month", "2024-02-15"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  const s = state([
    record("income", 10, "Work", { date: "2026-09-20" }),
    record("expense", 3, "Food"),
  ]);
  assert.equal(R.summary(s, "week", "2026-09-27").difference, -3);
  assert.equal(R.summary(s, "month", "2026-10-01").count, 0);
});
test("record validation rejects malformed amounts, dates, categories and incompatible savings", () => {
  for (const amount of [NaN, Infinity, 0, -1, 1.001, 1000000000])
    assert.throws(() =>
      R.validateRecord(record("income", amount, "Salary"), "personal"),
    );
  for (const date of ["2026-02-30", "not-date", "2026-1-01", "0000-01-01", ""])
    assert.throws(() =>
      R.validateRecord(record("income", 1, "Salary", { date }), "personal"),
    );
  for (const r of [
    record("expense", 1, "Salary"),
    record("income", 1, "Salary", { goalId: "g" }),
    record("invalid", 1, "Other"),
  ])
    assert.throws(() => R.validateRecord(r, "personal"));
  assert.throws(() =>
    R.validateRecord(record("saving", 1, "Savings"), "business"),
  );
  assert.throws(() =>
    R.validateRecord(
      record("income", 1, "Sales", { isSavings: true }),
      "business",
    ),
  );
  assert.throws(() => R.validateRecord(record("income", 1, "Work"), "unowned"));
  assert.ok(R.validateRecord(record("income", 12.34, "Sales"), "business"));
  assert.ok(
    R.validateRecord(
      record("saving", 12, "Savings", { goalId: "g" }),
      "personal",
    ),
  );
});
