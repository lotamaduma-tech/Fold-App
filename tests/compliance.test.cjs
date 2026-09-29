const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const handler=()=>import('../supabase/functions/delete-account/handler.mjs');
const request=(body={confirmation:'DELETE'}, token='valid', origin='https://nectarspend.com',method='POST')=>new Request('https://fixture.supabase.co/functions/v1/delete-account',{method,headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('deletion verifies the token and deletes only the verified identity',async()=>{
 const {deletionHandler}=await handler();const deleted=[];
 const run=deletionHandler({consumeAttempt:async()=>true,verifyUser:async token=>({data:{user:{id:token==='alice'?'alice':'bob'}}}),deleteUser:async id=>{deleted.push(id);return {error:null}}});
 assert.equal((await run(request({confirmation:'DELETE'},'alice'))).status,200);assert.deepEqual(deleted,['alice']);
 assert.equal((await run(request({confirmation:'DELETE',user_id:'bob'},'alice'))).status,400);assert.deepEqual(deleted,['alice']);
});
test('deletion rejects missing/expired auth, unsafe origins, methods and bad confirmation',async()=>{
 const {deletionHandler}=await handler();let writes=0;
 const run=deletionHandler({consumeAttempt:async()=>true,verifyUser:async()=>({error:{message:'expired'}}),deleteUser:async()=>{writes++;return {}}});
 for(const [req,status] of [[request({},''),401],[request(),401],[request({confirmation:'no'}),400],[request(undefined,'valid','https://evil.example'),403],[request(undefined,'valid',undefined,'GET'),405]]) assert.equal((await run(req)).status,status);
 assert.equal(writes,0);
});
test('deletion fails closed without leaking provider errors and permits CORS preflight',async()=>{
 const {deletionHandler}=await handler();
 const run=deletionHandler({consumeAttempt:async()=>true,verifyUser:async()=>({data:{user:{id:'alice'}}}),deleteUser:async()=>({error:{message:'private database details'}})});
 const response=await run(request());assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!(await response.text()).includes('private'));
 assert.equal((await run(request(undefined,'valid',undefined,'OPTIONS'))).status,204);
});
test('legal pages are static, linked, dated, and use the owner-approved 18+ policy',()=>{
 for(const file of ['terms.html','privacy.html','disclaimer.html']){
 const s=fs.readFileSync(file,'utf8');assert.match(s,/<h1>/);assert.match(s,/Last updated: 28 September 2026/);assert.match(s,/Effective date:/);assert.ok(!s.includes('<script'));
 for(const link of s.matchAll(/href="(\/[^"#]*)"/g)) assert.ok(link[1]==='/'||fs.existsSync('.'+link[1]),link[1]);
 }
 for(const file of ['terms.html','privacy.html'])assert.match(fs.readFileSync(file,'utf8'),/18 or older/);
 const app=fs.readFileSync('js/app.js','utf8');assert.match(app,/acknowledge the <a href="\/privacy.html">/);assert.match(app,/delete-account-form/);
 for(const file of ['terms.html','privacy.html','disclaimer.html'])assert.ok(fs.readFileSync('index.html','utf8').includes('/'+file));
});
test('browser app storage writes remain preferences only; SDK sessions are separate',()=>{
 const app=fs.readFileSync('js/app.js','utf8'),pwa=fs.readFileSync('js/pwa.js','utf8');
 assert.equal((app.match(/localStorage\.setItem/g)||[]).length,1);assert.match(app,/localStorage\.setItem\(\s*"nectarspend-workspace:" \+ user\.id,\s*state\.workspace\.id/);
 assert.equal((pwa.match(/localStorage\.setItem/g)||[]).length,1);assert.match(pwa,/localStorage.setItem\(key, String\(Date.now\(\)\)\)/);
 assert.ok(!/localStorage|sessionStorage/.test(fs.readFileSync('js/data.js','utf8')));
});
test('browser account deletion fails visibly unless the server confirms deletion',async()=>{
 const {createAuth}=require('../js/backend.js');let body;
 const auth=createAuth({functions:{invoke:async(name,options)=>{assert.equal(name,'delete-account');body=options.body;return {data:{deleted:true}}}}},{origin:'https://nectarspend.com'});
 await auth.deleteAccount();assert.deepEqual(body,{confirmation:'DELETE'});
 const failed=createAuth({functions:{invoke:async()=>({error:{}})}},{origin:'https://nectarspend.com'});await assert.rejects(failed.deleteAccount(),/not confirmed/);
});
