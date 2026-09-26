# Internal operating guide

This instance is intentionally single-operator. It discovers local businesses, audits websites, finds only evidence-backed contact emails, generates a grounded pitch, and sends a small Gmail queue.

## First setup

1. Copy the variable names from `README.md` into `.env.local` and set `DATABASE_URL`, `APP_ACCESS_TOKEN`, `CRON_SECRET`, `APP_URL`, `SENDER_NAME`, and `SENDER_POSTAL_ADDRESS`.
2. Set either Gmail OAuth variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`) or the SMTP fallback (`GMAIL_USER`, `GMAIL_APP_PASSWORD`). Never commit either credential.
3. Set `DEEPSEEK_API_KEY` or `AI_API_KEY`, `GOOGLE_PLACES_API_KEY`, and run `node scripts/init-db.mjs` once.
4. Start the app with `npm run dev`, open `http://localhost:3000`, and sign in with `APP_ACCESS_TOKEN`.
5. In Pipeline Settings, confirm the Gmail account, mailing address, reply-to address, and paused state before sending.

## Gmail connection

Use the Settings tab's Gmail connection button. The app requests only Gmail send permission and stores the refresh token encrypted with `GMAIL_TOKEN_ENCRYPTION_KEY`. If OAuth is not used, Gmail App Password SMTP is the fallback. The app does not use Resend.

## Daily workflow

1. Choose a small targeting matrix in Targeting. Start with one niche and one city while validating quality.
2. Run Discover once. It adds new Places leads and does not send mail.
3. Run Pipeline. It enriches emails, audits websites, generates pitches, sends due follow-ups, and sends initial Gmail outreach subject to the 10 initial / 10 follow-up hard daily limits.
4. Review generated messages and evidence in Leads Directory before increasing the internal daily cap. A lead must be in `generated` status to send.
5. Check Gmail replies manually and use the reply toggle in the dashboard. Reply-marked leads are excluded from follow-ups and future sends.
6. Monitor the Error Log and `failed`, `unsubscribed`, and `email_needed` statuses. Do not retry an address after a bounce without verifying it manually.

## Lead workspace workflow

The Leads tab is the control center. Use the status tabs and search box to narrow the queue, then work from the `Next action` text shown under each status:

1. `Crawl website for email` means the lead has a website but no evidence-backed public email yet. Open `Intel`, then use `Scrape Email Now` to run the website crawl and public-source fallback.
2. `Run website audit` means a contact exists but the website intelligence is incomplete. Use `Re-Audit` before creating the pitch.
3. `Generate pitch for review` means the lead is contactable but has no saved draft. Use `Run Pipeline` or `Re-Generate`.
4. `Review pitch before sending` means the draft is ready. Click `Intel` or `Review pitch`, verify the evidence and offer, then use `Send Now` only when it is personally approved.

Each email now shows its confidence and, when available, an `Evidence` link to the page where the address was found. A missing email is not treated as a failure: businesses may not publish one, so use the phone or add a manually verified contact instead of guessing.

Select rows for bulk re-audits or dispatch. Keep bulk sending for leads whose pitch has already been reviewed; the application still applies Gmail, daily-cap, suppression, reply, unsubscribe, and compliance checks at send time.

## Manual actions

- `Discover`: fetches Google Places leads only.
- `Run Pipeline`: runs the bounded production pipeline and Gmail sending stages.
- `Enrich Emails`: retries eligible email sourcing with a two-day retry window and a three-attempt limit.
- `Send Outreach`: uses the same daily cap, suppression, reply, claim, and compliance checks as scheduled sending.
- `Find Email`: accepts a result only when the source page matches the business and city, or the email domain matches the business website.
- `Re-audit` / `Regenerate`: refreshes evidence and creates a new grounded pitch; neither action sends automatically.

## Before going live

- Send one test to yourself and verify the `Reply-To`, physical address, and unsubscribe link.
- Confirm SPF, DKIM, and DMARC for the Gmail sending domain/account and use a real monitored reply inbox.
- Keep the operator pause switch available and start with a handful of manually reviewed leads.
- Use a separate Gmail account for outreach, not a personal education or primary mailbox.
- Rotate any credential that has ever been pasted into a script, chat, screenshot, or repository.
