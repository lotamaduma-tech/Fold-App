// Test-only historical data fixture; never served to users.
const { localDate, id } = require("../js/core.js");
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

module.exports = { sampleData };
