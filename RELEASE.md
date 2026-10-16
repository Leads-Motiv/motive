# Champion production releases

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
