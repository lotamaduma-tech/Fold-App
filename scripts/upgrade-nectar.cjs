const fs=require('node:fs');
let app=fs.readFileSync('js/app.js','utf8');
app=app.replace('const C = FoldCore;','const C = {...NectarCore, ...NectarRecords};');
app=app.replace('  const typeCategories = {',`  Object.assign(categories, {Salary:'briefcase',Shopping:'shopping-bag',Entertainment:'gamepad-2',Savings:'target',Sales:'store',Stock:'package',Delivery:'truck',Rent:'building',Utilities:'receipt',Wages:'users','Owner funding':'banknote',Loan:'notebook','Owner draw':'user','Loan repayment':'receipt'});
  let activityCategory='',dateFrom='',dateTo='',summaryPeriod='month',summaryDate=C.localDate();
  const typeCategories = {`);
app=app.replace('    transactions: [],','    workspaces: [],\n    workspace: null,\n    transactions: [],');
app=app.replace('const notebook = await repository.load(user);','const notebook = await repository.load(user, preferredWorkspace(user.id));');
app=app.replace('        state = notebook;','        state = notebook;\n        setupStep=state.workspaces.length?1:0;');
app=app.replace('window.FOLD_CONFIG,','window.NECTARSPEND_CONFIG || window.FOLD_CONFIG,');
app=app.replaceAll('"goals", "you", "balance"','"goals", "you", "balance", "records"');
app=app.replace('    page = next;','    if (next === "goals" && business()) next="records";\n    page = next;');
app=app.replace('      balance: renderBalance,','      balance: renderBalance,\n      records: renderRecords,');
app=app.replace('    setupStep = 0;','    setupStep = 0;\n    activityCategory="";dateFrom="";dateTo="";');
app=app.replace('    return error?.message || "Couldn’t save. Try again.";',`    if (error?.code || error?.status) return "Couldn’t complete this request. Check your connection and try again.";
    return error?.message || "Couldn’t save. Try again.";`);
function replaceDefinition(name,body){const expression=new RegExp('^  (?:async )?function '+name+'\\(', 'm'),match=expression.exec(app);if(!match){const i=app.indexOf('  async function handleAction');app=app.slice(0,i)+body+'\n'+app.slice(i);return;}const start=match.index,tail=app.slice(start+1),next=/\n  (?:function |async function |const |let |document\.|window\.)/.exec(tail);if(!next)throw Error('No boundary '+name);const end=start+1+next.index+1;app=app.slice(0,start)+body+'\n'+app.slice(end);}
for(const file of ['scripts/nectar-views.part','scripts/nectar-forms.part']){const source=fs.readFileSync(file,'utf8'),parts=[...source.matchAll(/^  (?:function (\w+)|async function (\w+)|const (\w+))/gm)];parts.forEach((m,i)=>{const body=source.slice(m.index,parts[i+1]?.index??source.length);if(m[3]){const at=app.indexOf('  async function handleAction');app=app.slice(0,at)+body+'\n'+app.slice(at);}else replaceDefinition(m[1]||m[2],body);});}
// Keep the existing tested password/OAuth/logout handlers verbatim.
const actionStart=app.indexOf('  async function handleAction'),authStart=app.indexOf('    else if (action === "toggle-password")',actionStart),authEnd=app.indexOf('    else if (action === "restore")',authStart),actionEnd=app.indexOf('  document.addEventListener("click"',authEnd);
if([actionStart,authStart,authEnd,actionEnd].some(i=>i<0))throw Error('Action boundary mismatch');
app=app.slice(0,actionStart)+fs.readFileSync('scripts/nectar-actions.part','utf8')+app.slice(authStart,authEnd)+'  }\n'+app.slice(actionEnd);
const submitStart=app.indexOf('        if (form.id === "money-form")'),submitAuth=app.indexOf('        } else if (form.id === "auth-form")',submitStart);
app=app.slice(0,submitStart)+fs.readFileSync('scripts/nectar-submit.part','utf8')+app.slice(submitAuth);
const setupStart=app.indexOf('        } else if (form.id === "setup-form")'),setupEnd=app.indexOf('        } else if (form.id === "recovery-form")',setupStart);
app=app.slice(0,setupStart)+fs.readFileSync('scripts/nectar-setup-submit.part','utf8')+app.slice(setupEnd);
app=app.replace('  document.addEventListener("submit",',`  document.addEventListener('change',event=>{
    if(event.target.id==='record-savings'||event.target.id==='savings-source'){captureDraft();draft.isSavings=!!$('#record-savings')?.checked;draft.kind=draft.isSavings?($('#savings-source')?.value||'income'):'income';if(!draft.isSavings)draft.goalId='';openMoney(draft.type,false);}
    if(['activity-category','date-from','date-to'].includes(event.target.id)){activityCategory=$('#activity-category').value;dateFrom=$('#date-from').value;dateTo=$('#date-to').value;$('#history-results').innerHTML=historyResults();refreshIcons();}
    if(event.target.id==='summary-date'&&event.target.value){summaryDate=event.target.value;render();}
  });
  document.addEventListener("submit",`);
app=app.replaceAll('Your money, simply kept.','Know your money.').replaceAll('FoldCore','NectarCore').replaceAll('FoldData','NectarData').replaceAll('FoldBackend','NectarBackend').replace(/\bFOLD\b/g,'NectarSpend').replace(/\bFold\b/g,'NectarSpend');
app=app.replace('A quiet way to track what you spend and save. Set goals, build better habits, and keep your money with you wherever you go.','Record what came in. Record what went out. Understand your personal or business money, one record at a time.');
app=app.replace('Keep your money with you,<br>wherever you use NectarSpend.','Keep your records with you,<br>wherever you use NectarSpend.');
app=app.replace('Your money notebook is right<br>where you left it.','Your records are right<br>where you left them.');
app=app.replace('Create your NectarSpend','Create your account');
app=app.replaceAll('Put money toward a goal','Record savings').replaceAll('"add" : "new-goal"','"record-savings" : "new-goal"').replaceAll('When you log a save','When you record savings').replaceAll('One save closer.','One record closer.');
fs.writeFileSync('js/app.js',app);
for(const file of ['js/core.js','js/backend.js','index.html','config.example.js','serve.cjs']){let s=fs.readFileSync(file,'utf8');s=s.replaceAll('FoldCore','NectarCore').replaceAll('FoldBackend','NectarBackend').replaceAll('FOLD_CONFIG','NECTARSPEND_CONFIG').replaceAll('Your money, simply kept.','Know your money.').replace(/\bFOLD\b/g,'NectarSpend').replace(/\bFold\b/g,'NectarSpend');fs.writeFileSync(file,s);}
let html=fs.readFileSync('index.html','utf8');html=html.replace('    <script defer src="js/data.js"></script>\n    <script defer src="js/core.js"></script>','    <script defer src="js/core.js"></script>\n    <script defer src="js/records.js"></script>\n    <script defer src="js/data.js"></script>');fs.writeFileSync('index.html',html);
for(const filename of ['package.json','package-lock.json']){const p=JSON.parse(fs.readFileSync(filename));p.name='nectarspend';if(p.description)p.description='NectarSpend — Know your money.';if(p.packages?.[''])p.packages[''].name='nectarspend';fs.writeFileSync(filename,JSON.stringify(p,null,2)+'\n');}
