const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=()=>import('../supabase/functions/delete-account/handler.mjs');
const req=(body='{"confirmation":"DELETE"}',extra={})=>new Request('https://example.supabase.co/functions/v1/delete-account',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer valid',origin:'https://nectarspend.com',...extra},body});
const valid={verifyUser:async()=>({data:{user:{id:'alice'}}}),consumeAttempt:async()=>true,deleteUser:async()=>({error:null})};
test('deletion rejects oversized streamed and declared bodies before Auth is called',async()=>{
 const {deletionHandler}=await load();let auth=0;const handler=deletionHandler({...valid,verifyUser:async()=>{auth++;return {}}});
 for(const request of [req(' '.repeat(1025)),req('{}',{'content-length':'1025'})])assert.equal((await handler(request)).status,413);
 assert.equal(auth,0);
});
test('production CORS excludes localhost; development must explicitly opt in',async()=>{
 const {deletionHandler}=await load();assert.equal((await deletionHandler(valid)(req(undefined,{origin:'http://localhost:5500'}))).status,403);
 assert.equal((await deletionHandler({...valid,allowDevelopment:true})(req(undefined,{origin:'http://localhost:5500'}))).status,200);
 assert.equal((await deletionHandler(valid)(req(undefined,{origin:'null'}))).status,403);
});
test('deletion fails closed on rate limit, missing limiter and limiter outage',async()=>{
 const {deletionHandler}=await load();let writes=0;const deps={...valid,deleteUser:async()=>{writes++;return {}}};
 const limited=await deletionHandler({...deps,consumeAttempt:async()=>false})(req());assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
 for(const consumeAttempt of [undefined,async()=>{throw Error('private connection details')}]){
 const response=await deletionHandler({...deps,consumeAttempt})(req());assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private connection'));
 } assert.equal(writes,0);
});
test('deletion rejects anonymous identities and misleading MIME types',async()=>{
 const {deletionHandler}=await load();assert.equal((await deletionHandler({...valid,verifyUser:async()=>({data:{user:{id:'alice',is_anonymous:true}}})})(req())).status,401);
 assert.equal((await deletionHandler(valid)(req(undefined,{'content-type':'application/json-evil'}))).status,415);
});
test('deletion does not use Origin as authentication',async()=>{
 const {deletionHandler}=await load();const request=req();request.headers.delete('origin');assert.equal((await deletionHandler(valid)(request)).status,200);
 request.headers.delete('authorization');assert.equal((await deletionHandler(valid)(request)).status,401);
});
test('production headers restrict script execution, embedding, device permissions and insecure requests',()=>{
 const headers=Object.fromEntries(JSON.parse(fs.readFileSync('vercel.json')).headers[0].headers.map(x=>[x.key,x.value]));const csp=headers['Content-Security-Policy'];
 for(const rule of ["script-src 'self'","script-src-attr 'none'","object-src 'none'","base-uri 'none'","frame-ancestors 'none'","form-action 'self'","upgrade-insecure-requests"])assert.ok(csp.includes(rule),rule);
 assert.ok(!csp.includes('unsafe-eval'));assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));assert.match(headers['Strict-Transport-Security'],/max-age=31536000/);assert.match(headers['Permissions-Policy'],/camera=\(\)/);
});
test('HTTPS app cannot select an HTTP database even on loopback',()=>{
 const {connect}=require('../js/backend.js');assert.throws(()=>connect({SUPABASE_URL:'http://localhost:54321',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'},null,{origin:'https://nectarspend.com',protocol:'https:'}),/HTTPS Supabase/);
});
