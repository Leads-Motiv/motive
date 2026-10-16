"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../api/lead");
const { scheduleLeadRejection } = require("../api/_lib/lead-rejection");
const { request, responseRecorder, validLead } = require("./helpers");
const env = { VERCEL_ENV: "production", SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only" };
const logger = { log() {}, warn() {}, error() {} };
const leadId = "11111111-1111-4111-8111-111111111111";

for (const [name, overrides, allowed, expected, status] of [
  ["zip", {}, new Set(["30301"]), "zip_not_eligible", 422],
  ["validation", { email: "bad-contact" }, new Set(["12207"]), "validation_failed", 422],
  ["honeypot", { hp_token: "bot@example.test" }, new Set(["12207"]), "honeypot_triggered", 400],
  ["dedup", {}, new Set(["12207"]), "duplicate", 200]
]) {
  test(`${name}: response is sent before private, source-attributed background capture`, async () => {
    const res = responseRecorder(); const writes = []; const pending = [];
    let release;
    const handler = createHandler({ env, logger, zipAllowlist: allowed,
      idempotency: { enabled: false, claim: async () => ({ status: "DUPLICATE", leadId }) },
      fetchImpl: async (url, options) => {
        assert.ok(res.body, "response must be sent before capture starts");
        assert.match(url, /fact_lead_rejection$/); // Never SIO, GHL or TrustedForm.
        writes.push(JSON.parse(options.body));
        await new Promise(resolve => { release = resolve; });
        return { ok: true };
      }, waitUntilImpl: promise => pending.push(promise)
    });
    await handler(request(validLead({ lead_id: leadId, utm_id: "wm_champ_01_fmg", subID1: "wrong", landing_page_url: "https://site.test/?email=ada@example.com#phone", ...overrides })), res);
    assert.equal(res.statusCode, status); assert.equal(writes.length, 1);
    const row = writes[0]; assert.equal(row.reason_code, expected);
    assert.equal(row.source_tag, "wm_champ_01_fmg"); assert.equal(row.property, "window-motiv");
    assert.equal(row.lead_id, leadId); assert.equal(row.zip, "12207"); assert.equal(row.state, "NY");
    assert.equal(row.landing_page_url, "https://site.test/");
    assert.doesNotMatch(JSON.stringify(row), /ada@example|Lovelace|2125550123|bot@example|bad-contact/);
    release(); await Promise.all(pending);
  });
}

test("capture HTTP, timeout, scheduler and logger failures never reject", async () => {
  for (const failure of ["http", "timeout", "schedule"]) {
    const pending=[];
    assert.doesNotThrow(() => scheduleLeadRejection({ property:"window-motiv", leadId, reasonCode:"zip_not_eligible", stage:"validation", env,
      logger:{log(){throw new Error("logger failure");}},
      fetchImpl:async (_url,options)=>{assert.ok(options.signal);if(failure==='timeout')throw new DOMException('timeout','TimeoutError');return {ok:false,status:503};},
      waitUntilImpl:p=>{pending.push(p);if(failure==='schedule')throw new Error('schedule failed');}
    }));
    await assert.doesNotReject(Promise.all(pending));
  }
});

test("preview and missing configuration do not write", () => {
  for (const settings of [{...env,VERCEL_ENV:"preview"},{VERCEL_ENV:"production"}]) {
    scheduleLeadRejection({env:settings,logger,fetchImpl:()=>assert.fail("must not fetch"),waitUntilImpl:()=>assert.fail("must not schedule")});
  }
});

test("cached rejection replay does not add another fact", async () => {
  const res=responseRecorder();
  await createHandler({env,logger,idempotency:{enabled:true,resultForLeadId:async()=>({http_status:422,body:{code:'zip_not_eligible'}})},fetchImpl:()=>assert.fail('no network'),waitUntilImpl:()=>assert.fail('no duplicate capture')})(request(validLead({lead_id:leadId})),res);
  assert.equal(res.statusCode,422);assert.equal(JSON.parse(res.body).idempotent_replay,true);
});

test("a stalled write aborts after two seconds and resolves without an unhandled error", async () => {
  const pending=[];const started=Date.now();let aborted=false;
  const keepAlive=setTimeout(()=>{},3000);
  try {
    scheduleLeadRejection({property:'window-motiv',leadId,reasonCode:'validation_failed',stage:'validation',env,logger,
      fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true})),
      waitUntilImpl:p=>pending.push(p)
    });
    await Promise.all(pending);assert.equal(aborted,true);assert.ok(Date.now()-started>=1900);assert.ok(Date.now()-started<2900);
  } finally { clearTimeout(keepAlive); }
});
