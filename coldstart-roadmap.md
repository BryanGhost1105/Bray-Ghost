# Coldstart / Bray-Ghost — Consolidated Roadmap

**Context for the agent:** Solo developer, day job during daytime, works on this at night only, using AI-assisted coding to move fast. Target: Tiers 0–2 and Tier 4 built out within about a month. Cannot sustain heavy nightly workload — the system must minimize nightly human effort to a ~15–20 min review/approval window once running. Zero budget for paid SaaS tools (GoHighLevel, Instantly, Apollo, etc.) — everything must run on free tiers or near-zero cost. Run in parallel with non-coldstart funding paths (not the sole plan). Prior failure mode: the tool went untouched for 3 months — sustainability of the nightly habit matters as much as the code. Note: AI-assisted coding speeds up every tier except Tier 3, which depends on real people responding and can't be compressed by faster development.

**Non-negotiable constraint across every tier: no fully autonomous sending.** Every email/message requires a human approval click before it goes out, until the system has a long track record of safe behavior. This is the guardrail against burning domain reputation or sending an embarrassing mistake unsupervised.

---

## TIER 0 — Blocking, do first

Nothing else is safe to build on top of until these are done.

| Item | Why urgent | Effort |
|---|---|---|
| Buy a dedicated sending domain (WhoGoHost or similar) | All outreach and deliverability work depends on owning a domain, not sending from a personal/shared one | Low |
| Set up SPF, DKIM, DMARC on that domain | Without this, cold email is close to guaranteed spam-foldered regardless of copy quality | Low–Medium |
| Fix the send-timeout race condition (duplicate-send bug in sender logic) | Can currently double-email a prospect on a timeout — a real reputational risk on the very first real test | Medium |
| Add a hard manual-approval gate before every send (no auto-send path at all yet) | Safety net while every other piece is still unproven | Low–Medium |
| Split the app into explicit "research only" and "send" modes | Lets you safely run discovery/audits on real businesses without any risk of accidental sends | Low |

---

## TIER 1 — Foundation

Safety and data-integrity fixes that everything downstream depends on.

| Item | Priority | Urgency | Effort |
|---|---|---|---|
| Reply detection via actual Gmail inspection (stop follow-ups automatically on reply/bounce/OOO/unsubscribe) | High | High | Medium |
| Confidence-scored email verification (source URL, name match, domain match, verification method, bounce history per lead — no auto-send on low-confidence addresses) | High | High | Medium |
| Bounce and unsubscribe handling, enforced everywhere | High | High | Low–Medium |
| Fix schema migrations running inside request handlers (`ensureSchema()`) — move to a proper migration step | Medium | Medium | Low |
| Fix scraper redirect validation (SSRF risk on following redirects blindly) | Medium | Medium | Low |
| Guard the AI prompt against injected instructions from scraped website text | Medium | Medium | Low |
| Revenue funnel schema: track every lead through sent → delivered → replied → qualified → meeting → proposal → paid | High | Medium | Medium |

**Gate to pass before Tier 2:** you can safely audit 20 real businesses without any accidental or duplicate send.

---

## TIER 2 — Offer, targeting, and messaging

This is where the actual conversion strategy lives — mostly logic/prompt changes, not risky infrastructure.

