const fs=require('node:fs');const {test}=require('node:test');const assert=require('node:assert/strict');
test('production output contains no privileged credentials or server deletion code',()=>{
 const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
 for(const file of walk('dist').filter(f=>/\.(js|html|css|json|webmanifest)$/.test(f))){const text=fs.readFileSync(file,'utf8');assert.ok(!/sb_secret_[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/.test(text),file);
 for(const m of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)){let data;try{data=JSON.parse(Buffer.from(m[1],'base64url'))}catch{continue}assert.notEqual(data.role,'service_role',file);}}
 assert.equal(fs.existsSync('dist/supabase'),false);
 for(const file of ['terms.html','privacy.html','disclaimer.html','css/legal.css'])assert.ok(fs.existsSync('dist/'+file));
});
