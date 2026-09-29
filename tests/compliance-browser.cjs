const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');const {fixture}=require('./supabase-fixture.cjs');
const base=process.env.NECTARSPEND_TEST_URL||'http://127.0.0.1:4173';
(async()=>{
 const backend=await fixture();const browser=await chromium.launch({executablePath:process.env.NECTARSPEND_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 let checks=0;const check=(value,expected)=>{assert.deepEqual(value,expected);checks++};
 try{
 const plain=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});const legal=await plain.newPage();
 for(const file of ['terms.html','privacy.html','disclaimer.html']){
 const response=await legal.goto(base+'/'+file);check(response.status(),200);check(await legal.locator('h1').isVisible(),true);check(await legal.locator('h2').count()>3,true);
 await legal.keyboard.press('Tab');check(await legal.locator('.skip-link').evaluate(e=>e===document.activeElement),true);
 await legal.screenshot({path:'tests/artifacts/legal-'+file+'.png',fullPage:true});
 }
 await plain.close();
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await backend.install(context);
 const page=await context.newPage();await page.goto(base);await page.click('[data-page=signup]');
 check(await page.locator('.auth-legal').innerText().then(t=>t.includes('18 or older')&&t.includes('acknowledge')),true);
 for(const file of ['terms.html','privacy.html','disclaimer.html'])check(await page.locator('.auth-legal a[href="/'+file+'"]').count(),1);
 await page.click('[data-page=login]');await page.fill('[name=email]','alice@example.test');await page.fill('[name=password]','fixture-password-123');await page.click('#auth-form [type=submit]');await page.locator('.balance-card').waitFor();await page.click('nav [data-page=you]');
 check(await page.locator('.profile-footer a').count(),3);await page.click('[data-action=delete-account]');await page.click('[data-action=close-sheet]');check(await page.locator('dialog').evaluate(e=>e.open),false);
 let fail=true, calls=0;
 const {deletionHandler}=await import('../supabase/functions/delete-account/handler.mjs');
 const handler=deletionHandler({allowDevelopment:true,consumeAttempt:async()=>true,verifyUser:async token=>{const id=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub;const a=[...backend.accounts.values()].find(a=>a.id===id);return {data:{user:a?.user}}},deleteUser:async id=>{if(fail)return {error:{}};await backend.db.exec('reset role');await backend.db.query('delete from auth.users where id=$1',[id]);return {error:null}}});
 await context.route('**/functions/v1/delete-account',async route=>{calls++;const req=route.request();const res=await handler(new Request(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()}));await route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:await res.text()})});
 await page.click('[data-action=delete-account]');await page.fill('[name=confirmation]','DELETE');await page.click('#delete-account-form [type=submit]');await page.waitForFunction(()=>document.querySelector('#delete-account-form .error')?.textContent.includes('not confirmed'));
 check(await page.locator('dialog').evaluate(e=>e.open),true);
 fail=false;await page.click('#delete-account-form [type=submit]');await page.locator('.welcome').waitFor();check(calls,2);
 await backend.db.exec('reset role');
 check((await backend.db.query("select count(*)::int n from auth.users where id='00000000-0000-4000-8000-000000000001'")).rows[0].n,0);
 check((await backend.db.query("select count(*)::int n from auth.users where id='00000000-0000-4000-8000-000000000002'")).rows[0].n,1);
 check(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('School books')||v.includes('Lunch'))),false);
 console.log(`Compliance browser: ${checks} assertions passed; legal pages work without JavaScript; deletion uses fixture Auth and real PostgreSQL, not deployed Supabase.`);
 }finally{await browser.close();await backend.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