| Item | Priority | Notes |
|---|---|---|
| Pick ONE niche + ONE city to start | Critical | Everything below is wasted effort spread across too many segments at once |
| Signal-based lead scoring, replacing raw Google Places dump | High | Score on: recently opened, review-count trend, no/broken website, hiring signals |
| New-business / no-website opportunity segment | High | Keep within the operator-selected niche and city. Treat "no website listed" as a discovery clue that needs independent verification; treat "first found by Coldstart" separately from a verified opening date. Track a launch-site offer separately from the existing-site repair pilot, and only mark a business recently opened when a dated, business-controlled or otherwise reliable public source supports it. |
| "Review-gap" targeting layer | High | Flag businesses ranking well but with far fewer reviews than same-page competitors — this is a stronger, more visible pain point than generic technical audits |
| Rewrite personalization prompt (Gemini) to require one specific, checkable fact per business, or auto-reject the draft | Critical | Single highest-leverage change to reply rate |
| Offer reframe: "I find where you're losing calls/quote requests, and fix the highest-impact ones in 48 hours" (replaces generic "I build websites/SEO") | Critical | Sells an outcome, not a technical audit |
| 5-sentence "human translation" audit report format (compliment what works → found-vs-chosen framing → the gap, framed as risk not quality → the specific issue → the fix as a system) | High | Turns jargon audits into something a business owner actually reads and acts on |
| Permission-based first-touch script (ask before sending the audit, don't just send it cold) | High | Lowers the "stranger cold-pitching me" defensiveness |
| Message constraints: under ~100 words, one respectful follow-up only, no exaggerated claims, no promised rankings/results — only promise inputs (system running, requests sent, responses handled) | High | Compliance + trust |

---

## TIER 3 — Manual validation — NOT a coding task

This tier is deliberately not automation. It's the step that tells you whether the offer works before more nights get spent building for nobody. **AI can't compress this one** — it depends on real people replying, thinking it over, and deciding to pay. Tiers 0, 1, 2, and 4 are where AI-assisted coding actually buys you speed; this tier runs on calendar time and other people's schedules regardless of how fast the code ships.

- 30 manually-produced audits in the chosen niche/city
- Outreach mix: warm intros/personal network first, then WhatsApp, LinkedIn, highly personalized email — de-prioritize cold calling/in-person visits given day-job fatigue, unless energy allows
- Target: 10 real conversations, 3 audit reviews, 1 paid pilot
- Log every objection raised — this data drives the Tier 2 messaging revisions
- Facebook Groups: join 3–5 niche-matched groups (not generic freelancer groups), participate genuinely for ~15 min/day, watch for "does anyone know a good developer" threads — cannot be automated, budget as fixed time inside the nightly session

**Gate to pass before Tier 4:** at least one paying pilot client, ideally with a testimonial/case study.

---

## TIER 4 — Automate what's proven

Only automate steps you've now done manually several times and know convert.

| Item | Priority | Notes |
|---|---|---|
| Review-request automation module (self-built — replaces the GoHighLevel-based version entirely) | High | Trigger on "job marked complete," send review link via free-tier email/SMS (e.g. Twilio trial credit), one follow-up if unclicked. Send the same link to 100% of customers (no review-gating — Google prohibits filtering negative feedback away from the public review) |
| Auto/manual response to new reviews | Medium | Can start manual, automate once volume justifies it |
| LinkedIn semi-automated touch | Medium | Coldstart drafts the connection note (same specific-fact rule as email); you send manually — LinkedIn's bot detection is aggressive, keep the send human |
| Nightly digest/review queue (email or Telegram message summarizing new leads + drafted messages, one-click send/edit/skip) | High | This is what makes the "15–20 min at night" model actually work instead of you re-opening a dashboard cold each time |
| One-click pause per lead and per campaign | Medium | Cheap safety control |

---

## TIER 5 — Scale carefully (only after Tier 4 is stable)

- Increase volume gradually only where a specific niche/message combination has proven itself
- Weekly feedback loop: log every send's outcome against signal type + phrasing used, adjust scoring/targeting weights from real data
- Referral and partnership channels (photographers, printers, other local-service adjacent freelancers)
- Turn the proven workflow into something repeatable enough to eventually resell to other freelancers/agencies (optional, later)
- Dashboard should report business outcomes (replies, meetings, paid) as the primary metric — not activity volume

---

## Explicitly rejected / postponed — do not build these

| Item | Why |
|---|---|
| Forex signal group as a funding source | Unverifiable track record, no guarantee, common money-loss pattern |
| Paid ads (Google/Meta) for self right now | Requires real cash spend ($500–1500+/mo to get useful data) that isn't available; revisit only after Tier 3 proves the offer and there's spare cash to risk |
| GoHighLevel or other paid all-in-one SaaS subscriptions | The capabilities they sell (review-request automation, CRM) are buildable in coldstart itself at near-zero cost — don't pay $297/mo for convenience you can build |
| Fully autonomous mass-send outreach | Removes the human safety gate; too risky without a long proven track record |
| Elaborate frontend redesign, complex multi-dimensional scoring, more provider integrations, autonomous niche expansion | Adds surface area without adding proof the current approach works — postpone until Tier 5 |

---

## Running in parallel, outside coldstart entirely

Coldstart realistically produces supplemental income (roughly $200–1000+/month once mature), not a lump sum covering UK tuition + travel. Keep pursuing, in parallel and not blocked on coldstart's progress:

- Scholarships, sponsorships, assistantships
- Lower-cost university/program alternatives
- Tuition payment plans / installment options
- Direct outreach to university departments
- The existing paid-role job search (frontend/software/IT roles)

---

## Sustainability note (the actual risk, not the code)

The single biggest threat to this plan isn't a missing feature — it's the same one that stalled coldstart for 3 months before: skipped nights. Tier 4's nightly digest is designed specifically to make the recurring commitment small enough to survive fatigue (approve/edit/skip, not compose-from-scratch). If the nightly 15–20 minutes starts slipping to a few times a week, that's the signal to shrink scope further, not to add more automation.
