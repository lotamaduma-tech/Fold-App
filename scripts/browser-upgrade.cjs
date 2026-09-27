const fs=require('node:fs');let s=fs.readFileSync('tests/browser.cjs','utf8');
s=s.replaceAll('FOLD_','NECTARSPEND_').replaceAll('Add money','Add record').replaceAll('Create a Fold account','Create a NectarSpend account').replaceAll('I saved','Money in').replaceAll('[data-filter=spent]','[data-filter=expense]').replaceAll('[data-filter=saved]','[data-filter=income]').replaceAll('"Could not save"','"complete this request"');
let a=s.indexOf('  async function setup('),b=s.indexOf('  try {',a);
s=s.slice(0,a)+`  async function setup(start='30000',kind='personal',mode=null){
    await page.locator('#setup-form').waitFor();
    if(mode){await page.locator('#setup-form select').selectOption(mode);await click('#setup-form .primary');await text('.setup h1','Your everyday currency');}
    await click('#setup-form .primary');
    await page.locator('#setup-form input').fill(start);
    await click('#setup-form .primary');
    if(kind==='personal')await page.getByRole('button',{name:'Skip for now'}).click();
    await page.getByRole('button',{name:'Continue to workspace'}).click();
  }
`+s.slice(b);
s=s.replace('await page.locator("[name=goalId]").selectOption({ index: 1 });','await page.locator("#record-savings").check();\n    await page.locator("[name=goalId]").selectOption({ index: 1 });');
a=s.indexOf('    await click("[data-action=restore]")');b=s.indexOf('    fs.mkdirSync(',a);
s=s.slice(0,a)+'    await click("nav [data-page=home]");\n    await balance("$53,500");\n'+s.slice(b);
// All later Alice assertions now retain the actual edits, without a production reset.
a=s.indexOf('    fs.mkdirSync(');s=s.slice(0,a)+s.slice(a).replaceAll('55,500','53,500');
s=s.replace('await setup("0");','await setup("0", "personal", "personal");\n    await balance("₦0");');
a=s.indexOf('    await text("#sheet-title", "Check your email");');b=s.indexOf('    await logout();',a);
s=s.slice(0,a)+`    await text('.setup h1','How will you use NectarSpend?');
    await setup('30000','personal','both');
    await text('.setup h1','Your everyday currency');
    await setup('5000','business');
    await balance('5,000');
    assert.equal(await page.locator('nav [data-page=records]').count(),1);
    await click('[data-action=workspaces]');
    await page.locator('.workspace-list button').filter({hasText:'Personal'}).click();
    await balance('30,000');
`+s.slice(b);
a=s.indexOf('    await click("[data-action=clear]")');b=s.indexOf('    // Sign-out in another tab',a);
s=s.slice(0,a)+'    await click("nav [data-page=home]");\n    await balance("53,500");\n'+s.slice(b);
s=s.replace('    const plain = await unconfigured.newPage();',`    await unconfigured.route('**/config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.NECTARSPEND_CONFIG={};'}));
    const plain = await unconfigured.newPage();`);
s=s.replace('confirmation, PKCE','direct signup, Both onboarding, PKCE');
const marker='    for (const width of [320, 360, 375, 390, 412, 430, 1440]) {';
s=s.replace(marker,fs.readFileSync('scripts/browser-workspaces.part','utf8')+'\n'+marker);
fs.writeFileSync('tests/browser.cjs',s);
