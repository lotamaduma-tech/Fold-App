const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function ui(standalone=false, saved=null) {
  const events = {}, buttons = {};
  const banner = { hidden: true };
  const storage = new Map(saved ? [['nectarspend-install-dismissed',saved]] : []);
  const media = { matches: standalone, addEventListener: (n,f) => events.media=f };
  vm.runInNewContext(fs.readFileSync('js/pwa.js','utf8'), {
    document: { getElementById: id => id === 'install-banner' ? banner : {addEventListener: (n,f) => buttons[id]=f} },
    window: {matchMedia: () => media, addEventListener: (n,f) => events[n]=f}, navigator: {},
    localStorage: {getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}, Date
  });
  let prompts=0;
  const available = (outcome='accepted') => events.beforeinstallprompt({preventDefault(){},prompt:async()=>{prompts++},userChoice:Promise.resolve({outcome})});
  return {banner,buttons,events,storage,available,get prompts(){return prompts}};
}
test('install UI stays hidden without availability and uses the real saved prompt',async()=>{
  const u=ui(); assert.equal(u.banner.hidden,true); u.available();assert.equal(u.banner.hidden,false);
  await u.buttons['install-app']();assert.equal(u.prompts,1);assert.equal(u.banner.hidden,true);
  await u.buttons['install-app']();assert.equal(u.prompts,1);
});
test('dismissal persists, suppresses repeated prompts, and expires',()=>{
  const u=ui();u.available();u.buttons['dismiss-install']();assert.equal(u.banner.hidden,true);
  assert.ok(u.storage.has('nectarspend-install-dismissed'));u.available();assert.equal(u.banner.hidden,true);
  const recent=ui(false,String(Date.now()));recent.available();assert.equal(recent.banner.hidden,true);
  const old=ui(false,String(Date.now()-8*86400000));old.available();assert.equal(old.banner.hidden,false);
});
test('installation and standalone mode hide UI',()=>{
  const u=ui();u.available();u.events.appinstalled();assert.equal(u.banner.hidden,true);
  const installed=ui(true);installed.available();assert.equal(installed.banner.hidden,true);
});
test('declining the native prompt stores dismissal',async()=>{
  const u=ui();u.available('dismissed');await u.buttons['install-app']();assert.ok(u.storage.size);
});
test('manifest icons and social image exist with correct dimensions',()=>{
  const m=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
  assert.equal(m.start_url,'/');assert.equal(m.scope,'/');assert.equal(m.display,'standalone');
  for(const icon of m.icons){const p=fs.readFileSync('.'+icon.src);assert.equal(`${p.readUInt32BE(16)}x${p.readUInt32BE(20)}`,icon.sizes);}
  assert.ok(fs.existsSync('assets/nectarspend-social.png'));
});
test('worker bypasses APIs, tokens, query strings, external requests and writes',()=>{
  const handlers={}; vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{self:{location:{origin:'https://nectarspend.com'},addEventListener:(n,f)=>handlers[n]=f},URL});
  for(const [path,method,auth] of [
    ['https://project.supabase.co/rest/v1/transactions','GET',false],
    ['/auth/v1/token','POST',false],['/rest/v1/records','GET',false],
    ['/?auth=callback&code=secret','GET',false],['/config.js','GET',false],
    ['/js/app.js?token=secret','GET',false],['/js/app.js','POST',false],['/','GET',true]
  ]) { let intercepted=false;handlers.fetch({request:{url:new URL(path,'https://nectarspend.com').href,method,headers:{has:()=>auth}},respondWith:()=>{intercepted=true}});assert.equal(intercepted,false,path); }
});
test('worker serves cached public shell offline without persisting runtime responses',async()=>{
  const handlers={}; let writes=0;
  const cache={match:async p=>'cached:'+p,put:()=>writes++};
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{self:{location:{origin:'https://nectarspend.com'},addEventListener:(n,f)=>handlers[n]=f},URL,caches:{open:async()=>cache},fetch:async()=>{throw Error('offline')},Response});
  let response;handlers.fetch({request:{url:'https://nectarspend.com/',method:'GET',headers:{has:()=>false}},respondWith:p=>response=p});
  assert.equal(await response,'cached:/');assert.equal(writes,0);
});
