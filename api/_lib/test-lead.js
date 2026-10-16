// Only the handler's URL-derived flag may schedule this audit.
const { waitUntil } = require("@vercel/functions");

function safeLog(logger, event) {
  try { logger.log(JSON.stringify({ event })); } catch { /* best effort */ }
}

async function recordTestLead({ row, env, fetchImpl, logger }) {
  try {
    const response = await fetchImpl(`${env.SUPABASE_URL.trim().replace(/\/+$/, "")}/rest/v1/rpc/mark_test_lead`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...row, p_evidence: "Submitted with test flag", p_sold: false, p_billed_amount: 0 }),
      redirect: "error",
      signal: AbortSignal.timeout(2_000)
    });
    safeLog(logger, response.ok ? "supabase_test_lead_recorded" : "supabase_test_lead_failed");
  } catch { safeLog(logger, "supabase_test_lead_failed"); }
}

function scheduleTestLead({ row, env = process.env, fetchImpl = globalThis.fetch, logger = console, waitUntilImpl = waitUntil }) {
  try {
    if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      safeLog(logger, "supabase_test_lead_skipped_missing_environment");
      return;
    }
    // A simulated SIO sale is never a billable sale or a billing deduction.
    waitUntilImpl(recordTestLead({ row, env, fetchImpl, logger }));
  } catch { safeLog(logger, "supabase_test_lead_schedule_failed"); }
}
module.exports = { scheduleTestLead };
