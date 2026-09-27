const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/core.js");
test("sample ledger and both linked savings contribute correctly", () => {
  const s = require('./sample.cjs').sampleData();
  assert.equal(C.totals(s).balance, 55500);
  assert.equal(C.totals(s).saved, 18000);
  assert.equal(C.totals(s).spent, 7500);
  assert.equal(C.progress(s, s.goals[0].id), 8000);
});
test("spent, saved, removal, and goal deletion preserve ledger invariants", () => {
  const s = require('./sample.cjs').sampleData(),
    goal = s.goals[0].id;
  s.transactions.push({
    id: "new",
    type: "spent",
    amount: 125.5,
    date: C.localDate(),
    goalId: null,
  });
  assert.equal(C.totals(s).balance, 55374.5);
  s.transactions.pop();
  s.transactions.push({
    id: "new",
    type: "saved",
    amount: 2000,
    date: C.localDate(),
    goalId: goal,
  });
  assert.equal(C.totals(s).balance, 57500);
  assert.equal(C.progress(s, goal), 10000);
  C.deleteGoal(s, goal);
  assert.equal(s.transactions.length, 8);
  assert.ok(s.transactions.every((t) => t.goalId !== goal));
  assert.equal(C.totals(s).balance, 57500);
  s.transactions.pop();
  assert.equal(C.totals(s).balance, 55500);
});
test("monthly sums respect transaction dates across month boundaries", () => {
  const s = require('./sample.cjs').sampleData();
  s.transactions = [
    { type: "spent", amount: 400, date: "2026-09-30" },
    { type: "spent", amount: 900, date: "2026-10-01" },
    { type: "saved", amount: 1000, date: "2026-09-01" },
  ];
  assert.equal(C.totals(s, "2026-09").monthSpent, 400);
  assert.equal(C.totals(s, "2026-09").monthSaved, 1000);
});
test("number words cover zero, groups, and upper boundary", () => {
  assert.equal(C.numberToWords(0), "Zero");
  assert.equal(C.numberToWords(2000), "Two thousand");
  assert.equal(C.numberToWords(5000), "Five thousand");
  assert.equal(C.numberToWords(1000001), "One million one");
  assert.equal(
    C.numberToWords(999999999),
    "Nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine",
  );
  assert.equal(C.numberToWords(-1), "");
  assert.equal(C.numberToWords(1000000000), "");
});
test("all supported currencies format integers and preserve cents", () => {
  C.currencies.forEach((c) => {
    assert.ok(C.formatCurrency(55500, c).includes("55,500"));
    assert.ok(C.formatCurrency(2.25, c).includes("2.25"));
  });
});
