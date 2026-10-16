"use strict";

const crypto = require("node:crypto");
const { getConfig } = require("./_lib/config");
const { originAllowed } = require("./lead");
const { scheduleLeadRejection } = require("./_lib/lead-rejection");

const MAX_BYTES = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = Object.freeze({
  honeypot_filled: "Browser honeypot field was populated.",
  submitted_too_fast: "Browser minimum form-open time was not met.",
  insufficient_interaction: "Browser counted fewer than two input events."
});

function reply(res, status, code) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({ code }));
}

async function readBody(req) {
  if (Number(req.headers?.["content-length"] || 0) > MAX_BYTES) throw new Error("too_large");
  let text;
  if (req.body != null) text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  else {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > MAX_BYTES) throw new Error("too_large");
      chunks.push(bytes);
    }
    text = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("too_large");
  return JSON.parse(text);
}

function createHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return reply(res, 405, "method_not_allowed");
    }
    // No CORS. Require the same origin policy as /api/lead and a browser Origin.
    const origin = req.headers?.origin;
    if (typeof origin !== "string" || !/^https?:\/\//.test(origin) || !originAllowed(req, getConfig(env).allowedOrigins)) {
      return reply(res, 403, "origin_not_allowed");
    }
    if (!String(req.headers?.["content-type"] || "").toLowerCase().startsWith("application/json")) {
      return reply(res, 415, "unsupported_media_type");
    }
    let body;
    try { body = await readBody(req); }
    catch (error) { return reply(res, error.message === "too_large" ? 413 : 400, "invalid_payload"); }
    if (!body || !["index", "partner"].includes(body.page) ||
        !Array.isArray(body.reason_codes) || body.reason_codes.length < 1 || body.reason_codes.length > 3 ||
        body.reason_codes.some(code => typeof code !== "string" || !Object.hasOwn(REASONS, code))) {
      return reply(res, 400, "invalid_payload");
    }
    const leadId = UUID.test(body.lead_id || "") ? body.lead_id : crypto.randomUUID();
    // Attribution identifiers only: discard contact-shaped/unsupported values.
    const sourceTag = typeof body.source_tag === "string" && /^[a-zA-Z0-9_-]{1,180}$/.test(body.source_tag) &&
      !/^\d{7,}$/.test(body.source_tag) ? body.source_tag : null;
    for (const code of new Set(body.reason_codes)) {
      scheduleLeadRejection({
        property: "window-motiv", leadId, reasonCode: code, reasonDetail: REASONS[code],
        stage: "client_guard", sourceTag,
        landingPageUrl: new URL(body.page === "partner" ? "/Partner.html" : "/", origin).href,
        env, fetchImpl: dependencies.fetchImpl || globalThis.fetch,
        logger: dependencies.logger || console, waitUntilImpl: dependencies.waitUntilImpl
      });
    }
    // Accepted for best-effort background capture, not a database commit receipt.
    return reply(res, 202, "accepted");
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
