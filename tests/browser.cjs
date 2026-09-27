/* Official SDK + test Auth transport + real PostgreSQL schema/RLS.
   Live email delivery, Google and hosted Supabase require project credentials. */
const { chromium } = require(process.env.NECTARSPEND_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { fixture } = require("./supabase-fixture.cjs");
const base = process.env.NECTARSPEND_TEST_URL || "http://127.0.0.1:4174";
(async () => {
  const backend = await fixture();
  const browser = await chromium.launch({
    ...(process.env.NECTARSPEND_BROWSER_PATH
      ? { executablePath: process.env.NECTARSPEND_BROWSER_PATH }
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
  async function setup(start='30000',kind='personal',mode=null){
    await page.locator('#setup-form').waitFor();
    if(mode){await page.locator('#setup-form select').selectOption(mode);await click('#setup-form .primary');await text('.setup h1','Your everyday currency');}
    await click('#setup-form .primary');
    await page.locator('#setup-form input').fill(start);
    await click('#setup-form .primary');
    if(kind==='personal')await page.getByRole('button',{name:'Skip for now'}).click();
    await page.getByRole('button',{name:'Continue to workspace'}).click();
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
    await page.getByRole("button", { name: "Add record", exact: true }).click();
    await click("#money-form .primary");
    await text("#money-error", "Enter an amount");
    await page.locator("#money-amount").fill("2000");
    await text("#amount-words", "Two thousand");
    await page.locator("[name=note]").fill("Test lunch");
    backend.failNextWrite();
    await click("#money-form .primary");
    await text("#money-error", "complete this request");
    assert.equal(await page.locator("#money-amount").inputValue(), "2000");
    await balance("55,500");
    backend.delayNextWrite(400);
    await click("#money-form .primary");
    assert.equal(await page.locator("#money-form .primary").isDisabled(), true);
    await sheetClosed();
    await balance("53,500");
    await page.reload();
    await balance("53,500");
    await page.getByRole("button", { name: "Add record", exact: true }).click();
    await page.getByRole("button", { name: "Money in", exact: true }).click();
    await page.locator("#money-amount").fill("1000");
    await page.locator("#record-savings").check();
    await page.locator("[name=goalId]").selectOption({ index: 1 });
    await page.locator("[name=note]").fill("Test save");
    await click("#money-form .primary");
    await sheetClosed();
    await balance("54,500");
    await click("nav [data-page=history]");
    await page.locator("#history-search").fill("Test save");
    assert.equal(await page.locator(".transaction").count(), 1);
    await click("[data-filter=expense]");
    assert.equal(await page.locator(".transaction").count(), 0);
    await click("[data-filter=income]");
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
    // Edit an existing record, persist through reload, then restore its amount.
    await click('nav [data-page=history]');
    await page.locator('#history-search').fill('Test lunch');
    await click('.transaction');
    await click('[data-action=edit-record]');
    await page.locator('#money-amount').fill('2500');
    await click('#money-form .primary');await sheetClosed();
    await click('nav [data-page=home]');await balance('53,000');
    await page.reload();await balance('53,000');
    await click('nav [data-page=history]');
    await page.locator('#history-search').fill('Test lunch');await click('.transaction');await click('[data-action=edit-record]');
    await page.locator('#money-amount').fill('2000');await click('#money-form .primary');await sheetClosed();
    await click('nav [data-page=home]');await balance('53,500');
    // A savings allocation changes goal progress but never creates money.
    await click('nav [data-page=goals]');
    await page.locator('[data-action=goal-options]').last().click();await click('[data-action=allocate]');
    await page.locator('#money-amount').fill('500');await page.locator('[name=note]').fill('Allocation only');
    await click('#money-form .primary');await sheetClosed();
    await page.reload();await balance('53,500');
    await click('nav [data-page=history]');await page.locator('#history-search').fill('Allocation only');
    await click('[data-filter=saving]');assert.equal(await page.locator('.transaction').count(),1);
    await click('.activity-filters summary');await page.locator('#activity-category').selectOption('Savings');
    await page.locator('#date-from').fill('2099-01-01');assert.equal(await page.locator('.transaction').count(),0);
    await page.locator('#date-to').fill('2000-01-01');await text('#history-results','Choose an end date');
    await click('[data-action=reset-filters]');
    // Create a second workspace and verify separate data, navigation and cash/result summaries.
    await click('[data-action=workspaces]');await click('[data-action=new-workspace]');
    await page.locator('#workspace-form [name=name]').fill('My Store');await page.locator('#workspace-form [name=kind]').selectOption('business');
    await click('#workspace-form .primary');await text('.setup h1','Your everyday currency');
    await setup('1000','business');await balance('1,000');
    assert.equal(await page.locator('nav [data-page=goals]').count(),0);
    assert.equal(await page.locator('.transaction').count(),0);
    async function businessRecord(type,amount,category,note){
      await page.getByRole('button',{name:'Add record',exact:true}).click();
      await page.getByRole('button',{name:type,exact:true}).click();
      assert.equal(await page.locator('#record-savings').count(),0);
      await page.locator('#money-amount').fill(amount);
      await page.getByRole('button',{name:category,exact:true}).click();
      await page.locator('[name=note]').fill(note);await click('#money-form .primary');await sheetClosed();
    }
    await businessRecord('Money in','2000','Sales','Store sale');
    await businessRecord('Money in','500','Loan','Store loan');
    await businessRecord('Money out','600','Stock','Store stock');
    await businessRecord('Money out','200','Rent','Store rent');
    await balance('2,700');await page.reload();await balance('2,700');
    await click('nav [data-page=records]');await text('#app','Simple operating result');await text('#app','1,800');await text('#app','not accounting profit');
    await click('[data-period=week]');await text('#app','4 records');
    await page.screenshot({path:'tests/artifacts/business-summary.png',fullPage:true});
    for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'business summary overflow');}
    await click('[data-action=workspaces]');await page.locator('.workspace-list button').filter({hasText:'Personal'}).click();
    await balance('53,500');assert.ok(!(await page.locator('#app').innerText()).includes('Store sale'));
    await page.reload();await balance('53,500');
    await click('nav [data-page=you]');

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
    await click("nav [data-page=home]");
    await balance("$53,500");
    fs.mkdirSync("tests/artifacts", { recursive: true });
    await page.screenshot({ path: "tests/artifacts/home.png", fullPage: true });
    await page.getByRole("button", { name: "Add record", exact: true }).click();
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
    await balance("53,500");
    const second = await browser.newContext();
    await backend.install(second);
    const device = await second.newPage();
    await device.goto(base);
    await device.getByRole("button", { name: "Log in", exact: true }).click();
    await device.locator("[name=email]").fill("alice@example.test");
    await device.locator("[name=password]").fill("fixture-password-123");
    await device.locator("#auth-form [type=submit]").click();
    await device.waitForFunction(() =>
      document.querySelector(".balance-card")?.textContent.includes("53,500"),
    );
    await second.close();
    await logout();
    await login("bob@example.test");
    await setup("0", "personal", "personal");
    await balance("₦0");
    assert.ok(!(await page.locator("#app").innerText()).includes("Lunch"));
    assert.equal(await page.locator(".transaction").count(), 0);
    await logout();
    await page
      .getByRole("button", { name: "Create a NectarSpend account", exact: true })
      .click();
    await page.locator("[name=email]").fill("new@example.test");
    await page.locator("[name=password]").fill("fixture-password-123");
    await page.getByRole("button", { name: "Show password" }).click();
    assert.equal(
      await page.locator("[name=password]").getAttribute("type"),
      "text",
    );
    await click("#auth-form [type=submit]");
    await text('.setup h1','How will you use NectarSpend?');
    await setup('30000','personal','both');
    await text('.setup h1','Your everyday currency');
    await setup('5000','business');
    await balance('5,000');
    assert.equal(await page.locator('nav [data-page=records]').count(),1);
    await click('[data-action=workspaces]');
    await page.locator('.workspace-list button').filter({hasText:'Personal'}).click();
    await balance('30,000');
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
    await balance("53,500");
    assert.equal(
      backend.accounts.get("alice@example.test").password,
      "new-fixture-password",
    );
    await click("nav [data-page=you]");
    await click("nav [data-page=home]");
    await balance("53,500");
    // Sign-out in another tab must clear an open form and discard a late save response.
    const otherTab = await context.newPage();
    await otherTab.goto(base);
    await otherTab.locator(".balance-card").waitFor();
    await page.getByRole("button", { name: "Add record", exact: true }).click();
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
    await unconfigured.route('**/config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.NECTARSPEND_CONFIG={};'}));
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
      "PASS: official SDK auth/data flows with test transport; PostgreSQL persistence, UI regression, 7 widths, failure/retry, direct signup, Both onboarding, PKCE, recovery, two accounts and two browser contexts. No page errors.",
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
