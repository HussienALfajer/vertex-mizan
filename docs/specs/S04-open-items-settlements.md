# S04 — Open items and settlements

Status: Approved (owner, 2026-10-28) · Date: 2026-10-28 · Features: `docs/product/phase-1-scope.md` F06 · ADRs: 0003, 0005, 0006, 0007, 0008, 0011, 0012, 0013

## Summary
S03 posts entries, but refuses every manual line on a control account (`ACCOUNT_IS_CONTROL`), because nothing yet says which document a receivable or a client's ad funds belong to.

S04 builds the open items behind the control accounts:
- one item per invoice or document, and one running item per client for ad funds;
- the posting function's lines that open, settle and reverse them, with the realised exchange difference in each ledger;
- manual entries on control accounts, write-offs and offsets included;
- the receivables screens: ageing, each client's statement and each item's movements.

S04 also writes the settlement scenarios for Hub's payments and ad-wallet events. The owner approves their numbers now. They stay `Proposed` until S05 brings the event executor, and S05 implements the Hub rules on these mechanics (owner, 2026-10-28).

## In scope / out of scope
- In:
  - the open-item tables (items, movements, due dates, item balances) under forced RLS with the ADR 0005, 0008 and 0012 guards, and invariant 9;
  - the item kind of each control account (`document`, `running`; ADR 0013) and its template values;
  - the posting function's item lines:
    - opening a document item (a new measurement);
    - clearing it in proportion to what remains (ADR 0013);
    - moving a running item at its average with the zero-crossing split (ADR 0007);
    - reversals that move the same items, and the void difference entry of a running item;
  - manual lines on control accounts (owner, 2026-10-28):
    - opening manual document items with a reference and an optional due date;
    - settling any item, Hub's included, with a memo, marked as adjusted in Mizan;
    - write-offs and offsets;
    - due-date changes of manual items;
  - realised differences of entries with carried lines, write-offs included (ADR 0013);
  - the screens:
    - receivables ageing, by due date in six buckets (owner, 2026-10-28);
    - client funds, with debit balances shown as receivables;
    - the client statement, with an Excel export (owner, 2026-10-28: printing in S09);
    - an item's page;
    - the item picker on the entry screen;
  - the integrity check's new comparison: each control account equals the sum of its items, in every ledger;
  - S02's archiving check (`ACCOUNT_HAS_BALANCE`) also reads open items;
  - the scenario book:
    - the `open_item` and `item` fields of a manual line;
    - the `receivables/` scenarios that run with S04;
    - the Hub settlement scenarios, `Proposed` until S05.
- Out (later or never):
  - **S05:** Hub's events, the inbox and the posting rules that open and settle items:
    - `invoice.issued` lines opening receivables;
    - `payment.recorded` and `payment.voided`;
    - `ad_wallet.*` and `ad_spend.*`;
    - `invoice.due_date_changed`;
    - the holds `NEEDS_DECISION` and `OPEN_ITEM_HAS_SETTLEMENTS`.
  - **S06:** contract assets per milestone and per late retainer cycle, opened by `milestone.done` and late issues and cleared by milestone invoices. Their item kind and mechanics are S04's.
  - **S07:** month-end revaluation per item (ADR 0007), and its movements, which the carrying amount excludes.
  - **S10:** opening items on 2026-10-01 (source `opening`).
  - **S09:** printing the client statement and the ageing.
  - **Phase 2 or later:**
    - payables and suppliers, and an ad-platforms payable kept per platform: `211001` stays a plain account;
    - an expected-credit-loss allowance (IFRS 9.5.5): a write-off clears the item directly;
    - automatic allocation of a receipt across invoices: the accountant names each item;
    - dunning letters, client credit limits and interest on late payment.

## Access
New permission keys, appended to `PERMISSIONS` in `packages/contracts/src/access.ts`:

| Action | Surface | Who (permission) |
|---|---|---|
| Read open items, ageing, client funds, client statements, an item's movements | Web | Every role (`open_items.read`; viewers read reports, as `entries.read`) |
| Export the ageing or a client statement to Excel | Web | Every role (`open_items.read`); audited |
| Open, settle or adjust an item through a manual line | Web | As the entry: `drafts.manage` to prepare, `entries.post` or `entries.approve` to post (S03) |
| Change the due date of a manual item | Web | Owner, accountant (`open_items.manage`) |

A Hub item's due date changes only through Hub (`OPEN_ITEM_FROM_HUB`), so Mizan and Hub age it alike. Every company write carries `X-Mizan-Company` and is refused on an archived company (S01).

## Data
All tables are company tables: `company_id`, forced RLS with `company_isolation`, `unique (company_id, id)`, composite company foreign keys and UUIDv7 ids, registered in `registry.ts` (ADR 0003). Money columns are `bigint` minor units with a currency (ADR 0007).

### The chart
`chart_accounts` gains `item_kind` (`document` · `running`). It is set exactly when `is_control` is true (a check), and it joins S02 rule 5's lock after first use.

The templates set the kind:

| Template | Document accounts | Running accounts |
|---|---|---|
| `service-agency@1` | `112001` trade receivables, `113001` contract assets | `213001` client ad funds held |
| `general@1` | `112001` | — |

