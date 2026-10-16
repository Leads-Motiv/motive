# Champion production releases

## Browser guard mode

Both forms load `/browser-guard-policy.js`. The single setting is currently
`mode: "log-only"`. Honeypot, minimum-time and interaction triggers still POST
to `/api/rejection`, but submission continues. Their reason codes end in
`_observed`, stage remains `client_guard`, and detail says "Observed only".
The honeypot value is cleared in the outgoing lead payload in this mode, so
browser autofill does not trip the independent server honeypot check. Direct
posts still face the server check. ZIP, qualification, consent, TrustedForm,
dedup, SIO and GHL retain their existing behavior. Observation is not proof of
delivery: later validation or a provider can still reject the submission.

To restore blocking: change **only** `mode: "log-only"` to `mode: "enforce"`
in `browser-guard-policy.js`, run `npm test`, commit/push and deploy the same
complete revision. Reload both pages to verify the original guard error and
unsuffixed reason codes. The policy response is no-store; already-open tabs
keep their loaded mode until reloaded. If the policy script cannot load, the
browser allows submission and records observations rather than blocking leads.
The endpoint uses the browser-reported mode, preserving the distinction for
old open tabs; it does not accept arbitrary reason names or detail text.

Count enforced blocks separately from observations. Multiple triggers share an
attempt UUID; count distinct lead_id for attempts, not reason rows. Production
verification uses `?test=1` and fictional details; exclude those fixtures from
traffic analysis. No production buyer should be billed by a verification run.

The canonical source is `Leads-Motiv/motive`, production branch `main`, Vercel
project `cwae-windows`, domain `cwae.windowmotiv.com`.

Before releasing, fetch the current production branch and inspect Vercel's
production commit. Preserve the current two-step main form. The partner form has
four steps; these are different entry points.

Commit all runtime changes and their tests to Git before deploying. A CLI upload
is a complete source snapshot: an uncommitted fix disappears when the next Git
deployment replaces that snapshot. Never deploy an older local checkout simply
because it is linked to the right Vercel project.

`vercel.json` runs `npm test` during builds. Keep the test directory in deployment
uploads. Tests cover source attribution, delivery/rejection capture failure
isolation, query-only test routing and browser release contracts.

After deployment verify the production alias and commit, two-step form, a safe
`?test=1` submission using SIO `/post_test`, and the matching Supabase capture
with the same `utm_id`. Check a ZIP rejection separately. Never create a billable
production test lead. Do not treat a successful build as proof of data capture.

The October 15, 2026 regression began when a Git deployment replaced CLI-only
delivery/rejection modules. The same Git update sequence removed browser
`utm_id` forwarding and backend priority. The restoration carries these changes,
the browser guard repair and test routing together in Git.
