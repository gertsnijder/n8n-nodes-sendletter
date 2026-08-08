# n8n-nodes-sendletter

Send a real letter — printed, folded, franked and handed to the post — from an
n8n workflow. Across Europe, including registered mail with proof of posting.

This is a community node for [n8n](https://n8n.io).

## Installation

In n8n: **Settings → Community Nodes → Install**, then enter
`n8n-nodes-sendletter`.

Self-hosted, from the command line:

```bash
npm install n8n-nodes-sendletter
```

## Credentials

Create an API key in the [account area](https://sendletter.eu/en/developers) and
add it as a **SendLetter API** credential.

A key beginning `sk_test_` runs the whole lifecycle — printed, posted, delivered
— with the trigger firing exactly as it will in production, while printing
nothing, posting nothing and charging nothing. Build the workflow with one of
those.

## Nodes

### SendLetter

| Resource | Operations |
| --- | --- |
| Letter | Send, Get, Get Many, Cancel, Download |
| Address | Validate |
| Pricing | Quote |

**Send** takes its content one of three ways: typed text that we lay out, a PDF
from a binary field on the item, or a PDF at a URL. Pick one — the API refuses
two rather than guessing, because the wrong document in a postbox cannot be
recalled.

Set an **Idempotency Key** on anything that might run twice. n8n retries a
failed node and a workflow can be replayed by hand; without a key that is a
second envelope through somebody's door. Use something from the data, such as
`{{$json.invoiceNumber}}`.

**Validate** answers rather than fails when an address is wrong: read `valid`
and `problems`. Put it in front of a send and you find the bad rows in a
spreadsheet before spending anything on them.

### SendLetter Trigger

Starts a workflow when a letter is submitted, printed, posted, delivered, failed
or refunded.

A real subscription, not polling: activating the workflow registers its webhook
URL, deactivating removes it. Every callback is verified against the signing
secret before the workflow runs, so an open URL cannot be used to tell your
workflow a letter was delivered when it was not — which matters, because
"delivered" is what closes a deadline in most of the workflows this exists for.

The trigger needs an https URL, so on a local install use a tunnel.

## A worked example

Dunning by post, which is the reason most people install this:

1. **Schedule Trigger** — first of the month
2. **Postgres / Google Sheets** — invoices more than 30 days overdue
3. **SendLetter** — Letter → Send, PDF from binary field, idempotency key
   `reminder-{{$json.invoiceId}}-{{$json.reminderCount}}`
4. **SendLetter Trigger** in a second workflow — on `letter.delivered`, write the
   date back to the invoice

Step 3's idempotency key is what makes it safe to re-run the whole month if
step 2 fails halfway.

## Errors

Refusals arrive as readable sentences rather than a status code. Two are worth
handling with an IF node:

- **insufficient_balance** — the prepaid wallet is short. The message carries a
  payment link.
- **rate_limited** — the message says how many seconds to wait.

Everything else is a permanent refusal: retrying a bad postcode produces the
same bad postcode.

## Licence

MIT. Not affiliated with n8n GmbH.
