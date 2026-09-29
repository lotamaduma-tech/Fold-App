const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');let db;
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
before(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values ('${A}'),('${B}');`);const migration=fs.readFileSync('supabase/migrations/003_delete_rate_limit.sql','utf8');await db.exec(migration);await db.exec(migration)});
after(async()=>db?.close());
test('deletion rate-limit storage and RPC cannot be accessed by browser roles',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(db.query('select public.nectar_consume_delete_attempt($1)',[A]),/permission denied/);await assert.rejects(db.query('select * from nectar_private.account_delete_limits'),/permission denied/);}
 await db.exec('reset role');const r=await db.query("select relrowsecurity,relforcerowsecurity from pg_class where relname='account_delete_limits'");assert.deepEqual(r.rows,[{relrowsecurity:true,relforcerowsecurity:true}]);
});
test('shared database caps repeated attempts and isolates users',async()=>{
 await db.exec('reset role;set role service_role');for(const allowed of [true,true,true,false,false])assert.equal((await db.query('select public.nectar_consume_delete_attempt($1) allowed',[A])).rows[0].allowed,allowed);
 assert.equal((await db.query('select public.nectar_consume_delete_attempt($1) allowed',[B])).rows[0].allowed,true);
});
test('expiry resets allowance and account deletion removes throttle metadata',async()=>{
 await db.exec('reset role');await db.query("update nectar_private.account_delete_limits set expires_at=now()-interval '1 second' where user_id=$1",[A]);await db.exec('set role service_role');assert.equal((await db.query('select public.nectar_consume_delete_attempt($1) allowed',[A])).rows[0].allowed,true);
 await db.exec('reset role');await db.query('delete from auth.users where id=$1',[A]);assert.equal((await db.query('select * from nectar_private.account_delete_limits where user_id=$1',[A])).rows.length,0);
});
