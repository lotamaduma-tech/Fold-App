/* Official SDK + test Auth transport + real PostgreSQL schema/RLS.
   Live email delivery, Google and hosted Supabase require project credentials. */
const { chromium } = require(process.env.FOLD_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { fixture } = require("./supabase-fixture.cjs");
const base = process.env.FOLD_TEST_URL || "http://127.0.0.1:4174";
(async () => {
  const backend = await fixture();
  const browser = await chromium.launch({
    ...(process.env.FOLD_BROWSER_PATH
      ? { executablePath: process.env.FOLD_BROWSER_PATH }
      : process.platform === "win32"
        ? {
            executablePath:
              "C:/Program Files/Google/Chrome/Application/chrome.exe",
          }
        : {}),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await backend.install(context);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const click = (selector) => page.locator(selector).click();
  const text = async (selector, part) =>
    page.waitForFunction(
      ([s, p]) => document.querySelector(s)?.textContent.includes(p),
      [selector, part],
    );
  const balance = (amount) => text(".balance-card .display", amount);
  const sheetClosed = () =>
    page.waitForFunction(() => !document.querySelector("dialog").open);
  async function login(
    email = "alice@example.test",
    password = "fixture-password-123",
  ) {
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.locator("[name=email]").fill(email);
    await page.locator("[name=password]").fill(password);
    await click("#auth-form [type=submit]");
  }
  async function logout() {
    await click("nav [data-page=you]");
    await click("[data-action=logout]");
    await page.locator(".welcome").waitFor();
  }
  async function setup(start = "30000") {
    await page.locator("#setup-form").waitFor();
    await click("#setup-form .primary");
    await page.locator("#setup-form input").fill(start);
    await click("#setup-form .primary");
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: "Open Fold" }).click();
    await balance(Number(start).toLocaleString("en"));
  }
  try {
    await page.goto(base);
    await page.locator(".welcome").waitFor();
    assert.equal(await page.locator(".balance-card").count(), 0);
    await page.evaluate(() =>
      localStorage.setItem(
        "fold-budget-v1",
        JSON.stringify({
          profile: { name: "OLD USER SECRET" },
          transactions: [],
        }),
      ),
    );
    await login("alice@example.test", "wrong-password");
    await text("#auth-error", "incorrect");
    await page.locator("[name=password]").fill("fixture-password-123");
    await click("#auth-form [type=submit]");
    await balance("55,500");
    assert.equal(await page.locator("nav svg").count(), 4);
    assert.ok(
      !(await page.locator("body").innerText()).includes("OLD USER SECRET"),
    );
    await page.getByRole("button", { name: "Add money", exact: true }).click();
    await click("#money-form .primary");
    await text("#money-error", "Enter an amount");
    await page.locator("#money-amount").fill("2000");
    await text("#amount-words", "Two thousand");
    await page.locator("[name=note]").fill("Test lunch");
    backend.failNextWrite();
    await click("#money-form .primary");
    await text("#money-error", "Could not save");
    assert.equal(await page.locator("#money-amount").inputValue(), "2000");
    await balance("55,500");
    backend.delayNextWrite(400);
    await click("#money-form .primary");
    assert.equal(await page.locator("#money-form .primary").isDisabled(), true);
    await sheetClosed();
    await balance("53,500");
    await page.reload();
    await balance("53,500");
    await page.getByRole("button", { name: "Add money", exact: true }).click();
    await page.getByRole("button", { name: "I saved", exact: true }).click();
    await page.locator("#money-amount").fill("1000");
    await page.locator("[name=goalId]").selectOption({ index: 1 });
    await page.locator("[name=note]").fill("Test save");
    await click("#money-form .primary");
    await sheetClosed();
    await balance("54,500");
    await click("nav [data-page=history]");
    await page.locator("#history-search").fill("Test save");
    assert.equal(await page.locator(".transaction").count(), 1);
    await click("[data-filter=spent]");
    assert.equal(await page.locator(".transaction").count(), 0);
    await click("[data-filter=saved]");
    await click(".transaction");
    await page
      .getByRole("button", { name: "Delete this entry", exact: true })
      .click();
    await click("[data-action=confirm-entry]");
    await sheetClosed();
    await click("nav [data-page=goals]");
    await text(".goal-card", "8,000");
    await page.locator("[data-action=goal-options]").first().click();
    await page
      .getByRole("button", { name: "Delete goal", exact: true })
      .click();
    await click("[data-action=confirm-goal]");
    await sheetClosed();
    await click("nav [data-page=home]");
    await balance("53,500");
    await click("nav [data-page=goals]");
    await page.getByRole("button", { name: "New goal", exact: false }).click();
    await page.locator("#goal-form [name=name]").fill("<Test & trip>");
    await page.locator("#goal-form [name=target]").fill("12000");
    await page.getByRole("button", { name: "Save goal", exact: true }).click();
    await sheetClosed();
    await text("#app", "<Test & trip>");
    await click("nav [data-page=you]");
    await click("[data-action=edit-currency]");
    await page.locator("#profile-form select").selectOption("USD");
    await page.getByRole("button", { name: "Save changes" }).click();
    await sheetClosed();
    await click("nav [data-page=home]");
    await balance("$53,500");
    await click("nav [data-page=you]");
    await click("[data-action=edit-name]");
    await page.locator("#profile-form input").fill("<Alice & Co>");
    await page.getByRole("button", { name: "Save changes" }).click();
    await sheetClosed();
    await text(".profile-card", "<Alice & Co>");
    for (const width of [320, 360, 375, 390, 412, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of ["home", "history", "goals", "you"]) {
        await click(`nav [data-page=${tab}]`);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${tab} overflow at ${width}`,
        );
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await click("[data-action=restore]");
    await click("[data-action=confirm-restore]");
    await sheetClosed();
    await page.locator(".profile-card").waitFor();
    await click("nav [data-page=home]");
    await balance("55,500");
    fs.mkdirSync("tests/artifacts", { recursive: true });
    await page.screenshot({ path: "tests/artifacts/home.png", fullPage: true });
    await page.getByRole("button", { name: "Add money", exact: true }).click();
    await page.locator("#money-amount").fill("2000");
    await page.screenshot({ path: "tests/artifacts/add-money.png" });
    await page.keyboard.press("Escape");
    await sheetClosed();
    backend.failNextLoad();
    await page.reload();
    await page.getByRole("button", { name: "Try again" }).waitFor();
    assert.equal(await page.locator(".balance-card").count(), 0);
    backend.restoreNetwork();
    await click("[data-action=retry]");
    await balance("55,500");
    const second = await browser.newContext();
    await backend.install(second);
    const device = await second.newPage();
    await device.goto(base);
    await device.getByRole("button", { name: "Log in", exact: true }).click();
    await device.locator("[name=email]").fill("alice@example.test");
    await device.locator("[name=password]").fill("fixture-password-123");
    await device.locator("#auth-form [type=submit]").click();
    await device.waitForFunction(() =>
      document.querySelector(".balance-card")?.textContent.includes("55,500"),
    );
    await second.close();
    await logout();
    await login("bob@example.test");
    await setup("0");
    assert.ok(!(await page.locator("#app").innerText()).includes("Lunch"));
    assert.equal(await page.locator(".transaction").count(), 0);
    await logout();
    await page
      .getByRole("button", { name: "Create a Fold account", exact: true })
      .click();
    await page.locator("[name=email]").fill("new@example.test");
    await page.locator("[name=password]").fill("fixture-password-123");
    await page.getByRole("button", { name: "Show password" }).click();
    assert.equal(
      await page.locator("[name=password]").getAttribute("type"),
      "text",
    );
    await click("#auth-form [type=submit]");
    await text("#sheet-title", "Check your email");
    assert.equal(await page.locator(".balance-card").count(), 0);
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "Back to welcome" }).click();
    backend.accounts.get("new@example.test").confirmed = true;
    await login("new@example.test");
    await setup();
    await logout();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await click("[data-action=google]");
    await page.waitForURL("**/auth/v1/authorize?**");
    const oauth = new URL(page.url());
    assert.equal(oauth.searchParams.get("provider"), "google");
    assert.equal(
      oauth.searchParams.get("redirect_to"),
      base + "/?auth=callback",
    );
    assert.ok(oauth.searchParams.get("code_challenge"));
    await page.goto(base + "/?auth=callback&code=oauth-code");
    await balance("₦0");
    assert.equal(new URL(page.url()).search, "");
    await logout();
    await page.goto(base + "/?auth=callback&error=access_denied");
    await text(".error", "cancelled");
    assert.equal(await page.locator(".balance-card").count(), 0);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await click("[data-action=forgot]");
    await page
      .locator("#recovery-form [name=email]")
      .fill("alice@example.test");
    await click("#recovery-form .primary");
    await text("#sheet-title", "Check your email");
    await page.goto(base + "/?auth=recovery&code=recovery-code");
    await page.locator("#password-form").waitFor();
    await page.locator("[name=password]").fill("new-fixture-password");
    await page.locator("[name=confirmation]").fill("mismatch-password");
    await click("#password-form .primary");
    await text("#password-error", "do not match");
    await page.locator("[name=confirmation]").fill("new-fixture-password");
    await click("#password-form .primary");
    await balance("55,500");
    assert.equal(
      backend.accounts.get("alice@example.test").password,
      "new-fixture-password",
    );
    await click("nav [data-page=you]");
    await click("[data-action=clear]");
    await click("[data-action=confirm-clear]");
    await page.locator("#setup-form").waitFor();
    await setup("0");
    await page.reload();
    await balance("₦0");
    // Sign-out in another tab must clear an open form and discard a late save response.
    const otherTab = await context.newPage();
    await otherTab.goto(base);
    await otherTab.locator(".balance-card").waitFor();
    await page.getByRole("button", { name: "Add money", exact: true }).click();
    await page.locator("#money-amount").fill("99");
    await page.locator("#money-form [name=note]").fill("Private late entry");
    backend.delayNextWrite(1500);
    const lateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/rest/v1/transactions") &&
        response.request().method() === "POST",
    );
    await click("#money-form .primary");
    await otherTab.locator("nav [data-page=you]").click();
    await otherTab.locator("[data-action=logout]").click();
    await page.locator(".welcome").waitFor();
    await lateResponse;
    await otherTab.close();
    assert.equal(await page.locator(".balance-card").count(), 0);
    assert.equal(await page.locator("dialog").isVisible(), false);
    await login("bob@example.test");
    await balance("₦0");
    assert.ok(
      !(await page.locator("body").innerText()).includes("Private late entry"),
    );
    // Unconfigured production bundle fails closed, with no test transport available.
    const unconfigured = await browser.newContext();
    const plain = await unconfigured.newPage();
    await plain.goto(base);
    await plain.waitForFunction(() =>
      document.querySelector(".error")?.textContent.includes("config.js"),
    );
    assert.equal(await plain.locator(".balance-card").count(), 0);
    await unconfigured.close();
    const expired = await browser.newContext();
    await backend.install(expired);
    const expiredPage = await expired.newPage();
    await expiredPage.goto(base + "/?auth=recovery&code=expired-code");
    await expiredPage.waitForFunction(() =>
      document.querySelector(".error")?.textContent.includes("recovery link"),
    );
    assert.equal(await expiredPage.locator("#password-form").count(), 0);
    await expired.close();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: official SDK auth/data flows with test transport; PostgreSQL persistence, UI regression, 7 widths, failure/retry, confirmation, PKCE, recovery, two accounts and two browser contexts. No page errors.",
    );
  } catch (error) {
    console.error(
      "Visible test state:",
      await page.locator("body").innerText(),
    );
    console.error("Test request paths:", backend.calls);
    console.error("Page errors:", errors);
    throw error;
  } finally {
    await browser.close();
    await backend.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
