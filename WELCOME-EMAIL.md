# Welcome email (disabled pending copy approval)

The existing approved transactional sender is `noreply@id.ideaflow.app` on Resend. Machines provisioned a dedicated HI `sending_access` key restricted to that domain; no global/admin key is used. Neither that key nor an enable flag is committed or bound by this PR.

Two optional Worker secrets enable delivery: `HI_RESEND_API_KEY` and `WELCOME_EMAIL_ENABLED` set to the exact string `true`. Without both, or outside the canonical `https://humanityinfrastructure.com` origin, no delivery receipt or provider request is made. Previews cannot send. **Jacob must approve the exact copy below before the first real send or production enablement.** Provisioning a key is not that approval.

Only a newly inserted signup ID can create a receipt in the additive `welcome_deliveries` table. Existing addresses, active duplicates and opted-out duplicates do not receive a welcome/backlog message. This also covers a new newsletter signup through explicit `letter_opt_in` in the private builder flow; merely providing contact details never opts in or sends mail.

The signup and receipt insert are one D1 batch. Delivery runs through Worker `waitUntil`; public status/body/headers remain uniform and contain no mail result, membership signal or unsubscribe token. Before sending, the job checks unsubscribe state. Contacts and the existing unsubscribe token go only to the approved transactional provider in the welcome email; no submitted interest/handle is included and no provider body/recipient/token is logged.

There are at most two eight-second provider attempts, with identical body and a stable per-signup idempotency key. Permanent errors are not retried. Private D1 receipts retain sent/failed/cancelled status and attempts, without copying the email/token. A worker interruption can leave pending/sending receipts; no cron, backlog replay or automatic later resend is installed. Inspect such failures privately before any manual recovery, especially beyond the provider's idempotency window.

Before an authorized release: obtain exact copy approval, final independent source GO and a coordinator slot; apply migration0003 inside the slot, bind the dedicated secret/explicit enable flag without printing values, upload/recheck, merge the reviewed head and deploy. Never merge built Worker changes early. Verify one approved test recipient, stored receipt, unsubscribe and synthetic-row cleanup. A code rollback leaves the additive table harmlessly present; remove the enable flag if disabling delivery. Preserve the scoped key in its established private location.

## Exact draft copy

From: Humanity Infrastructure <noreply@id.ideaflow.app>

Subject: Thanks for signing up for the interest list

```text
Thanks for signing up for the Humanity Infrastructure interest list.

We'll send you a short, occasional letter about tools for human flourishing and the people building them.

Follow Jacob on X:
https://x.com/jacobcole4000

Explore the Ideaflow apps:
https://index.ideaflow.app

Build your own app in the Ideaflow ecosystem.
Own your mind. Own your networks.

You received this because you signed up at humanityinfrastructure.com.
Unsubscribe any time: {{unsubscribe_url}}

--
Humanity Infrastructure
https://humanityinfrastructure.com
```

The private placeholder is replaced with the existing signup's one-click GET unsubscribe link on the canonical HI origin. The same URL is included in `List-Unsubscribe`; no unsupported RFC8058 POST header is advertised.
