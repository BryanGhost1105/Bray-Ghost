# Coldstart Rebuild Log

## Objective

Rebuild Coldstart into a safe, human-approved client-acquisition system and land the first paying pilot client by **31 October 2026**.

This is a working log. Every implementation change, verification result, market test, objection, and decision should be recorded here.

## Operating rules

- No automatic outreach sends. Every message requires explicit human approval.
- No paid SaaS subscriptions while the offer is unproven.
- No paid advertising for Coldstart before a paying pilot and a measurable offer exist.
- One niche, one geography, one offer at a time.
- Research and audit work may run automatically; sending may not.
- Every claim used in outreach must have a source or verified observation.
- A feature is not complete until it has a verification step and a rollback path.

## Commercial target

### First pilot

Offer: identify and repair the highest-impact website or online enquiry leak for one local business within 48 hours.

Initial validation target:

- 30 qualified prospects researched
- 10 real conversations
- 3 audit walkthroughs
- 1 paid pilot

### Weekly evidence gates

| Week | Product evidence | Market evidence |
|---|---|---|
| Sep 26–Oct 2 | Approval queue design and send path mapped | Niche, geography, and offer selected |
| Oct 3–9 | Approval queue works without sending accidentally | 10 prospects researched and contacted |
| Oct 10–16 | Reply stopping and suppression verified | 5 conversations and objections logged |
| Oct 17–23 | Audit-to-message workflow stable | 3 audit walkthroughs and proposals sent |
| Oct 24–31 | Pilot delivery checklist ready | First paid pilot closed |

If a gate fails, reduce scope or change the offer before adding features.

## Rebuild sequence

### Phase 0 — Safety and observability

- [ ] Map every route that can send email
- [ ] Add explicit research-only and send-enabled modes
- [ ] Add manual approval status and approval audit trail
- [ ] Prevent pipeline routes from sending unapproved leads
- [ ] Fix timeout/duplicate-send handling
- [ ] Add a safe dry-run mode
- [ ] Verify `.env.local` and credentials are never committed

### Phase 1 — Trustworthy lead intelligence

- [ ] Store contact source, confidence, and verification method
- [ ] Reject low-confidence contacts from approval by default
- [ ] Preserve source URLs for every audit observation
- [ ] Validate redirect destinations during crawling
- [ ] Protect AI prompts from untrusted website instructions
- [ ] Add Gmail reply and out-of-office detection
- [ ] Stop follow-ups immediately after replies, bounces, or opt-outs

### Phase 2 — One offer and one market

- [ ] Select one niche and geography
- [ ] Define one paid pilot and deliverables
- [ ] Rewrite audit output in business language
- [ ] Require one checkable fact in every draft
- [ ] Use permission-based first contact
- [ ] Track objections and outcomes

### Phase 3 — Manual validation

- [ ] Research 30 prospects
- [ ] Have 10 real conversations
- [ ] Walk through 3 audits
- [ ] Send proposals
- [ ] Close and deliver one paid pilot

### Phase 4 — Automate proven work

- [ ] Nightly digest and approval queue
- [ ] Client reporting
- [ ] Review-request workflow only after a client validates the need
- [ ] Channel-specific drafts for email, WhatsApp, and LinkedIn

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-09-26 | Rebuild tracked on `rebuild/phase-0-safety` | Keep safety work reviewable and separate from the baseline |
| 2026-09-26 | Manual approval is a hard product rule | Protect sender reputation and prevent embarrassing autonomous sends |
| 2026-09-26 | First commercial gate is one paid pilot by Oct 31 | Validate the offer before expanding the product |
| 2026-09-26 | Provisional first market: Port Harcourt solar installers | Local access, high-value enquiries, visible public market, and strong current energy demand |

## Work log

### 2026-09-26 — Kickoff

- Created the rebuild branch.
- Added this tracking document.
- Confirmed the current baseline is pushed to GitHub in commit `c56f90a`.
- Traced scheduled, manual, single-lead, and bulk send paths.
- Added persistent initial-send and follow-up approval fields.
- Made the sender and follow-up worker reject unapproved records.
- Changed single and bulk dashboard actions to approve drafts instead of dispatching them.
- Reset approval whenever a pitch is regenerated.
- Verification: `npm run lint`, `npx tsc --noEmit`, and `git diff --check` passed.
- Production build still has a pre-existing `.next` lock and requires a separate safe process check.
- Added a read-only outreach dry-run action that never contacts a provider or changes lead state.
- Added dashboard visibility for drafts awaiting approval versus approved drafts.
- Changed the top-level dispatch label to make the approved-only behavior explicit.
- Added a revoke-approval action so an approved draft can be returned to the pending queue before dispatch.
- Verification: `npm run lint`, `npx tsc --noEmit`, `git diff --check`, and send-path search passed.
- Added a read-only schema verifier at `scripts/check-approval-schema.mjs`.
- Confirmed the live database initially lacked all six approval columns.
- Added and ran the scoped transactional migration at `scripts/migrate-approval-schema.mjs`.
- Re-verified the live database: all six approval columns are present and no columns are missing.
- No lead rows or settings were modified by the migration.
- Ran the local authenticated workflow against the configured database: `POST /api/manual-trigger` with `dry_run` returned HTTP 200.
- Runtime result: 0 generated drafts, 0 approved sends, 0 pending approvals, 0 approved follow-ups; the endpoint confirmed no provider contact and no lead-state changes.
- Changed provider timeout handling so uncertain sends enter `send_uncertain`, lose approval, and cannot retry automatically; follow-up timeouts are likewise held for review.
- Added `send_uncertain_at` and `followup_uncertain_at` to the schema and verified both live columns after a transactional migration.
- Static verification: `npm run lint`, `npx tsc --noEmit`, and `git diff --check` passed.
- Production verification: `npm run build` completed successfully after the stale build process exited.
- Created `docs/validation/port-harcourt-solar.md` with the offer hypothesis, public evidence, 10 research candidates, contact checklist, script, and success gates.
- Inspected the first five public pages and recorded qualification notes; Solar World Electric currently looks like a benchmark/partnership target rather than a defect-led prospect.
- Market evidence has not yet been converted into contact or payment evidence; no outreach has been sent.
- Next action: live-check the remaining candidates and begin permission-based conversations with the strongest fit.
