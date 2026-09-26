# Permission-First Outreach Playbook

**Market:** Port Harcourt solar and inverter businesses  
**Offer under test:** identify and repair one measurable online enquiry leak within 48 hours  
**Rule:** do not send an audit, link, attachment, or proposal until the person gives permission.

## What we are testing

The first message is not a website-development pitch. It tests whether the operator cares about a specific enquiry-path observation and will spend ten minutes discussing it.

Record every attempt in Coldstart as a `lead_interactions` entry. Do not count an attempted message as a conversation. Count a conversation only when a real person replies and discusses the business or the observation.

## First contact

### Email

Subject: Quick question about [Company]'s quote enquiries

> Hi [Name], I was checking how solar companies in Port Harcourt handle quote enquiries and noticed one small point on [Company]'s public website: [one checkable observation]. I do not want to send a long unsolicited audit. Would it be useful if I sent a two-minute note showing what a potential customer experiences on mobile?
>
> — Jephtah

### WhatsApp

> Hi, is this [Company]? I’m Jephtah, a software developer in Port Harcourt. I was checking the public enquiry path on your website and noticed [one checkable observation]. Can I send a short note about it here, or should I speak with someone else who handles enquiries?

### Phone opener

> Hi, my name is Jephtah. I’m researching how Port Harcourt solar companies receive online quote enquiries. I noticed one specific thing on your public website and wanted to ask who handles website enquiries. Is that you?

If they are the right person:

> Would you be open to a two-minute note about the observation? I’m not trying to sell you a redesign on this call.

## If permission is granted

Send only five parts:

1. One thing the business already does well.
2. The exact public observation and URL.
3. The likely customer friction, stated as a possibility rather than a lost-lead claim.
4. The smallest practical fix.
5. A choice: a 10-minute walkthrough or a paid 48-hour repair.

Example:

> Thanks. I checked the homepage on [date]. The business makes [strength] clear. The specific friction is [observation], visible at [URL]. That may make it harder for a visitor who is ready to ask for a quote to take the next step, although I cannot estimate lost enquiries from the outside. The smallest fix would be [fix]. Would you prefer a 10-minute walkthrough, or should I outline a paid 48-hour repair?

## Follow-up rules

- One permission request, then wait at least three business days.
- One follow-up only after the exact follow-up draft is reviewed and approved in Coldstart.
- If there is no response after the follow-up, stop and record `no_response`.
- If they say no, record `not_fit` and stop.
- If they ask not to be contacted, record `unsubscribe`; Coldstart suppresses further outreach.
- Never claim rankings, leads, revenue, or a percentage improvement without before/after evidence.

## Outcome labels

| Coldstart outcome | Use when |
|---|---|
| `attempted` | A message or call was made, with no meaningful reply yet |
| `permission_granted` | They explicitly allowed the note/audit to be sent |
| `conversation` | A real business discussion happened |
| `audit_walkthrough` | They reviewed the observation with us live |
| `proposal_sent` | A scoped paid offer was sent after a conversation |
| `paid_pilot` | Payment or written paid engagement is confirmed |
| `no_response` | The defined contact sequence ended without a reply |
| `not_fit` | They declined for a business-fit reason |
| `unsubscribe` | They requested no further contact |

## Daily operating target through the first ten conversations

- Research or verify 5 prospects.
- Send no more than 3 permission requests manually until the message earns replies.
- Record every outcome the same day.
- Review objections after each five attempts and change one variable only.
- Do not increase volume until at least one message produces a real conversation.
