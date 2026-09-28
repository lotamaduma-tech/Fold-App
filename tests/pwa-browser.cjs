const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.NECTARSPEND_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();
 await page.goto(process.env.NECTARSPEND_TEST_URL || 'http://127.0.0.1:4174/');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready});
 assert.equal(await page.locator('#install-banner').isVisible(),false);
 const available=()=>page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{window.promptCalls=(window.promptCalls||0)+1};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e)});
 await available();assert.equal(await page.locator('#install-banner').isVisible(),true);
 await page.screenshot({path:'tests/artifacts/install-mobile.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.click('#install-app');assert.equal(await page.evaluate(()=>window.promptCalls),1);
 assert.equal(await page.locator('#install-banner').isVisible(),false);
 await available();await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
 assert.equal(await page.locator('#install-banner').isVisible(),false);
 await available();await page.click('#dismiss-install');await available();assert.equal(await page.locator('#install-banner').isVisible(),false);
 await page.reload();await available();assert.equal(await page.locator('#install-banner').isVisible(),false);
 const keys=await page.evaluate(async()=>{const c=await caches.open('nectarspend-shell-v2');return (await c.keys()).map(r=>r.url)});
 assert.ok(keys.length>=17);assert.ok(keys.every(u=>!u.includes('?')&&!u.includes('config.js')&&!u.includes('/auth/')&&!u.includes('/rest/')));
 await context.setOffline(true);await page.reload();assert.equal(await page.title(),'NectarSpend — Know your money.');
 assert.equal(await page.locator('#install-banner').count(),1);
 await context.setOffline(false);
 await page.evaluate(()=>localStorage.removeItem('nectarspend-install-dismissed'));
 await page.reload();await page.setViewportSize({width:1440,height:900});await available();
 await page.screenshot({path:'tests/artifacts/install-desktop.png'});
 console.log('PWA browser: 12 assertions passed; real worker registration, cache and offline shell verified. Install prompt events simulated.');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

