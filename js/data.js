/* Supabase repository: all financial operations are scoped to owner AND workspace. */
(function(root){
 'use strict';
 const Records=typeof module!=='undefined'?require('./records.js'):root.NectarRecords;
 const columns={profiles:'user_id,name,onboarding_completed,usage_mode',workspaces:'id,user_id,name,kind,currency,starting_balance,monthly_spend_cap,setup_completed,created_at',goals:'id,user_id,workspace_id,name,target,created_at',transactions:'id,user_id,workspace_id,type,record_kind,is_savings,amount,category,note,date,goal_id,created_at'};
 const workspace=r=>({id:r.id,name:r.name,kind:r.kind,currency:r.currency,startingBalance:Number(r.starting_balance),monthlySpendCap:Number(r.monthly_spend_cap),setupComplete:r.setup_completed,createdAt:r.created_at});
 const goal=r=>({id:r.id,workspaceId:r.workspace_id,name:r.name,target:Number(r.target),createdAt:r.created_at});
 const record=r=>({id:r.id,workspaceId:r.workspace_id,type:r.type,kind:r.record_kind,isSavings:r.is_savings,amount:Number(r.amount),category:r.category,note:r.note||'',date:r.date,goalId:r.goal_id,createdAt:r.created_at});
 function createRepository(client,userId){
  if(!userId)throw new Error('Authentication is required.');
  const checked=async request=>{const {data,error}=await request;if(error)throw error;return data;};
  const own=(table,workspaceId)=>{let q=client.from(table).select(columns[table]).eq('user_id',userId);if(workspaceId)q=q.eq('workspace_id',workspaceId);return q;};
  async function all(table,workspaceId){const rows=[];for(let offset=0;;){const batch=await checked(own(table,workspaceId).order('created_at').order('id').range(offset,offset+499));rows.push(...batch);if(!batch.length)return rows;offset+=batch.length;}}
  function requireWorkspace(id){if(!id)throw new Error('Choose a workspace first.');return id;}
  async function insertOnce(table,row,map){const result=await client.from(table).insert({...row,user_id:userId}).select(columns[table]).single();if(!result.error)return map(result.data);if(result.error.code==='23505')return map(await checked(own(table,row.workspace_id).eq('id',row.id).single()));throw result.error;}
  function payload(t){return {record_kind:t.kind,is_savings:!!t.isSavings,amount:t.amount,category:t.category,note:t.note||null,date:t.date,goal_id:t.goalId||null};}
  return {
   async load(user,preferredId){
    if(user.id!==userId)throw new Error('Your account changed. Please reload.');
    let p=await checked(own('profiles').maybeSingle());
    if(!p){const name=String(user.user_metadata?.full_name||user.user_metadata?.name||'').slice(0,40).trim()||null;const result=await client.from('profiles').insert({user_id:userId,name}).select(columns.profiles).single();if(result.error&&result.error.code!=='23505')throw result.error;p=result.data||await checked(own('profiles').single());}
    const workspaces=(await all('workspaces')).map(workspace);
    const active=(!p.onboarding_completed&&workspaces.find(w=>!w.setupComplete))||workspaces.find(w=>w.id===preferredId)||workspaces[0]||null;
    const [goals,transactions]=active?await Promise.all([all('goals',active.id),all('transactions',active.id)]):[[],[]];
    return {profile:{name:p.name||'',email:user.email||'',currency:active?.currency||'NGN',startingBalance:active?.startingBalance||0,monthlySpendCap:active?.monthlySpendCap||0},workspaces,workspace:active,usageMode:p.usage_mode,goals:goals.map(goal),transactions:transactions.map(record),setupComplete:!!(p.onboarding_completed&&active?.setupComplete)};
   },
   async updateProfile(patch){if(Object.keys(patch).some(k=>k!=='name'))throw new Error('Unknown profile field.');const p=await checked(client.from('profiles').update(patch).eq('user_id',userId).select(columns.profiles).single());return {profile:{name:p.name||''}};},
   async updateWorkspace(id,patch){requireWorkspace(id);const fields={name:'name',currency:'currency',startingBalance:'starting_balance',monthlySpendCap:'monthly_spend_cap'},row={};for(const [key,value]of Object.entries(patch)){if(!fields[key])throw new Error('Unknown workspace field.');row[fields[key]]=value;}return workspace(await checked(client.from('workspaces').update(row).eq('user_id',userId).eq('id',id).select(columns.workspaces).single()));},
   createWorkspace(w){return insertOnce('workspaces',{id:w.id,name:w.name,kind:w.kind,currency:w.currency},workspace);},
   async initializeWorkspaces(mode){await checked(client.rpc('nectar_initialize_workspaces',{p_expected_user_id:userId,p_mode:mode}));},
   async completeWorkspace(id){await checked(client.rpc('nectar_complete_workspace',{p_expected_user_id:userId,p_workspace_id:requireWorkspace(id)}));},
   createTransaction(t,workspaceId,workspaceKind){Records.validateRecord(t,workspaceKind);return insertOnce('transactions',{id:t.id,workspace_id:requireWorkspace(workspaceId),...payload(t)},record);},
   async updateTransaction(t,workspaceId,workspaceKind){Records.validateRecord(t,workspaceKind);return record(await checked(client.from('transactions').update(payload(t)).eq('user_id',userId).eq('workspace_id',requireWorkspace(workspaceId)).eq('id',t.id).select(columns.transactions).single()));},
   createGoal(g,workspaceId){return insertOnce('goals',{id:g.id,workspace_id:requireWorkspace(workspaceId),name:g.name,target:g.target},goal);},
   async deleteTransaction(id,workspaceId){await checked(client.from('transactions').delete().eq('user_id',userId).eq('workspace_id',requireWorkspace(workspaceId)).eq('id',id));},
   async deleteGoal(id,workspaceId){await checked(client.from('goals').delete().eq('user_id',userId).eq('workspace_id',requireWorkspace(workspaceId)).eq('id',id));},
  };
 }
 const api={createRepository};if(typeof module!=='undefined')module.exports=api;else root.NectarData=api;
})(globalThis);
