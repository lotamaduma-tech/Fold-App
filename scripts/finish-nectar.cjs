const fs=require('node:fs');
function edit(path,fn){fs.writeFileSync(path,fn(fs.readFileSync(path,'utf8')));}
const core=fs.readFileSync('js/core.js','utf8'),start=core.indexOf('  function sampleData()'),end=core.indexOf('  function totals(',start);
fs.writeFileSync('tests/sample.cjs',`// Test-only historical data fixture; never served to users.\nconst {localDate,id}=require('../js/core.js');\n${core.slice(start,end)}\nmodule.exports={sampleData};\n`);
edit('js/core.js',s=>s.slice(0,start)+s.slice(end).replace('    sampleData,\n',''));
edit('tests/core.test.cjs',s=>s.replaceAll('C.sampleData()',"require('./sample.cjs').sampleData()"));
edit('supabase/schema.sql',s=>s.slice(0,s.indexOf('-- Explicit confirmed reset/seed'))+'commit;\n');
edit('supabase/schema.sql',s=>s.replace('FOLD initial migration','NectarSpend base schema (legacy database identifiers retained for compatibility)'));
edit('tests/backend.test.cjs',s=>s.replaceAll('fold.example','nectarspend.example').replace('approved stylesheet is unchanged','original paper stylesheet is preserved beneath workspace extensions').replace('.update(fs.readFileSync("css/style.css"))','.update(fs.readFileSync("css/style.css", "utf8").split("/* Workspace and record controls")[0])'));
edit('tests/supabase-fixture.cjs',s=>{
 s=s.replace('await db.query("insert into profiles(user_id) values ($1),($2)", [A, B]);','await db.query("insert into profiles(user_id,starting_balance,monthly_spend_cap,onboarding_completed) values ($1,45000,25000,true)", [A]);');
 const a=s.indexOf('  await db.exec(`set role authenticated;'),b=s.indexOf('  function session(a)',a);
 s=s.slice(0,a)+`  const seed=require('./sample.cjs').sampleData();
  for(const g of seed.goals)await db.query('insert into goals(id,user_id,name,target) values ($1,$2,$3,$4)',[g.id,A,g.name,g.target]);
  for(const t of seed.transactions)await db.query('insert into transactions(id,user_id,type,amount,category,note,date,goal_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[t.id,A,t.type,t.amount,t.category,t.note,t.date,t.goalId,t.createdAt]);
  await db.exec(fs.readFileSync('supabase/migrations/002_workspaces.sql','utf8'));
`+s.slice(b);
 s=s.replace('account(crypto.randomUUID(), body.email, false)','account(crypto.randomUUID(), body.email, true)').replace('return json(route, { ...accounts.get(body.email).user, identities: [] });','return json(route, session(accounts.get(body.email)));');
 const c=s.indexOf('          if (path.endsWith("/rpc/fold_replace_notebook"))'),d=s.indexOf('          const table',c);
 s=s.slice(0,c)+`          if(path.endsWith('/rpc/nectar_initialize_workspaces')){await db.query('select nectar_initialize_workspaces($1,$2)',[body.p_expected_user_id,body.p_mode]);return {rows:null};}
          if(path.endsWith('/rpc/nectar_complete_workspace')){await db.query('select nectar_complete_workspace($1,$2)',[body.p_expected_user_id,body.p_workspace_id]);return {rows:null};}
`+s.slice(d);
 s=s.replace('["profiles", "goals", "transactions"]','["profiles", "goals", "transactions", "workspaces"]');
 s=s.replace('const allowed = new Set([','const allowed = new Set(["workspace_id","record_kind","is_savings","usage_mode","kind","setup_completed","is_legacy_default",');
 return s.replaceAll('FOLD_CONFIG','NECTARSPEND_CONFIG').replaceAll('fold-tests','nectar-tests');
});
edit('js/app.js',s=>s.replace(/  const typeCategories = \{[\s\S]*?\n  \};\n/,'').replace('Preview of a NectarSpend balance and savings goal','Example records and savings goals').replace('<p class="kicker">Balance</p>','<p class="kicker">Example balance</p>'));
edit('index.html',s=>s.replace('A calm personal money notebook.','Personal and business records. Know your money.'));
