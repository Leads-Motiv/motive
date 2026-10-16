"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { scheduleLeadDeliveryRecord } = require("../api/_lib/lead-delivery");
const { createHandler } = require("../api/lead");
const { request, responseRecorder, validLead } = require("./helpers");

const env = {
  VERCEL_ENV: "production",
  SUPABASE_URL: "https://warehouse.example.test/",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-key",
  TRUSTEDFORM_API_KEY: "trustedform-test-key",
  SI_POST_URL: "https://exchange.standardinformation.test/post",
  SI_API_KEY: "sio-test-key",
  SI_PARTNER_API_KEY: "sio-partner-test-key",
  GHL_WEBHOOK_URL: "https://ghl.example.test/hook",
  LEAD_ALLOWED_ORIGINS: "https://staging.example.test"
};

function setup({ capture, sioStatus = "success", overrides = {}, idempotency } = {}) {
  const calls = [], background = [], logs = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith(env.SUPABASE_URL.replace(/\/$/, ""))) {
      return capture ? capture(url, options) : new Response(null, { status: 201 });
    }
    if (String(url).startsWith("https://cert.trustedform.com/")) {
      return Response.json({ outcome: "success", retain: { results: [{}] }, match_lead: { result: { success: true } } });
    }
    if (String(url).startsWith("https://exchange.standardinformation.test/")) {
      return Response.json({ status: sioStatus, price: 70, confirmation_id: "test-confirmation" });
    }
    return Response.json({ success: true });
  };
  const logger = { log: x => logs.push(x), warn: x => logs.push(x), error: x => logs.push(x) };
  const handler = createHandler({ env, fetchImpl, logger,
    waitUntilImpl: promise => background.push(promise),
    zipAllowlist: new Set(["12207"]), now: () => new Date("2026-10-05T12:00:00Z"), idempotency, ...overrides });
  return { handler, calls, background, logs };
}

test("accepted SIO schedules capture without waiting and preserves SIO/GHL payloads", async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const active = setup({ capture: () => pending });
  const baseline = setup({ overrides: { env: { ...env, SUPABASE_SERVICE_ROLE_KEY: "" } } });
  const lead = validLead({ lead_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", utm_id: "wm_champ_test" });
  const res = responseRecorder(), previous = responseRecorder();
  try {
    await active.handler(request({ normalized_lead: lead }), res);
    await baseline.handler(request({ normalized_lead: lead }), previous);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), JSON.parse(previous.body));
    assert.equal(active.background.length, 1);
    const providerRequests = x => x.calls.filter(c => !c.url.includes("warehouse.example.test"))
      .map(c => ({ url: c.url, method: c.options.method, headers: c.options.headers, body: c.options.body }));
    const a = providerRequests(active), b = providerRequests(baseline);
    assert.deepEqual(a, b);
    const post = active.calls.find(c => c.url.includes("warehouse.example.test"));
    const payload = JSON.parse(post.options.body);
    assert.equal(payload.source_tag, "wm_champ_test");
    assert.equal(payload.email_raw, lead.email);
    assert.equal(payload.phone_raw, lead.phone_primary);
    assert.equal(payload.sale_price, 70);
    assert.equal(payload.sio_confirmation_id, "test-confirmation");
    assert.equal(payload.external_lead_id, lead.lead_id);
    assert.ok(Number.isFinite(Date.parse(payload.delivered_at)));
    assert.equal(post.options.headers.Authorization, "Bearer test-only-key");
    assert.equal(post.options.headers.Prefer, "return=minimal");
    assert.ok(post.options.signal instanceof AbortSignal);
  } finally {
    finish(new Response(null, { status: 201 }));
    await Promise.all(active.background);
  }
});

test("unavailable Supabase, HTTP failure and scheduling failure never fail the lead", async () => {
  for (const options of [
    { capture: async () => { throw new Error("test-only-key must not be logged"); } },
    { capture: async () => new Response("private database error", { status: 500 }) },
    { overrides: { waitUntilImpl: () => { throw new Error("scheduler unavailable"); } } },
    { overrides: { env: { ...env, SUPABASE_URL: "" } } }
  ]) {
    const x = setup(options), res = responseRecorder();
    await x.handler(request({ normalized_lead: validLead() }), res);
    await Promise.all(x.background);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).delivery.sio, "BUYER_ACCEPTED");
    assert.ok(x.logs.some(line => /supabase_delivery_(failed|schedule_failed|skipped)/.test(line)));
    assert.equal(x.logs.some(line => /test-only-key|private database error/.test(line)), false);
  }
});

test("capture timeout is two seconds and logging exceptions are swallowed", async () => {
  const pending = [], logs = [];
  const started = Date.now();
  // AbortSignal.timeout's timer is unref'd in Node; keep this test alive.
  const keepAlive = setTimeout(() => {}, 4_000);
  try {
    scheduleLeadDeliveryRecord({
      lead: { lead_id: "test" }, sourceTag: "test", sio: { accepted: true }, env,
      waitUntilImpl: p => pending.push(p),
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
      logger: { log: line => { logs.push(line); throw new Error("logger failed"); } }
    });
    await Promise.all(pending);
    assert.ok(Date.now() - started >= 1_900);
    assert.ok(Date.now() - started < 3_500);
    assert.match(logs[0], /"reason":"timeout"/);
  } finally { clearTimeout(keepAlive); }
});

test("rejected SIO, preview and cached replays do not record another delivery", async () => {
  for (const options of [
    { sioStatus: "denied" },
    { overrides: { env: { ...env, VERCEL_ENV: "preview" } } },
    { idempotency: { enabled: true, resultForLeadId: async () => ({ http_status: 200, body: { success: true } }) } }
  ]) {
    const x = setup(options), res = responseRecorder();
    await x.handler(request({ normalized_lead: validLead({ lead_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }) }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(x.background.length, 0);
    assert.equal(x.calls.some(c => c.url.includes("warehouse.example.test")), false);
  }
});

test("missing attribution uses exactly SIO's configured fallback", async () => {
  const x = setup(), res = responseRecorder();
  await x.handler(request({ normalized_lead: validLead() }), res);
  await Promise.all(x.background);
  const payload = host => JSON.parse(x.calls.find(c => c.url.includes(host)).options.body);
  assert.equal(payload("warehouse.example.test").source_tag, payload("exchange.standardinformation.test").meta.source_id);
});
