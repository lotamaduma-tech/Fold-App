// Reports locations and credential categories only, never secret values.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const findings = [];
function scan(label, bytes) {
  if (bytes.subarray(0, 8192).includes(0)) return;
  const text = bytes.toString('utf8');
  const kinds = [];
  if (/sb_secret_[A-Za-z0-9_-]{24,}/.test(text)) kinds.push('private Supabase key');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) kinds.push('private key');
  if (/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/.test(text)) kinds.push('database URL with password');
  if (/(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(text)) kinds.push('private API credential pattern');
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(m[1], 'base64url')).role === 'service_role') kinds.push('service-role JWT'); } catch {}
  }
  if (kinds.length) findings.push({location:label, categories:[...new Set(kinds)]});
}
function walk(dir) {
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['.git','node_modules','.agents','.codex'].includes(e.name)) continue;
    const p=path.join(dir,e.name);
    if (e.isDirectory()) { if (path.relative(root,p)!==path.join('tests','artifacts')) walk(p); }
    else if (e.isFile() && !/\.(png|jpe?g|ico|woff2?|pdf)$/i.test(e.name)) scan(path.relative(root,p),fs.readFileSync(p));
  }
}
walk(root);
const lines=cp.execFileSync('git',['rev-list','--objects','--all'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
const objects=lines.map(l=>l.split(/ (.*)/s)).filter(([hash,name])=>name && !/\.(png|jpe?g|ico|woff2?|pdf)$/i.test(name));
const output=cp.execFileSync('git',['cat-file','--batch'],{cwd:root,input:objects.map(([hash])=>hash).join('\n')+'\n',maxBuffer:100*1024*1024});
let offset=0, historyBlobs=0;
for(const [hash,name] of objects){const end=output.indexOf(10,offset);const header=output.toString('utf8',offset,end).split(' ');const size=Number(header[2]);offset=end+1;if(header[1]==='blob'){scan('git-history:'+name+'@'+hash.slice(0,12),output.subarray(offset,offset+size));historyBlobs++;}offset+=size+1;}
console.log(JSON.stringify({historyBlobs,findings},null,2));
// An ignored local .env is server configuration, not evidence of publication.
if(findings.some(f=>f.location!=='.env')) process.exitCode=1;
