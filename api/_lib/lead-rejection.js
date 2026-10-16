"use strict";
const { waitUntil } = require("@vercel/functions");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safePageUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    // Query strings, fragments and userinfo can contain contact details/tokens.
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch { return null; }
}
function captureLog(logger, event, detail = {}) {
  try { logger.log(JSON.stringify({ event, ...detail })); } catch { /* best effort */ }
}
function scheduleLeadRejection({
  property, leadId, reasonCode, reasonDetail, stage, sourceTag, landingPageUrl, zip, state,
  env = process.env, fetchImpl = globalThis.fetch, logger = console, waitUntilImpl = waitUntil
}) {
  try {
    // Keep preview/local traffic out of production facts, like Window delivery capture.
    if (env.VERCEL_ENV !== "production") return;
    if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      captureLog(logger, "supabase_rejection_skipped", { reason: "missing_environment" });
      return;
    }
    // Explicit field whitelist: never serialize a lead, request, or provider error.
    const row = {
      property, lead_id: UUID.test(leadId || "") ? leadId : null,
      reason_code: reasonCode, reason_detail: reasonDetail || null, stage,
      source_tag: sourceTag || null, landing_page_url: safePageUrl(landingPageUrl),
      zip: /^\d{5}(?:-\d{4})?$/.test(String(zip || "")) ? String(zip) : null,
      state: /^[A-Z]{2}$/.test(String(state || "").trim().toUpperCase()) ? String(state).trim().toUpperCase() : null
    };
    const write = async () => {
      try {
        const response = await fetchImpl(`${env.SUPABASE_URL.trim().replace(/\/+$/, "")}/rest/v1/fact_lead_rejection`, {
          method: "POST",
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(row), redirect: "error", signal: AbortSignal.timeout(2000)
        });
        if (!response.ok) {
          captureLog(logger, "supabase_rejection_failed", { reason: "http_error", status: response.status });
          return;
        }
        captureLog(logger, "supabase_rejection_recorded", { lead_id: row.lead_id, reason_code: reasonCode });
      } catch (error) {
        captureLog(logger, "supabase_rejection_failed", { reason: ["AbortError", "TimeoutError"].includes(error?.name) ? "timeout" : "request_failed" });
      }
    };
    waitUntilImpl(write());
  } catch { captureLog(logger, "supabase_rejection_schedule_failed"); }
}
module.exports = { scheduleLeadRejection };
