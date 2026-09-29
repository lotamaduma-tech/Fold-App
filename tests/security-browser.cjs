const {chromium}=require('playwright'),assert=require('node:assert/strict'),{fixture}=require('./supabase-fixture.cjs');
const base=process.env.NECTARSPEND_TEST_URL||'http://127.0.0.1:5500';
(async()=>{
 const backend=await fixture();const browser=await chromium.launch({executablePath:process.env.NECTARSPEND_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 let checks=0;const check=(x,y)=>{assert.deepEqual(x,y);checks++};
 try {
 const payload='<img src=x onerror=window.__xss=1>';
 await backend.db.exec('reset role');
 for(const [table,column] of [['profiles','name'],['goals','name'],['workspaces','name'],['transactions','note']])await backend.db.query(`update ${table} set ${column}=$1 where user_id=$2`,[payload,'00000000-0000-4000-8000-000000000001']);
 const context=await browser.newContext({serviceWorkers:'block'});await backend.install(context);
 await context.addInitScript(()=>{window.__violations=[];document.addEventListener('securitypolicyviolation',e=>window.__violations.push(e.effectiveDirective));});
 const page=await context.newPage();const response=await page.goto(base);
 check(response.headers()['content-security-policy'].includes("script-src 'self'"),true);
 await page.getByRole('button',{name:'Log in',exact:true}).click();await page.fill('[name=email]','alice@example.test');await page.fill('[name=password]','fixture-password-123');await page.click('#auth-form [type=submit]');await page.locator('.balance-card').waitFor();
 check(await page.locator('body').innerText().then(t=>t.includes(payload)),true);
 await page.click('nav [data-page=goals]');check(await page.locator('body').innerText().then(t=>t.includes(payload)),true);
 await page.click('nav [data-page=history]');await page.fill('#history-search',payload);check(await page.locator('img[src=x]').count(),0);check(await page.evaluate(()=>window.__xss===undefined),true);
 check(await page.locator('#history-search').getAttribute('maxlength'),'120');
 await page.evaluate(()=>{const e=document.querySelector('#history-search');e.value='a'.repeat(10000);e.dispatchEvent(new Event('input',{bubbles:true}))});check(await page.inputValue('#history-search').then(x=>x.length),120);
 check(await page.evaluate(()=>window.__violations.length),0);
 await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.__inlineRan=1';document.body.append(s);const b=document.createElement('button');b.setAttribute('onclick','window.__eventRan=1');document.body.append(b);b.click();});
 check(await page.evaluate(()=>window.__inlineRan===undefined && window.__eventRan===undefined),true);
 await context.route(base+'/js/csp-probe.js',route=>route.fulfill({contentType:'text/javascript',body:'try { eval("window.__evalRan=1") } catch { window.__evalBlocked=true }'}));
 await page.addScriptTag({url:base+'/js/csp-probe.js'});check(await page.evaluate(()=>window.__evalBlocked===true&&window.__evalRan===undefined),true);
 const external=await page.evaluate(async()=>{try{await fetch('https://unapproved.example/steal');return false}catch{return true}});check(external,true);
 const violations=await page.evaluate(()=>window.__violations);check(violations.includes('script-src-elem'),true);check(violations.includes('script-src-attr'),true);check(violations.includes('connect-src'),true);
 await page.click('nav [data-page=you]');await page.click('[data-action=logout]');await page.locator('.welcome').waitFor();check(await page.locator('body').innerText().then(t=>t.includes(payload)),false);
 console.log(`Security browser: ${checks} assertions passed, including stored XSS escaping, enforced CSP, bounded search and logout clearing.`);
 }finally{await browser.close();await backend.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