The migration sets the kind of every existing control account: `running` for code `213001` from the service-agency template, `document` for the others (synthetic companies only, before production). The account sheet in `/chart` asks for the kind when "control" is ticked.

### Open items

| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `open_items` | append-only | `id`, `company_id`, `account_id` → chart accounts, `kind` (`document` · `running`, copied from the account), `reference` (text 1–100: a manual document's reference, Hub's document number, or the client's code for a running item), `source` (`manual` · `hub_event` · `opening`), `hub_document` (jsonb, null: type, id and number; S05), `dimension_set_id` → dimension sets, `client_value_id` → dimension values, `currency`, `document_date` (date), `opened_by_entry_id` → entries, `created_at` | unique `(company_id, account_id, reference)` for document items; unique `(company_id, account_id, client_value_id, currency)` for running items; unique `(company_id, account_id, (hub_document->>'type'), (hub_document->>'id'))` where not null; check: `kind` equals the account's |
| `open_item_movements` | append-only | `id`, `company_id`, `item_id` → items, `line_id` → journal lines, `entry_id` → entries, `entry_date`, `kind` (`open` · `add` · `clear` · `difference`; S07 appends `revaluation`), `adjusted` (bool: a manual movement on an item whose source is not manual), `amount_minor`, `book_minor`, `parallel_minor` (null without a parallel ledger) | unique `(company_id, line_id)`; index `(company_id, item_id, entry_date)` |
| `open_item_due_dates` | append-only | `id`, `company_id`, `item_id` → items, `due_on` (date), `effective_on` (date: from when it applies), `set_by` (`opening` · `user` · `hub_event`), `user_id` (null), `reason` (text, null), `created_at` | index `(company_id, item_id, effective_on, created_at)`; document items only |
| `open_item_balances` | `ledger-state` | `id`, `company_id`, `item_id`, `open_minor`, `book_minor`, `parallel_minor` (null without a parallel ledger), `movement_count`, `last_movement_on` (date) | unique `(company_id, item_id)`; written only by the `AFTER INSERT` trigger on movements (a direct write at trigger depth 1 is refused, ADR 0012); `movement_count` only grows |

Guards, all `ENABLE ALWAYS` and pinned in `GUARDS`:
- `refuse_change()` on the three append-only tables (invariant 2).
- **Line and movement agree.** A deferred trigger on `journal_lines` and `open_item_movements` requires:
  - every line on a control account has exactly one movement and no other line has one;
  - the movement's account, dimension set and currency are the item's and the line's;
  - its three amounts equal the line's.
- **Invariant 9** (ADR 0008, ADR 0013), deferred on `open_item_balances`, checked once per item at commit:
  - a `document` item's open amount never has the opposite sign of its opening amount;
  - every item whose open transaction amount is zero is zero in the book and parallel amounts (S07 will exclude its revaluation movements, which reverse).
- **An opening with settlements.** A reversal that negates a document item's `open` movement is refused while the item has other movements not themselves reversed in that entry (`OPEN_ITEM_HAS_SETTLEMENTS`).

`entry_draft_lines` (S03) gains:
- `open_item_id` (null: the item a line moves);
- `new_item_reference` and `new_item_due_on` (null: the document item a line opens);
- a check that a line sets at most one of the two.

The draft keeps them while it is typed; the posting function checks them (rules 5–10).

**The integrity chain:** a line's item id joins the hashed value of `chainEntryValue()` only when the line has one. So every entry posted before S04 hashes the same, and the pinned hashes stay (S03 rule 18).

## States and rules

### Items
1. An item is **open** while its open transaction amount is not zero, and **settled** at zero. A reversal can return a settled document item to open; a running item is open or at zero and may cross it (ADR 0007).
2. A **document item** is opened by one line, its `open` movement, a new measurement at each ledger's policy rate on the entry date. Its sign is the line's: a debit item on a receivable. Every later movement moves it toward zero (`clear`) or is a reversal of an earlier one. A non-reversal line that adds to it is refused (`OPEN_ITEM_DIRECTION`); a second invoice is a second item.
3. A **running item** is per account, client and currency. It is created by the first line on that account for that client in that currency, and every later line moves it (ADR 0007):
   - a movement with the balance, or on a zero balance, is a new measurement (`add`);
   - a movement against the balance clears at the average carrying amount (`clear`);
   - a movement that crosses zero is split into two lines: the `clear` of the whole balance, then an `add` of the excess as a new measurement.

### Settlement (ADR 0013)
4. **In proportion to what remains.** A `clear` movement of *m* on an item with open amount *O* clears, in each ledger, `share(carrying, m, O)`, rounded half away from zero. The carrying amount is the item's book or parallel balance, without revaluations (S07). When *m* = *O*, it clears the whole carrying amount. It is computed by `clearOpenItem()` from the item's balance row, read `FOR UPDATE` in the posting transaction. Clearing more than is open is refused (`RELEASE_EXCEEDS_BALANCE`).

### Manual lines on control accounts (owner, 2026-10-28; ADR 0013)
5. Every manual line on a control account names its item; otherwise the line is refused (`OPEN_ITEM_REQUIRED`). This replaces S03 rule 16: `ACCOUNT_IS_CONTROL` is no longer raised, and stays in the registry, never reused. A line that names an item on a non-control account is refused (`ACCOUNT_NOT_CONTROL`).
6. **Opening a manual document item:** the line gives:
   - a reference, unique on that account (`OPEN_ITEM_REFERENCE_TAKEN`);
   - an optional due date, on or after the entry date (`VALIDATION_FAILED`).

   The account's required dimensions (the client) are given as on any line. The document date is the entry date, and with no due date the item ages from its document date (rule 14).
7. **Moving an existing item:** the line picks an open item, or a settled one by its reference (for a reversal only).
   - The line's account, currency and client must be the item's (`OPEN_ITEM_MISMATCH`).
   - The line takes the item's dimension set, and the accountant does not pick it.
   - The line's amount is the transaction amount cleared in the item's currency. A receipt in another currency gives that amount on the item line and the received amount on the cash line.
8. **Hub items** (source `hub_event`, later `opening`) may be moved by a manual line, for example a write-off or an offset, only with a line memo (`OPEN_ITEM_MEMO_REQUIRED`). The movement is stored `adjusted`, and the item, the client statement and the reconciliation (S08) mark it "معدّل في ميزان".
9. **Running items:** a manual line on a running account names only the client, from the line's client dimension. The item is found or created by rule 3, and the preview shows the split when the line crosses zero.
10. **Residuals:** an entry with any carried line posts each ledger's residual, rounding included, as a realised exchange difference to `fx_realised_gain` when it is a credit and to `fx_realised_loss` when it is a debit, in that ledger only (`realisedDifferenceLines()`, IAS 21.28; ADR 0013). This holds in one currency too (a USD receipt for a USD invoice). Only an entry in one currency whose lines are all new measurements keeps S03 rule 14's rounding line. ADR 0007's rule stands: the lines other than difference and rounding lines balance in their currency when they are all in one currency, so an overpayment is never a gain.
11. **Write-off** (owner, 2026-10-28): Cr the item, cleared at its carrying amount; Dr the expense account the accountant picks, a new measurement on the write-off date; the residual is a realised difference (rule 10). The expense therefore equals the item remeasured at the policy rate of that date (IAS 21.23, 21.28; IFRS 9.5.4.4).
12. **Offset against client funds:**
    - Dr the client's running item on `213001`, which clears at its average;
    - Cr the receivable item, at its carrying amount;
    - the residual is a realised difference.

    Using a client's money for an invoice is the accountant's decision, with the client's instruction kept as an attachment (an Arabic hint on the screen, not a check).

### Reversals
13. A reversal (S03 rule 9, and S05's for Hub voids) negates every line exactly, and each line on an item moves the same item back. So a settlement's reversal reopens the item at exactly what it had before, and later clearings start from there (rule 4).
    - **An opening reversed while the item has other movements:** refused (`OPEN_ITEM_HAS_SETTLEMENTS`). The settlements are reversed first.
    - **A running item's movement reversed** (ADR 0013): the exact reversal posts. In the same transaction, an exchange-difference entry brings the item to the carrying amount it would have if the void were a new movement under rule 3, and posts the residual to the realised gain or loss account. It has its own posting request (key `<the reversal's key>:difference`) and the reversal's source, so each entry stays one request. It is skipped when the difference is zero in both ledgers.

### Due dates and ageing (owner, 2026-10-28)
14. A document item's due date in force on a date *D* is the newest `open_item_due_dates` row with `effective_on` ≤ *D*. With none, the item is due on its document date.
15. A manual item's due date is changed by `open_items.manage` with a reason, effective on the day of the change. The new date may be any date, and the change is audited. A Hub item's due date comes only from Hub (`OPEN_ITEM_FROM_HUB`; S05 records `invoice.due_date_changed` effective on its accounting date).
16. **Ageing as of *D*:**
    - **Items:** every document item on the chosen asset control accounts (default: accounts on `bs.trade_receivables`) whose open amount at the end of *D* is not zero, from movements dated on or before *D*.
    - **Days past due:** *D* minus the due date in force on *D*.
    - **Buckets:** not yet due (≤ 0) · 1–30 · 31–60 · 61–90 · 91–180 · over 180.
    - **Amounts:** each item in its transaction currency, with its carrying amount at *D* in the selected ledger (book or parallel). Totals are given per bucket in the selected ledger's currency, and per transaction currency.
    - **Grouping:** by client, with the items under each; an unpaid credit can never appear (invariant 9).

### Client funds
17. The client-funds view lists each running item at *D*: the transaction balance, and the carrying amounts in both ledgers. A debit balance is shown as "مستحق من العميل", a receivable, never netted against other clients (IAS 1.32; S09 presents it).

## Accounting treatment
- **Opening a manual invoice:** Dr the receivable item / Cr revenue or the account the accountant picks, all new measurements at each ledger's policy rate on the entry date (ADR 0007, ADR 0012).
- **Receipt:** Dr cash, measured new in the receipt's currency, at the dealt rate when given (S03 rule 13); Cr the item, at its carrying amount in proportion to what remains (ADR 0013); the residual in each ledger to the realised gain or loss (IAS 21.28).
- **Write-off:** Dr the chosen expense, measured new; Cr the item at its carrying amount; the residual is realised (IAS 21.23, 21.28; IFRS 9.5.4.4).
- **Offset against client funds:** Dr the running item at its average; Cr the receivable at its carrying amount; the residual is realised.
- **Reversal:** the exact negation, which reopens the item; for a running item, plus the difference entry of rule 13.
- **Hub events** (S05 implements, these scenarios fix the numbers; phase 1 scope §6):
  - **`payment.recorded`:**
    - Dr the payment method's account in the payment's currency (book at the bulletin, parallel at Hub's `syp_per_usd`, which Vertex Media's policy accepts);
    - Cr the invoice's item by the amount applied in the invoice's currency, at its carrying amount;
    - the realised difference in each ledger.
    - A payment beyond the open amount is held `NEEDS_DECISION`; an accountant posts the excess to contract liabilities (IFRS 15.106) or another payable by hand.
  - **`payment.voided`:** the exact reversal, which reopens the item.
  - **`invoice.voided`:**
    - while payments on the invoice are not voided: held `OPEN_ITEM_HAS_SETTLEMENTS`, retried by itself once the payments' voids have posted (owner, 2026-10-28);
    - otherwise: the reversal of the issue entry, and of any release (S06).
  - **`ad_wallet.deposited`:** Dr the method's account, measured new / Cr the client's running item on `213001` by the USD amount, measured new; a deposit paid in SYP for a USD credit posts its residual as a realised difference (ADR 0007).
  - **`ad_wallet.refunded` and `ad_spend.recorded`:**
    - a refund debits the running item at its average and credits cash measured new;
    - a spend debits the running item at its average and credits `211001` ad platforms payable, which carries the same amounts;
    - a crossing splits (rule 3).
  - **`ad_wallet.entry_voided`:** the exact reversal and the difference entry (rule 13).
  - **`invoice.due_date_changed`:** posts nothing; it records the due date (rule 15).
- **Contract assets** (S06): document items on `113001`, one per milestone (or late cycle), opened by the revenue entry and cleared by the milestone invoice; monetary and revalued (ADR 0007).

**Example** (Vertex Media, `syp-usd`; bulletin 120.0000 SYP per USD on Tuesday 3 November 2026, 123.0000 on Thursday 19 November, 123.5000 on Wednesday 25 November; market 124.0000 on 25 November):

| Date | Account | Currency | Amount | Book (SYP) | Parallel (USD) |
|---|---|---|---|---|---|
| 11-03 | 112001 receivable, item M-1 (client C1), opened, due 12-03 | USD | 1,000.00 | 120,000.00 (× 120) | 1,000.00 |
| | 411001 service revenue | USD | −1,000.00 | −120,000.00 | −1,000.00 |
| 11-19 | 111004 USD bank | USD | 400.00 | 49,200.00 (× 123) | 400.00 |
| | 112001 item M-1, cleared 400 of 1,000 open | USD | −400.00 | −48,000.00 (400/1000 × 120,000) | −400.00 |
| | 421001 realised exchange gain | SYP | −1,200.00 | −1,200.00 | 0 |
| 11-25 | 111003 SYP bank | SYP | 74,400.00 | 74,400.00 | 600.00 (÷ 124 market) |
| | 112001 item M-1, cleared 600 of 600 open | USD | −600.00 | −72,000.00 (all that remains) | −600.00 |
| | 421001 realised exchange gain | SYP | −2,400.00 | −2,400.00 | 0 |

After 25 November, M-1 is zero in USD, SYP and the parallel USD. Had the 19 November receipt been voided after the second, the void would reopen 400.00 USD at exactly 48,000.00 SYP, and the next receipt of 400.00 would clear exactly that. These numbers are confirmed in `receivables/manual-settlement` before any code (`/posting-rule`).

## Currencies, rates and rounding
- New measurements (an opening, cash, an expense, an `add` on a running item, the excess of a crossing) convert per ledger at the policy rate in force on the entry date (S02 rule 16), or at a dealt rate for a market ledger that accepts it (S03 rule 13). A missing rate refuses the posting with `RATE_MISSING`.
- Carried movements (`clear` on either kind) take the item's carrying amount and never read a rate (ADR 0007):
  - a document item in proportion to what remains (ADR 0013);
  - a running item at its average;
  - each ledger separately; the last clearing clears everything left.
- Each ledger's residual in an entry with a carried line is a realised difference by sign (rule 10), one difference line per ledger, in that ledger only, on the gain or loss account in the ledger's currency (ADR 0007 "Difference lines"). The item itself takes no difference line, so its balance is always its carrying amount.
- The four shapes:
  - `syp`: no parallel amounts; a USD item's settlement posts a book difference only;
  - `syp-usd`: as in the example;
  - `usd-syp`: a USD item is in the book currency and its book difference is zero; the SYP parallel ledger posts the difference;
  - `third`: a TRY item through a cross in both ledgers, with a difference in each.

## Periods
- Movements are dated by their entry. The period guard (S03) refuses an entry, settlement or write-off dated in a closed period (`PERIOD_CLOSED`).
- A settlement may be back-dated into an open month already revalued; S07 marks that revaluation stale (ADR 0007).
- The ageing and the client statement as of a past date use only movements dated on or before it, and the due date in force on it (rule 14), so a past ageing can be reproduced.
- Checklist items S07 adds from this spec: the integrity comparison of items with their control accounts is clean for the period.

## API
All under `/api`, with `X-Mizan-Company`; lists are cursor-paged (S01 pattern). Schemas go in `packages/contracts/src/open-items.ts`; the manual line schema in `entries.ts` gains `openItemId` and `newItem: { reference, dueOn? }`.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/open-items` | `open_items.read` | `account`, `client`, `state` (`open` · `settled` · `all`), `text` (reference), `asOf`, cursor | items with reference, client, account, currency, document and due dates, open amount, carrying amounts in both ledgers, the `adjusted` mark | `VALIDATION_FAILED` |
| `GET /api/open-items/:id` | `open_items.read` | `asOf` | the item, its movements with their entries, its due-date history | `NOT_FOUND` |
| `PUT /api/open-items/:id/due-date` | `open_items.manage` | `{ dueOn, reason }` | the item | `OPEN_ITEM_FROM_HUB`, `VALIDATION_FAILED`, `NOT_FOUND` |
| `GET /api/receivables/ageing` | `open_items.read` | `asOf` (default today, Damascus), `ledger` (`book` · `parallel`), `accounts`, `client` | buckets per client with their items, totals per bucket in the ledger currency and per transaction currency | `VALIDATION_FAILED` |
| `GET /api/receivables/ageing/export` | `open_items.read` | as above | `.xlsx` | — |
| `GET /api/client-funds` | `open_items.read` | `asOf`, `ledger` | running items per client with balances in all three amounts, debit balances marked | — |
| `GET /api/clients/:valueId/statement` | `open_items.read` | `from`, `to`, `ledger`, `currency` | the opening balance per item currency, every movement in date then entry-number order with its entry, item, memo and running balance, the closing balance | `NOT_FOUND` |
| `GET /api/clients/:valueId/statement/export` | `open_items.read` | as above | `.xlsx` | — |
| `POST /api/drafts/:id/preview` · `/post` · `/approve` (S03) | as S03 | as S03 | as S03, with each item line's item, its open and carrying amounts before and after, the crossing split and the difference lines | S03's, plus the codes below |

New error codes, appended to the registry:

| Code | Status | When |
|---|---|---|
| `OPEN_ITEM_REQUIRED` | 422 | A line on a control account names no item (rule 5) |
| `ACCOUNT_NOT_CONTROL` | 422 | A line names an item on an account that is not a control account |
| `OPEN_ITEM_REFERENCE_TAKEN` | 409 | A new item's reference is already used on that account |
| `OPEN_ITEM_MISMATCH` | 422 | The line's account, currency or client is not the item's |
| `OPEN_ITEM_DIRECTION` | 422 | A line adds to a document item instead of clearing it |
| `OPEN_ITEM_HAS_SETTLEMENTS` | 409 | Reversing the opening of an item that still has other movements; for S05 also a hold reason |
| `OPEN_ITEM_MEMO_REQUIRED` | 422 | A manual movement on a Hub or opening item without a memo |
| `OPEN_ITEM_FROM_HUB` | 409 | A change Mizan leaves to Hub, such as a Hub item's due date |

`RELEASE_EXCEEDS_BALANCE` (422) serves a settlement beyond the open amount. `OPEN_ITEM_HAS_SETTLEMENTS` joins ADR 0008's hold reasons in S05, an enum value appended within `/v1` (ADR 0006). `/v1` is otherwise untouched in S04; S05 adds the optional `due_on` to `invoice.issued` (additive), which Hub must send (Q5).

Posting stays idempotent by the draft id (S03). Two receipts settling the same item at once serialise on the item's balance row: the head lock already serialises postings per company, and the row lock is taken after it.

## Jobs and events
- No job. No event is received or emitted in S04; S05's inbox posts Hub's events through the same item lines, and retries an invoice void held `OPEN_ITEM_HAS_SETTLEMENTS` when a `payment.voided` for that invoice posts.

## Screens
Design-system components only (ADR 0010). A missing general component goes to `packages/ui` first: `AgeingTable`, a bucket table with totals and drill-down, and `OpenItemPicker`, an `Alt+↓` lookup of a client's open items with open and carrying amounts.

| Route | Purpose and content | Actions | States | Roles |
|---|---|---|---|---|
| `/receivables` | Ageing as of a date: one row per client with the six buckets and a total in the selected ledger; a row expands to its items (reference, document and due dates, days past due, transaction amount, carrying amount); per-currency totals under the table; filters by account and client; the ledger switch | Open the client statement or an item; export Excel | No open items explained; loading rows | Every role |
| `/receivables/clients/:valueId` | The client statement: the client's items on every control account; movements in date order with entry number, item, memo, amount and running balance per item currency and in the selected ledger; opening and closing balances; "معدّل في ميزان" marks | Open an entry or an item; export Excel; new receipt (opens `/entries/new` with the client's open items ready to pick) | Empty range explained | Every role; "new receipt" for `drafts.manage` |
| `/open-items/:id` | One item: header (account, reference, client, currency, source with the Hub document, document and due dates), the open amount and carrying amounts in both ledgers, every movement with its entry, the due-date history | Change the due date (manual items, `open_items.manage`); open an entry | Settled items marked; a Hub item says its due date comes from Hub | Every role |
| `/client-funds` | Client ad funds: one row per client and currency with the transaction balance and both ledgers' carrying amounts; debit balances marked "مستحق من العميل" | Open the client statement | No running accounts: the screen is hidden | Every role |
| `/entries/new`, `/drafts/:id` (S03) | On a control account line, the item cell: "بند جديد" (reference, due date) or an existing item through `OpenItemPicker` (`Alt+↓`), showing what is open and its carrying amount. `=` on an item line takes its open amount. The preview shows each item before and after, the crossing split, the realised differences and the "adjusted" memo requirement. | As S03 | Refusals per line (`ErrorSummary`) | As S03 |
| `/chart` (S02) | The account sheet asks for the item kind when "control" is ticked | As S02 | Locked after first use | As S02 |

The command palette gains "receivables ageing", "client statement…" and "go to item…". Every screen is RTL and works from 360 px; on a phone, the ageing shows one card per client with its buckets stacked.

## Reports
- **Ageing:** the sum of every item's carrying amount at *D* on an account equals that account's balance at *D* in the same ledger, from the period balances and the lines of *D*'s month. A test checks it after any sequence of postings.
- **Client statement:** the movements equal the client's lines on the control accounts; opening plus movements equals closing.
- **Client funds:** the sum of running items equals `213001`'s balance in every ledger.
- **The integrity check** (S03 rule 19) gains two comparisons:
  - each control account's period balances against the sum of its items' movements, per currency and ledger;
  - each item's balance row against its movements.

  It reports any mismatch.

## Printing and legal books
None in S04. S09 prints the client statement and the ageing in Arabic with the SYP label "الليرة السورية الجديدة". The Excel exports use Arabic headings, amounts as numbers with their currency in a column, and dates as `YYYY-MM-DD`.

## Volume and performance
- **Vertex Media:** about 150 invoices and 200 payments a month, 50 ad-wallet movements; about 2,000 open items over a year. **The largest company served in phase 1:** about 2,000 invoices a month and 50,000 items over ten years.
- **Posting:** adds one balance-row lock per item line; a receipt settling 20 items posts in ≤ 300 ms.
- **The ageing** as of today reads `open_item_balances` for open items. As of a past date, it sums movements by `(company_id, item_id, entry_date)`. It takes ≤ 1 s for 10,000 open items; a client statement for a year takes ≤ 500 ms.
- **The integrity check's new comparison** adds ≤ 10 s for 100,000 movements.

## Migration and compatibility
- **`packages/db`, the schema module `open-items`:** the four tables, their grants, RLS, guards and registry entries, and `chart_accounts.item_kind` with its check and lock. The migration sets the kind of existing control accounts (Data). No posted data changes: no ledger line was ever on a control account, since S03 refused them.
- **The migration guard** gains the new append-only tables. The convention test pins the guards and the `ledger-state` rule for `open_item_balances`.
- **`packages/ledger`:**
  - `clearOpenItem()` takes the item's carrying amount and open amount (ADR 0013), and its properties are restated (ADR 0013 "Consequences");
  - `checkLineAgainstChart()` drops `ACCOUNT_IS_CONTROL` and checks the item rules (rules 5–9);
  - new `itemLines()`, which opens, clears, splits and refuses per rules 2–4;
  - `manualEntryLines()` posts residuals by rule 10;
  - `reverseLines()` keeps each line's item;
  - the running-item void difference (rule 13).

  The ADR 0007 examples that settle an item are checked again under the new rule: a value that changes needs the owner's approval in `/posting-rule`. Run `pnpm typecheck` at the root.
- **`packages/contracts`:** `open-items.ts`, the line fields in `entries.ts`, the permission keys, the error codes and the audit actions, appended; the template data gains `itemKind`.
- **`packages/scenarios`:**
  - the manual payload's line gains `open_item: { ref, due? }` (opens a document item) and `item: <ref>` (moves one: a manual reference or a Hub document number); a running account needs neither;
  - `open_items` expectations are read from the item balances;
  - the README documents both;
  - the `receivables/` manual scenarios become `Approved` when S04 brings the code; the Hub scenarios stay `Proposed` until S05.
- **`openapi.json`** gains the `/api` routes (additive); `/v1` is untouched.

## Arabic strings and number formats
- New namespace `ar.openItems`, with:
  - the kinds: بند مستند، رصيد جارٍ;
  - the states: مفتوح، مسدّد;
  - the movement kinds: فتح، إضافة، تسديد، فرق صرف;
  - the buckets: غير مستحق، 1–30 يومًا، 31–60، 61–90، 91–180، أكثر من 180;
  - the labels: معدّل في ميزان، مستحق من العميل، كشف حساب عميل، أعمار الذمم، أمانات العملاء، تاريخ الاستحقاق، أيام التأخير، شطب;
  - the new codes in `ar.errors`.
- Terms (glossary): بند مستند، تسوية، تسوية جزئية، أعمار الذمم، كشف حساب عميل، شطب دين، مقاصة مع الأمانات، تاريخ الاستحقاق، معدّل في ميزان، نوع البند.
- Dates `YYYY-MM-DD`, Latin digits; amounts through the Amount component only; days past due as plain integers.

## Audit
One `audit_entries` row per change, in the same transaction (S01 rule 23):
- **Postings** keep their one `entry.posted` row each, and its details list the items each line moved. A running-item void writes two `entry.posted` rows, one per entry: the runner counts one per posting.
- **Due dates:** `open_item.due_date_changed`, with the before and after values and the reason.
- **Exports:** `export.ageing` and `export.client_statement`, with their filters (S01 rule 24).

## Abuse and failure cases
- **Double submits and replays:** S03's idempotency by draft id; a second post returns the same entry and moves nothing.
- **Two settlements of one item at once:** posting serialises on the head (ADR 0008), and the item's balance row is read `FOR UPDATE` after it, so the second sees the first's result and is refused if it clears more than is open.
- **A settlement and a close race:** the head, then the period lock order (S03).
- **Silent divergence from Hub:** a manual movement on a Hub item needs a memo, is stored `adjusted` and is shown by the reconciliation (S08). A Hub item's due date never changes in Mizan.
- **Tampering by a runtime role:** the append-only grants, `refuse_change()`, the `ledger-state` guard on balances, `ENABLE ALWAYS`, and the integrity comparison of items with their accounts.
- **Cross-company access:** RLS on every table, and composite keys (movement → line, movement → item, item → account, item → dimension value, due date → item). Every endpoint is tested as a member of another company; the isolation property test covers the new tables.
- **An item picked from another client:** `OPEN_ITEM_MISMATCH`; the database's movement trigger checks the dimension set too.

## Edge cases
1. **A partial receipt, then a void of an earlier receipt, then the final receipt:** the item ends at zero in every ledger (ADR 0013); a property test covers any order of settlements and voids.
2. **A receipt in SYP for a USD item** (`syp-usd`): the item line in USD, the cash line in SYP; differences in both ledgers when the dealt or market rate differs from what the item carries.
3. **`syp`:** a USD item settled in USD posts a book difference only; an SYP item settled in SYP posts none.
4. **`usd-syp`:** a USD item, no book difference; the SYP parallel ledger posts it.
5. **`third`:** a TRY item settled in TRY; differences in both ledgers from the crosses.
6. **A receipt that exceeds the open amount:** `RELEASE_EXCEEDS_BALANCE`; the accountant splits it between the item and a liability line.
7. **A credit line on a receivable item** (a manual credit note): it clears the item; more than is open is refused.
8. **Two items in one receipt:** two item lines, each cleared separately; one realised difference line per ledger for the entry.
9. **A reversal of a manual invoice already partly paid:** `OPEN_ITEM_HAS_SETTLEMENTS`; reverse the receipts first.
10. **A reversal of a receipt:** the item reopens at its exact earlier carrying amount; the ageing shows it again.
11. **A running item that crosses zero in a manual offset:** split into `clear` and `add`; the preview shows both lines.
12. **A deposit voided after spend** (running): the exact reversal plus the difference entry, so a zero balance is zero in both ledgers.
13. **An item on an account archived later:** archiving is refused while any item is open (`ACCOUNT_HAS_BALANCE`). A settled item on an archived account still shows on statements.
14. **A blocked control account:** new lines are refused (S02); items stay readable and age.
15. **An archived client value:** a manual line refuses it (S02 rule 13), so its items are settled before archiving. Hub lines keep Hub's records.
16. **A due date before the document date:** refused at opening; a later change may set any date (an agreed extension or an earlier term).
17. **Ageing as of a date before an item's opening:** the item is absent; as of its due date: "not yet due" (0 days).
18. **A settlement back-dated before a later one:** allowed in an open period. Clearing follows posting order, not entry dates, so the amounts do not depend on the date; the statement orders by date.
19. **A leap day:** days past due count calendar days, 29 February included.
20. **A zero carrying amount in one ledger with an open transaction amount:** possible only through rounding on a tiny item. The last clearing clears zero in that ledger, and invariant 9 holds.

## Scenarios
Accounting rules this spec introduces, each written and approved through `/posting-rule` before its code:
- **`docs/scenarios/receivables/manual-settlement.md`** (runs with S04):
  - a manual invoice settled by two receipts, as in the example above, in `syp-usd`, `syp`, `usd-syp` and `third`;
  - a receipt with a dealt rate;
  - a void of the first receipt after the second, then the final receipt, ending at zero (ADR 0013);
  - an overpayment refused;
  - an opening reversed with settlements refused;
  - an offset against client funds that crosses zero.
- **`docs/scenarios/receivables/write-off.md`** (runs with S04): a USD item carried at bulletin 120 written off at 123 to an added expense account. The item clears at its carrying amount, the expense is measured at 123, and the 300.00 SYP per 100.00 USD is a realised difference; in `syp-usd` and `syp`.
- **`docs/scenarios/receivables/hub-payment.md`** (`Proposed` until S05):
  - `invoice.issued` with an extra-work line (revenue at issue, S05's rule) settled by `payment.recorded` in USD (ADR 0007's B1 example: 300.00 SYP gain) and in SYP with Hub's rate and applied amount;
  - partial payments and a `payment.voided`;
  - a payment beyond the open amount held `NEEDS_DECISION`;
  - an `invoice.voided` with a payment held `OPEN_ITEM_HAS_SETTLEMENTS`;
  - `invoice.due_date_changed` posting nothing.
- **`docs/scenarios/ad-funds/running-balance.md`** (`Proposed` until S05):
  - `ad_wallet.deposited` in USD and in SYP for a USD credit;
  - `ad_spend.recorded` at the average;
  - `ad_wallet.refunded`;
  - a spend crossing zero;
  - `ad_wallet.entry_voided` after spend, with its difference entry, in both directions (ADR 0007, ADR 0013).

## Open questions
- **For S09 (not blocking):** the statement-line catalogue has no line for impairment losses on receivables, which IAS 1.82(ba) presents separately. Recommendation: add `is.impairment_losses` when the templates are reviewed (Q3), with a write-off account under 54. Until then the write-off scenario adds its own account on `is.other_expenses`.
- **Q5 (`docs/open-questions.md`):** Hub must send `due_on` on `invoice.issued`, and the amount applied in the invoice's currency on `payment.recorded`. Hub's repository was not available in this session, so its fields were taken from ADR 0006 and are not confirmed; S05 confirms them with Hub.
- None blocks S04.

## Acceptance
- **The owner's end-to-end check** (a test company with Vertex Media's ledgers and the service-agency template). Manual entries may be dated only up to the end of the current month (S03 rule 6). Run it in or after December 2026 as written; earlier, shift every date into open months up to the current one and record the bulletins of those dates:
  1. **Rates:** in `/rates`, record the bulletins 120.0 (3 November), 123.0 (19 November) and 123.5 (25 November), and the market rate 124.0 for 25 November.
  2. **Open an invoice:** in `/entries/new`, dated 3 November, enter Dr 112001 for client C1, item cell "بند جديد" M-1, due 3 December, USD 1,000.00; Cr 411001 USD 1,000.00 (client C1, a service). Post it.
  3. **Ageing:** in `/receivables` as of 3 December, M-1 is "not yet due" at 120,000.00 SYP. As of 10 December, it is in 1–30.
  4. **First receipt:** dated 19 November, Dr 111004 USD 400.00, Cr 112001 item M-1 400.00. The preview shows the item cleared by 48,000.00 SYP and a 1,200.00 SYP realised gain in the book ledger only. Post it.
  5. **Final receipt:** dated 25 November, Dr 111003 SYP 74,400.00, Cr 112001 item M-1 USD 600.00. The preview clears 72,000.00 SYP and 600.00 USD and posts a 2,400.00 SYP gain. Post it. `/open-items/M-1` shows "مسدّد" and zero in all three amounts.
  6. **Void and reopen:** reverse the first receipt. M-1 reopens at 400.00 USD, 48,000.00 SYP, 400.00 USD. Settle it again with a 400.00 USD receipt: zero again.
  7. **Client statement:** open `/receivables/clients/C1`. Every movement is listed with its entry; export Excel.
  8. **Refusals:** try a receipt of 500.00 on a 400.00 item (refused with the open amount shown). Try to reverse the invoice of step 2 (refused: it has settlements).
  9. **Due date:** change M-1's due date with a reason. The audit log and the item's history show it.
- **Tests:**
  - API: success, 401, 403, another company and an idempotent replay per endpoint; a due-date change on a Hub item refused;
  - unit and property tests:
    - any sequence of openings, partial clearings and reversals keeps every item within its sign and zero in every ledger when its open amount is zero;
    - the items of a control account always equal its balance in every ledger;
    - a crossing splits exactly;
    - a running void plus its difference entry reaches the carrying amount rule 3 gives;
    - settlements never read a rate;
  - invariant tests as `mizan_app`:
    - update, delete and truncate on every new table;
    - a line on a control account without a movement, and a movement whose amounts differ from its line;
    - a document item that flips sign;
    - a zero item with a ledger amount;
    - a direct write to item balances;
    - an opening reversed with settlements;
  - the convention test: the new tables, kinds and pinned guards;
  - the scenario book: `receivables/manual-settlement` and `receivables/write-off` run; the Hub scenarios are listed as `Proposed`;
  - E2E with RTL screenshots, light and dark, at 360, 768 and 1280 px: an invoice and receipts by keyboard with the item picker, the ageing, the client statement, an item's page, the due-date change.
