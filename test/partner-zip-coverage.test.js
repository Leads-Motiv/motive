"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeLead, validateLead } = require("../api/_lib/validate");
const { validLead } = require("./helpers");

const html = fs.readFileSync(path.join(__dirname, "..", "Partner.html"), "utf8").replace(/\r\n/g, "\n");

test("Partner.html refuses a ZIP in the browser only when the coverage list loaded", () => {
  // A failed coverage download must not look like an uncovered ZIP.
  assert.match(html, /const zipCoverageKnown =\s*Boolean\(approvedZips\);/);
  assert.match(html, /const zipQualified =\s*zipCoverageKnown &&\s*approvedZips\.has\(zip\);/);
  assert.match(html, /return \{[^}]*\bzipCoverageKnown,[^}]*\bzipQualified,/);
  const guard = html.match(/if \(\s*([^)]*?)\s*\) \{\s*showError\(\s*"This ZIP code is not currently included/);
  assert.ok(guard, "the browser ZIP refusal must still exist for a loaded list");
  assert.match(guard[1], /^routing\.zipCoverageKnown &&\s*!routing\.zipQualified$/);
});

test("the server still refuses an uncovered ZIP, and refuses all ZIPs if its own list is empty", () => {
  const context = { leadId: "11111111-1111-4111-8111-111111111111", now: new Date(), ip: "203.0.113.1", userAgent: "test" };
  const lead = normalizeLead(validLead(), context);
  assert.doesNotThrow(() => validateLead(lead, new Set([lead.postal_code])));
  for (const allowlist of [new Set(["00000"]), new Set()]) {
    assert.throws(() => validateLead(lead, allowlist), e => e.code === "zip_not_eligible");
  }
});
