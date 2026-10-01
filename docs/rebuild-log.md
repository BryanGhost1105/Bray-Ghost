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

- [x] Map every route that can send email
- [x] Add explicit research-only and send-enabled modes
- [x] Add manual approval status and approval audit trail
- [x] Prevent pipeline routes from sending unapproved leads
- [x] Fix timeout/duplicate-send handling
- [x] Add a safe dry-run mode
- [x] Separate follow-up draft preparation, human approval, and dispatch
- [x] Verify `.env.local` and credentials are never committed (`node scripts/check-repository-hygiene.mjs`)

### Phase 1 — Trustworthy lead intelligence

- [x] Store contact source, confidence, and verification method
- [x] Reject low-confidence contacts from approval by default
- [x] Preserve source URLs for every audit observation
- [x] Validate redirect destinations during crawling
- [x] Protect AI prompts from untrusted website instructions
- [ ] Add Gmail reply and out-of-office detection (requires restricted inbox access and renewed OAuth consent; intentionally not enabled)
- [x] Stop follow-ups after replies, bounces, or opt-outs are recorded; re-check eligibility immediately before follow-up dispatch

### Phase 2 — One offer and one market

- [x] Select one niche and geography (provisional: solar installers in Port Harcourt)
- [x] Define one paid pilot and deliverables (`docs/validation/pilot-offer.md`)
- [x] Rewrite audit output in business language (conversation brief added to Intel view)
- [x] Require one checkable fact in every draft
- [x] Use permission-based first contact
- [x] Track objections and outcomes

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
- Seeded five validation prospects into the live database under the `Solar Installer` / `Port Harcourt, Nigeria` niche without adding guessed email addresses.
- Ran the authenticated single-lead pipeline against all five prospects. Result: 5/5 reached `generated`, 5/5 have a discovered contact address, and 5/5 remain `initial_approval_status = pending`.
- Completed the public research pass for the remaining five candidates and added them to the live cohort. The second pipeline run produced 3 more generated audits with contact addresses; 2 sites returned fetch failures and remain manual-review items rather than being labelled defective.
- Current cohort evidence: 10 prospects researched, 8 generated audit states, 8 stored contact addresses, 0 approved sends, 0 conversations, and 0 paid pilots.
- Current contact priority from measured evidence: Solartricity (opportunity 34), Rafrank Integrated (23), Khariz Energy (15), then Dayli Energy (13). TECIL Solar is currently a benchmark/partnership target.
- Tightened the AI generator to produce permission-first first contacts and added a runtime safety check that rejects drafts without a permission request or with unsupported lead/revenue/ranking claims. Existing drafts remain pending until regenerated and reviewed.
- Added `generation_policy_version` enforcement so legacy drafts cannot be approved or sent until regenerated under `permission-v1`.
- Removed the pipeline's hard AI-key gate. Manual and scheduled generation now use the safe deterministic fallback when no AI key is configured, so free/no-paid-tool operation still produces reviewable drafts.
- Draft regeneration was attempted against the eight generated validation leads; Gemini rejected the batch with its free-tier 429 quota (5 requests/minute). No drafts were changed and no messages were sent.
- Added a deterministic, fact-grounded permission-first fallback draft for missing/quota-exhausted/unsafe AI responses. Runtime smoke test regenerated Solartricity successfully while Gemini quota was exhausted; the stored draft remained pending with `generation_policy_version = permission-v1`.
- Tightened the validator to reject invented artifacts such as “I prepared a one-page note” and unsupported impact claims. Sombreiro's draft was regenerated and now asks permission without claiming a note already exists.
- Added `scripts/check-permission-drafts.mjs`; live verification passed for all 8 generated validation drafts (`8/8` permission request, `0/8` banned-claim failures).
- Prepared an unsent first-contact queue for Solartricity, Rafrank Integrated, and Khariz with source URLs, channel choices, re-check conditions, and permission-first copy. No interaction was recorded because no message has been sent.
- Added the fixed-scope 48-hour enquiry-path repair pilot and proposal template. The initial price test is ₦75,000 split 50/50; it is explicitly experimental and makes no ranking, lead, or revenue promise. No proposal has been sent and no payment has been received.
- Re-checked the first-contact queue on 2026-09-30. Rafrank remains the strongest cleared candidate pending a final visual/mobile check; Khariz requires a diagnostic mobile handoff check; Solartricity was placed on hold because its currently indexed contact address conflicts with the stored address. No message was sent.
- Corrected the dashboard's contact-candidate count and label: server and modal filters now agree, exclude sent/replied/unsubscribed leads, and explicitly require human source and draft review. The UI no longer calls every discovered address a verified email.
- Added a confirmation-gated manual-attempt recorder beside each unsent draft. It records an `attempted` interaction only after the user confirms they sent the message independently; it never invokes a provider or changes approval state.
- Removed the unsafe implicit `HIGH` confidence display for contacts with missing confidence data. The Intel profile now shows `UNKNOWN` and warns when the address lacks explicit high confidence or a linked source URL.
- Made the application pipeline research-only: manual discovery, enrichment, auditing, and draft generation no longer dispatch messages. Approval and the sender now additionally require `email_confidence = HIGH` and a linked source URL; dispatch remains a separate explicit action.
- Ran the application-side `scripts/audit-new-validation-leads.mjs` against the 10 new leads: 10/10 API calls returned 200; 5 reached `generated` with drafts, 2 reached `email_needed`, and 3 reached `no_website`. No approval or send occurred.
- Added and ran `scripts/check-repository-hygiene.mjs`:  tracked filenames and `HEAD` contents were scanned for environment files, private keys, database URLs with passwords, and common API-token patterns; the check passed.
- Expanded the documented Port Harcourt solar research pool from 10 to 20 public-source candidates. The additional 10 are research-only until website, decision-maker, contact route, and observation checks are completed; no guessed addresses were added and no outreach was sent.
- Updated the scoped validation seed with the 10 documented candidates; the live database reported `inserted: 10` and `totalCandidates: 20`. Ran `scripts/check-validation-cohort.mjs`: `total=20`, `new_leads=10`, `without_email=12`, `non_pending_approvals=0`, `sent=0`, and `audited=10`; the cohort safety check passed.
- Added persisted `email_verification_status`, `email_verified_at`, and `email_verification_method` fields. The live migration completed successfully; future approval and sender checks use `source_verified` rather than inferring verification from raw fields.
- Re-ran the cohort verifier after migration: `total=20`, `source_verified=11`, `needs_review=2`, `unverified=7`, `approved_without_verification=0`, `sent=0`, and `audited=17`; safety check passed.
- Re-checked and expanded the unsent first-contact queue with Dayli, PET FEB, and Sombreiro. Their current public pages support diagnostic, permission-first messages; no message or interaction was sent or recorded.
- Expanded the Port Harcourt solar research pool to 30 public-source candidates using a second research pass. Added Flowcrown, Ibis, Felson, Almond, Francostech, Reverse Energy, Nyesco, Enerplaz, Tovero, and A.O. Demarg as research-only records; no guessed addresses were added and no outreach was sent.
- Seeded the expanded list against the live database: `inserted: 13`, seed definition `totalCandidates: 30` (the existing data already contained some of those businesses). The post-seed cohort read and the app audit runner both timed out connecting to the database, so the new records' audit and verification outcomes remain unconfirmed. The audit runner now resumes only `new` leads without `last_audited_at`; seed deduplication treats null websites as equal, and the cohort verifier requires at least 30 records.
- Tightened contact verification after tracing provenance: AI-extracted email candidates are now always `MEDIUM`, carry no fabricated source URL, and cannot be promoted to `source_verified` by any write path. Runtime schema reconciliation and the migration also downgrade legacy AI-derived `source_verified` rows to review. Database execution of that downgrade is pending because the live database is timing out.
- Clarified product wording: `source_verified` means the address was found on a linked public source and does not mean mailbox delivery was tested. API responses and the Intel panel now say this explicitly instead of calling a source match a verified mailbox.
- Removed two impossible dashboard status comparisons surfaced by TypeScript, escaped an apostrophe caught by JSX lint, and excluded the nested `.kilo` worktree from the root ESLint scan. TypeScript passed; lint on the changed application files passed with eight pre-existing unused-variable warnings. The live cohort check remains unavailable due to database timeouts.
- Resolved the database timeout: the app uses `@neondatabase/serverless`, while operational scripts used raw `pg` TCP connections that Neon reset. Switched the database scripts to the app's Neon driver and made seed/migration transactions hold one client. The live migration then committed successfully; the cohort and approval-schema verifiers ran successfully.
- The live cohort reports 33 rows but 30 distinct business names. Three extra rows came from the earlier seed's null-website comparison; the seed now uses null-safe deduplication, and the cohort verifier checks distinct businesses instead of raw row count. No records were deleted.
- Ran Coldstart's authenticated website audit for the 10 new candidates. Nine completed successfully and produced generated drafts; Nyesco remains a fetch failure. The first pass also recovered GoSolar Ng and Marrot Energy; later passes recovered Almond Solutions, SolarBolts, and A.O. Demarg. Goshenvilla and Nyesco remain fetch failures and are now queued for bounded background retry. No messages were approved or sent.
- The first live app audit exposed two operational defects: the Neon driver needed explicit text casts for nullable contact-verification parameters, and failed audits were being counted as successful by the runner and left the scheduled queue. Added typed casts, truthful `scrapedOk` reporting, failure detail output, and automatic audit retries with a bounded three-attempt daily backoff before routing to email sourcing/manual review.
- Latest verified cohort safety state after the audit retries: `total=33`, `unique_businesses=30`, `new_leads=2` (both awaiting scheduled retries), `without_email=8`, `source_verified=23`, `needs_review=2`, `unverified=8`, `non_pending_approvals=0`, `approved_without_verification=0`, `sent=0`, `audited=27`; safety passed. The schema verifier also confirmed the contact verification, audit retry, approvals, and interaction fields are present.
- Re-ran the full Neon-backed seed after the null comparison fix; it reported `inserted: 0`, `totalCandidates: 30`, confirming the seed is idempotent against the live cohort.
- Rechecked the highest-scoring new outreach options against current official pages and corrected Tovero Energy's saved URL from HTTP to its official HTTPS address. Coldstart's re-audit then removed the false SSL warning and changed its opportunity score from 24 to 20; its address remains source-linked and its draft remains pending.
- Prepared two additional permission-first messages for Felson Solar Solutions and Tovero Energy in the first-contact queue, with explicit non-claims and mobile/source checks. Rafrank remains the first conversation target; no contact attempts or other interactions have been recorded.
- Audit result: opportunity scores ranged from 5 to 34. Solartricity is the clearest defect-led test; Solar World Electric is a benchmark/partnership target rather than a generic website-audit prospect.
- No provider was contacted and no message was approved or sent.
- Replaced the old US/Dallas/roofing starter presets with Nigeria-oriented UI suggestions. Custom niche/city pairs remain supported; this does not force a market.
- Split follow-up handling into draft preparation, explicit human approval, and dispatch. The send worker now refuses to generate missing follow-up content while sending.
- Added follow-up approval/revocation actions and a dashboard preview/control for prepared follow-ups.
- Updated the scheduled pipeline so pending follow-up drafts are preparation work, while only complete approved follow-ups are dispatch work.
- Added a persistent `lead_interactions` table, API, dashboard form, and validation scorecard for attempts, conversations, walkthroughs, proposals, and paid pilots.
- Added the permission-first channel scripts and outcome definitions in `docs/validation/outreach-playbook.md`.
- Applied and verified the live validation-table migration. The verifier reported all approval columns present and `lead_interactions` present.
- Verification: `npm run lint` (0 errors, existing unused-variable warnings), `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed.
- Runtime smoke test was attempted, but local Next development server database initialization returned a connection `ErrorEvent`; no live lead state was changed by that failed request.
- Next action: manually re-check the strongest observations on mobile, record decision-maker/channel evidence, then start permission-based conversations one at a time.
- Added audit retry visibility to the selected lead's Intel panel and next-action label, using the live `audit_attempts` and `audit_next_attempt_at` fields. Failed prior attempts are shown as pending/retry states rather than incorrectly described as successful audits; scheduled retry time is localized in the browser. No pipeline was forced and no external contact was made.
- Closed the crawler redirect-validation gap: website auditing, contact-page enrichment, and search-result fetching now use a shared manual-redirect handler that validates every destination before requesting it, blocks local/private literal targets, and caps redirect hops. TypeScript passed; lint passed with 0 errors and the same 8 existing warnings. Smoke-tested that a private redirect is rejected before a second fetch and a relative public redirect succeeds. No live lead data was changed.
- Attempted read-only live cohort verification, but this environment could not establish the Neon WebSocket connection; the live cohort counts and scheduled audit retries are therefore not re-verified in this turn.
- Strengthened the redirect fix against DNS rebinding: every request resolves its destination once, rejects any non-public answer (including private, loopback, link-local, metadata, documentation, and transition ranges), and pins the socket to one of those checked addresses while retaining the requested hostname for HTTP/TLS. Safe crawler transport is GET/HEAD-only. TypeScript/lint and offline IP/URL guard smoke checks passed; full external crawl and live cohort checks remain unverified because outbound Neon/network access is unavailable in this environment.
- Production verification after DNS-pinning change: `npm run build` passed on Next.js 16.3.0, including compilation, TypeScript, and page generation. External live-crawl execution is still unverified from this sandbox.
- Extended saved website audits with per-fact source URL and observation time metadata, and exposed a source link beside every fact in the Intel panel. Legacy audit records remain readable and simply omit unavailable source metadata. Local audit smoke test verified every emitted fact retains the audited page URL and shared observation timestamp; TypeScript and lint passed with 0 errors and 8 pre-existing warnings.
- Hardened AI use across outreach generation, obfuscated-email extraction, follow-up generation, and niche expansion: external values are serialized as untrusted JSON in user messages, system instructions explicitly forbid following embedded commands, initial/follow-up outputs reject prompt-override language and control characters, and unsafe fallback observations are omitted. Niche suggestions are length-limited, filtered, and capped at five. Prompt-boundary smoke test, TypeScript, lint (0 errors; same 8 warnings), and `npm run build` passed. No external message was sent and no lead state was changed.
- Closed a recorded-reply race: marking a prospect replied now revokes follow-up approval and clears its queued claim; the follow-up worker rechecks reply, unsubscribe, suppression, approval, and claim state after its send delay and immediately before Gmail dispatch. Removed a dashboard “+1 Log Reply” control that supplied no lead ID and did not actually record a reply. Inbox auto-detection remains off because it requires restricted Gmail read access and renewed OAuth consent. `npx tsc --noEmit`, `npm run lint` (0 errors; same 8 existing unused-variable warnings), `git diff --check`, and `npm run build` passed. No live send test was run.
