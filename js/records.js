/* Shared personal/business record engine. Savings are an allocation, not a deposit. */
(function(root){
 'use strict';
 const Core=typeof module!=='undefined'?require('./core.js'):root.NectarCore;
 const categories={personal:{income:['Salary','Allowance','Gift','Work','Other'],expense:['Food','Transport','Bills','Shopping','Entertainment','School','Fun','Other']},business:{income:['Sales','Owner funding','Loan','Other'],expense:['Stock','Delivery','Rent','Utilities','Wages','Owner draw','Loan repayment','Other']}};
 const kindOf=t=>t.kind||(t.type==='spent'?'expense':'income');
 const isSavings=t=>kindOf(t)==='saving'||(kindOf(t)==='income'&&(t.isSavings??(!t.kind&&t.type==='saved')));
 const sum=rows=>rows.reduce((n,t)=>n+Math.round(t.amount*100),0)/100;
 function validateRecord(t,workspaceKind){
  if(!Number.isFinite(t.amount)||t.amount<=0||t.amount>999999999||Math.abs(t.amount*100-Math.round(t.amount*100))>0.00001)throw new Error('Enter an amount greater than zero, with up to two decimal places.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||t.date<'0001-01-01'||!Number.isFinite(Date.parse(t.date+'T00:00:00Z'))||new Date(t.date+'T00:00:00Z').toISOString().slice(0,10)!==t.date)throw new Error('Choose a valid date.');
  if(!['income','expense','saving'].includes(t.kind))throw new Error('Choose money in, money out, or a savings allocation.');
  if(!categories[workspaceKind])throw new Error('Choose a valid workspace.');
  if(t.kind==='saving'){if(workspaceKind!=='personal'||t.category!=='Savings'||!t.isSavings)throw new Error('Savings allocations belong in a personal workspace.');}
  else if(!categories[workspaceKind][t.kind].includes(t.category))throw new Error('Choose a category for this record.');
  if((workspaceKind==='business'||t.kind==='expense')&&(t.isSavings||t.goalId))throw new Error('This record cannot be allocated to a savings goal.');
  if(t.goalId&&!isSavings(t))throw new Error('Mark this record as savings before choosing a goal.');
  if(String(t.note||'').length>120)throw new Error('Keep the note within 120 characters.');
  return t;
 }
 function totals(state,month=Core.localDate().slice(0,7)){
  const records=state.transactions||[],income=sum(records.filter(t=>kindOf(t)==='income')),spent=sum(records.filter(t=>kindOf(t)==='expense')),saved=sum(records.filter(isSavings)),rows=records.filter(t=>t.date.startsWith(month));
  return {income,spent,saved,balance:(Math.round(state.profile.startingBalance*100)+Math.round(income*100)-Math.round(spent*100))/100,monthIncome:sum(rows.filter(t=>kindOf(t)==='income')),monthSpent:sum(rows.filter(t=>kindOf(t)==='expense')),monthSaved:sum(rows.filter(isSavings))};
 }
 const progress=(state,id)=>sum(state.transactions.filter(t=>t.goalId===id&&isSavings(t)));
 function periodRange(period='month',date=Core.localDate()){
  const d=new Date(date+'T12:00:00');
  if(period==='week'){const weekday=(d.getDay()+6)%7;d.setDate(d.getDate()-weekday);const from=Core.localDate(d);d.setDate(d.getDate()+6);return {from,to:Core.localDate(d)};}
  return {from:date.slice(0,7)+'-01',to:Core.localDate(new Date(d.getFullYear(),d.getMonth()+1,0,12))};
 }
 function summary(state,period='month',date=Core.localDate()){
  const {from,to}=periodRange(period,date),rows=state.transactions.filter(t=>t.date>=from&&t.date<=to),incoming=rows.filter(t=>kindOf(t)==='income'),outgoing=rows.filter(t=>kindOf(t)==='expense'),groups={};
  outgoing.forEach(t=>groups[t.category]=(groups[t.category]||0)+Math.round(t.amount*100));
  const income=sum(incoming),expenses=sum(outgoing),revenue=sum(incoming.filter(t=>t.category==='Sales')),operatingCosts=sum(outgoing.filter(t=>['Delivery','Rent','Utilities','Wages','Other'].includes(t.category)));
  return {from,to,count:rows.length,income,expenses,difference:Math.round((income-expenses)*100)/100,saved:sum(rows.filter(isSavings)),revenue,operatingCosts,operatingResult:Math.round((revenue-operatingCosts)*100)/100,stock:sum(outgoing.filter(t=>t.category==='Stock')),categories:Object.entries(groups).map(([name,cents])=>({name,amount:cents/100})).sort((a,b)=>b.amount-a.amount)};
 }
 const api={categories,kindOf,isSavings,validateRecord,totals,progress,periodRange,summary};
 if(typeof module!=='undefined')module.exports=api;else root.NectarRecords=api;
})(globalThis);
