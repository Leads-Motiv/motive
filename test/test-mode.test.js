const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const windowRoot = path.join(__dirname, '..');


const {createHandler}=require(path.join(windowRoot,'api/lead'));
const {request,responseRecorder,validLead}=require(path.join(windowRoot,'test/helpers'));
const {scheduleTestLead}=require(path.join(windowRoot,'api/_lib/test-lead'));
const env={VERCEL_ENV:'production',SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',TRUSTEDFORM_API_KEY:'fixture-only',SI_POST_URL:'https://exchange.standardinformation.io/post',SI_API_KEY:'fixture-only',SI_PARTNER_API_KEY:'fixture-only',GHL_WEBHOOK_URL:'https://ghl.example.test/hook'};
const quiet={log(){},warn(){},error(){}};
const tf=()=>Response.json({outcome:'success',retain:{results:{}},match_lead:{result:{success:true,email_match:true,phone_match:true}}});
const variants=[['flag','?test=1',{},true],['normal','',{},false],['body spoof','',{test:1,testMode:true,requestMeta:{testMode:true},landing_page_url:'https://site.test/?test=1'},false],['disabled','?test=0',{test:1},false],['denied','?test=1',{},true]];

for(const [name,query,spoof,enabled] of variants) test(`Window handler: ${name}`,async()=>{
 const calls=[],pending=[];const res=responseRecorder();
 const handler=createHandler({env,logger:quiet,zipAllowlist:new Set(['12207']),waitUntilImpl:p=>pending.push(p),fetchImpl:async(url,options)=>{
  calls.push({url:String(url),body:JSON.parse(options.body),options});
  if(String(url).includes('cert.trustedform'))return tf();
  if(String(url).includes('standardinformation'))return Response.json({status:name==='denied'?'denied':'success',price:70,confirmation_id:'test-fixture',errors:'fixture denial'});
  return Response.json({success:true});
 }});
 await handler(request(validLead({...spoof}),{url:'/api/lead'+query}),res);await Promise.all(pending);
 assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.body).success,true);
 const posts=calls.filter(c=>c.url.includes('standardinformation'));
 assert.equal(posts.length,1);assert.equal(posts[0].url,`https://exchange.standardinformation.io/${enabled?'post_test':'post'}`);
 assert.equal(calls.filter(c=>c.url.includes('cert.trustedform')).length,1);
 assert.equal(calls.filter(c=>c.url.includes('ghl.example')).length,1);
 const audit=calls.filter(c=>c.url.endsWith('/rpc/mark_test_lead'));
 assert.equal(audit.length,enabled?1:0);
 if(enabled){assert.equal(audit[0].body.p_evidence,'Submitted with test flag');assert.equal(audit[0].body.p_sold,false);assert.equal(audit[0].body.p_billed_amount,0);assert.ok(audit[0].options.signal);assert.equal(audit[0].options.redirect,'error');}
});

