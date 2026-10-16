"use strict";

const { waitUntil } = require("@vercel/functions");

const WRITE_TIMEOUT_MS = 2_000;

function logCapture(logger, event, detail = {}) {
  // Capture diagnostics must never throw into the lead pipeline or expose PII.
  try { logger.log(JSON.stringify({ event, ...detail })); } catch { /* best effort */ }
}

async function recordLeadDelivery({ lead, sourceTag, sio, env, fetchImpl, logger }) {
  try {
    const response = await fetchImpl(
      `${env.SUPABASE_URL.trim().replace(/\/+$/, "")}/rest/v1/fact_lead_delivery`,
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          email_raw: lead.email,
          phone_raw: lead.phone_primary,
          sio_confirmation_id: sio.confirmation_id ?? null,
          sale_price: sio.price ?? null,
          source_tag: sourceTag,
          delivered_at: new Date().toISOString(),
          external_lead_id: lead.lead_id
        }),
        redirect: "error",
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS)
      }
    );
    if (!response.ok) {
      logCapture(logger, "supabase_delivery_failed", { reason: "http_error", status: response.status });
      return;
    }
    logCapture(logger, "supabase_delivery_recorded", { lead_id: lead.lead_id });
  } catch (error) {
    logCapture(logger, "supabase_delivery_failed", {
      reason: ["TimeoutError", "AbortError"].includes(error?.name) ? "timeout" : "request_failed"
    });
  }
}

function scheduleLeadDeliveryRecord({
  lead, sourceTag, sio, env = process.env, fetchImpl = globalThis.fetch,
  logger = console, waitUntilImpl = waitUntil
}) {
  try {
    // Preview/test deployments never write production delivery facts.
    if (!sio.accepted || env.VERCEL_ENV !== "production") return;
    if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      logCapture(logger, "supabase_delivery_skipped", { reason: "missing_environment" });
      return;
    }
    // Do not await this: SIO/GHL results and the response remain authoritative.
    waitUntilImpl(recordLeadDelivery({ lead, sourceTag, sio, env, fetchImpl, logger }));
  } catch {
    logCapture(logger, "supabase_delivery_schedule_failed");
  }
}

module.exports = { scheduleLeadDeliveryRecord };
