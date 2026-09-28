// Regenerate with: node scripts/social-preview.cjs
const { chromium } = require("playwright");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#f3efe6;color:#1c1814;font-family:Arial,sans-serif}
      main{width:1200px;height:630px;padding:64px 76px;position:relative}
      header{font-family:Georgia,serif;font-size:36px;letter-spacing:-1.5px}
      h1{font-family:Georgia,serif;font-weight:400;font-size:92px;line-height:1.03;letter-spacing:-4px;margin:66px 0 23px}
      p{font-size:24px;line-height:1.5;color:#6d655b;margin:0;max-width:680px}
      footer{position:absolute;bottom:54px;left:76px;right:76px;border-top:1px solid #d9d0bf;padding-top:22px;display:flex;justify-content:space-between;align-items:center;font-size:17px;color:#6d655b}
      .mark{position:absolute;right:76px;top:72px;display:flex;gap:8px;align-items:flex-end;height:32px}.mark i{display:block;width:10px;background:#2c5a43;border-radius:5px;height:16px}.mark i:nth-child(2){height:24px}.mark i:nth-child(3){height:32px}
      .pill{display:inline-block;background:#dce8e0;color:#2c5a43;border-radius:30px;padding:10px 18px;margin-right:8px;font-size:15px}
    </style></head><body><main><header>NectarSpend</header><div class="mark"><i></i><i></i><i></i></div><h1>Know your money.</h1><p>A little clarity for every day.<br>Income, expenses, savings and goals — simply kept.</p><footer><div><span class="pill">Personal</span><span class="pill">Business</span>Separate spaces. One clear picture.</div><span>nectarspend.com</span></footer></main></body></html>`);
    await page.screenshot({
      path: path.join(__dirname, "../assets/nectarspend-social.png"),
    });
    console.log("Created assets/nectarspend-social.png (1200 × 630).");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
