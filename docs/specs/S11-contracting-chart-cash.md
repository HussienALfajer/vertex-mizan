# S11 — The contracting chart and cash boxes

Status: Approved (owner, 2026-11-14) · Date: 2026-11-14 · Features: `docs/product/phase-1-scope.md` "Added by ADR 0021" (N5, N1), F02, F03, F06, F13 · ADRs: 0003, 0005, 0007, 0008, 0011, 0012, 0013, 0016, 0021, 0022

## Summary
The contracting client's books need a chart made for a construction contractor and a way to move cash. S11 adds the template `contracting@1` (N5): cash boxes in SYP, USD and TRY, project costs by kind under the contract (project) dimension, clients' progress billings, advances and retentions, and the balances of suppliers, subcontractors, workers and craftsmen, each kept per counterparty through two new built-in dimension types (ADR 0022). It adds cash accounts and vouchers (N1): receipts, payments, transfers and currency exchanges between boxes, and cash counts, each a manual entry with its own voucher number, printed in Arabic; a box never goes below zero; and each cash account has its balance and statement.

It also records the client's currency answer (ADR 0021 "Open"), plans the move of the scenario book from its frozen service-agency chart to the new template, and leaves the application of advances (IFRIC 22) to S12.

## The client's currencies (ADR 0021 "Open", answered by the owner, 2026-11-14)
- **Book currency: USD.** The client's contracts, materials and wages are priced in US dollars, so USD is the functional currency (IAS 21.9–12). TRY and SYP are foreign currencies.
- **Book rate policy: `market`, accepting a transaction's dealt rate** (IAS 21.21–22; S03 rule 13). An exchange at a money changer is measured at the rate it was dealt at.
- **Parallel ledger: SYP at the Central Bank bulletin**, kept as a precaution because whether the client needs statutory books in SYP is not known, and a parallel ledger cannot be added after the first entry (S01 rule 11). Its policy is not to accept dealt rates. Q1 (the tax authority's acceptance) stays open and UNVERIFIED.
- **TRY in the parallel ledger** needs a TRY/SYP bulletin rate. The owner assumes a daily bulletin like USD's, so S02 rule 16 applies unchanged; that the Central Bank publishes TRY daily is UNVERIFIED and is checked before the client's first company (Q10).
- The client's company is therefore the `usd-syp` shape with TRY as a third currency: `admin:create-company --book-currency USD --parallel-currency SYP --template contracting`, with the book policy `market` (accepting dealt rates) and the parallel policy `bulletin`. These are company settings, not code: other companies keep choosing theirs.

## In scope / out of scope
- In:
  - **N5:** the template `contracting@1`, offered beside `general@3` at company creation and to an empty chart (S02 rule 1);
  - two new built-in dimension types, `supplier` (المورّد, suppliers and subcontractors) and `worker` (العامل, workers and craftsmen), created with every company;
  - a control account's **counterparty type** (`client` · `supplier` · `worker`), which generalises S04's open items from clients to any counterparty (ADR 0022);
  - **N1:** cash accounts (a postable account under `111` restricted to one currency, marked `box` or `bank`);
  - vouchers of four kinds: receipt (سند قبض), payment (سند صرف), transfer (سند تحويل, between two cash accounts, an exchange when their currencies differ) and cash count (محضر جرد), each a manual entry through S03's drafts, approval and posting, numbered per kind and fiscal year;
  - the non-negative rule for boxes;
  - the cash position and a cash account's statement, with Excel and PDF;
  - the printed voucher in Arabic with the amount in words;
  - the plan for moving the scenario book to `contracting@1` (its own PR).
- Out:
  - expenses by project, wages, materials with quantities (S12: N2, N3, N4);
  - the application of an advance against a billing or a supplier's invoice, measured at the advance's carrying amount (IFRIC 22.8–9): a posting rule of S12 (owner, 2026-11-14);
  - the recognition of contract revenue over time (IFRS 15.35–37) and progress billings beyond a manual invoice (open question Q20);
  - a cashier role limited to assigned boxes (phase 2, owner, 2026-11-14): vouchers are prepared and posted by the owner and the accountant;
  - cheques and notes (phase 2, Q6); bank reconciliation; petty-cash imprest;
  - a per-pair bulletin schedule (Q10), unless the TRY bulletin proves weekly;
  - depreciation runs (manual entries in phase 1).

## Access
No new permission key. Vouchers are drafts and entries (S03); the cash screens are reports.

| Action | Surface | Who (permission) |
|---|---|---|
| Read the cash position, a cash account's statement, a voucher, print or export them | Web | Every role (`reports.read`); prints and exports are audited |
| Prepare a voucher (receipt, payment, transfer, count) | Web | Owner, accountant (`drafts.manage`) |
| Post a voucher, or submit it when approval is on | Web | Owner, accountant (`entries.post`); an approver approves (`entries.approve`, S03 rule 8) |
| Cancel a voucher (reverse its entry) | Web | As a manual reversal (S03 rule 9) |
| Mark an account as a cash account (`box` or `bank`); set a control account's counterparty type | Web | Owner, accountant (`accounts.manage`, S02) |
| Apply `contracting@1` | Web, command | As S02 rule 1 (`accounts.manage`; `admin:create-company --template contracting`) |

Every company write carries `X-Mizan-Company` and is refused on an archived company (S01).

## Data
All tables are company tables: `company_id`, forced RLS with `company_isolation`, `unique (company_id, id)`, composite company foreign keys, UUIDv7 ids, registered in `registry.ts` (ADR 0003).

### The chart (`chart_accounts`, S02)
| Field | Type | Rule |
|---|---|---|
| `counterparty_type` | enum `counterparty_type` (`client` · `supplier` · `worker`), null | Set exactly when `is_control` is true; the account requires that dimension type (an `account_required_dimensions` row that cannot be archived while the account is a control account). Joins S02 check 5's lock after first use. The migration sets `client` on every existing control account. |
| `cash_kind` | enum `cash_kind` (`box` · `bank`), null | Only on a postable asset account under `111` with a currency restriction, `is_monetary` true, `is_control` false and statement line `bs.cash` (a check). Joins the lock after first use. |

`counterparty_type` values are never renamed; a new one is appended (ADR 0022).

### Dimensions (`dimension_types`, S02)
The built-in types gain `supplier` (المورّد) and `worker` (العامل): `builtin = true`, no parent type, codes never change. They are created with every new company and, by the migration, for every existing company that lacks them. S02's limit of 10 active types per company now leaves four custom types.

### Open items (`open_items`, S04)
- `client_value_id` is renamed `counterparty_value_id` (expand and contract within the migration: no production reader keeps the old name once the API ships with it).
- A check (a `BEFORE INSERT` trigger with `ENABLE ALWAYS`, pinned in `GUARDS`): the value's type is the account's `counterparty_type`.
- The running items' unique key becomes `(company_id, account_id, counterparty_value_id, currency)`. Nothing else in S04's tables changes.

### Vouchers
| Table | Kind | Fields (all `not null` unless marked) | Keys and checks |
|---|---|---|---|
| `voucher_sequences` | ledger (updated only by the posting function) | `company_id`, `kind` (enum `voucher_kind`: `receipt` · `payment` · `transfer` · `count`), `fiscal_year` (smallint), `last_number` (int) | primary key `(company_id, kind, fiscal_year)` |
| `cash_vouchers` | append-only | `id`, `company_id`, `kind`, `fiscal_year`, `number` (int ≥ 1), `voucher_date` (date), `entry_id` (null) → journal entries, `draft_id` → drafts, `cash_account_id` → chart accounts, `counter_cash_account_id` (null) → chart accounts, `party_name` (null, 1–200: who paid or was paid, as printed), `counted_minor` (null), `expected_minor` (null), `created_at` | unique `(company_id, kind, fiscal_year, number)`; unique `(company_id, entry_id)` where not null; unique `(company_id, draft_id)`; checks: `counter_cash_account_id` set exactly on `transfer`; `counted_minor` and `expected_minor` set exactly on `count`; `entry_id` null only on a `count` whose counted equals expected |

Drafts (S03) gain the voucher's header: `voucher_kind` (null), `cash_account_id` (null), `counter_cash_account_id` (null), `party_name` (null), `counted_minor` (null). A draft with a `voucher_kind` is a **voucher draft**; its lines are checked by rules 9–13 at submission and posting.

`cash_vouchers` and `voucher_sequences` are written only by the posting function `post()`, in the posting transaction (invariant 11), with `BEFORE UPDATE`, `DELETE` and `TRUNCATE` refusals on `cash_vouchers` (`refuse_update()`, `refuse_delete()`). A voucher is never changed: a cancelled voucher is one whose entry is reversed (S03 rule 9). Vouchers are not part of the entry hash (S03 rule 18): the entry's description and reference carry the voucher number.

## States and rules

### The contracting template (N5)
1. `contracting@1` is offered wherever `general@3` is (S02 rule 1; the S01 form; `admin:create-company --template contracting`). It holds the accounts of "Templates" below, sets the seven account roles, the counterparty types, the item kinds and the cash kinds, and requires the dimensions shown. A later change is a new version.
2. The template keeps `general@3`'s codes for the accounts both share (cash, receivables, roles, equity, office expenses), so a company and the scenario book read the same codes. Codes that differ in meaning from `general@3` are listed under "Templates".
3. Project costs (`511001`–`511006`), contract revenue (`411001`), clients' receivables, contract assets, advances, retentions and contract liabilities require the `contract` dimension (owner, 2026-11-14). Office and general expenses (`52`–`56`) do not. The counterparties' running balances do not require it, since one supplier or worker serves several projects; their lines may carry it.

### Counterparties (ADR 0022)
4. A control account names its counterparty type. A manual line on it names its counterparty from the line's dimension of that type (S04 rules 5–9, with "client" read as "the account's counterparty type"). A line whose value is of another type is refused (`OPEN_ITEM_MISMATCH`).
5. Setting `is_control` requires `counterparty_type` and its required dimension (`VALIDATION_FAILED` naming the field); a control account's counterparty dimension cannot be unrequired while it is a control account (`ACCOUNT_LOCKED` after first use, `VALIDATION_FAILED` before).
6. Statements and running balances (S04 rules 16–17, its API and screens) serve any counterparty value: the client statement becomes the **counterparty statement**, filtered by type; ageing (document items) and the running-balances view take a `counterpartyType` filter.

### Cash accounts (N1)
7. A **cash account** is a postable asset account with a `cash_kind` (rule of the Data section): a `box` (صندوق) or a `bank` account (حساب مصرفي). The accountant marks one in the account sheet; the template marks its five. Each is restricted to one currency (S02 rule 8 refuses a line in another currency).
8. **A box never goes below zero** (owner, 2026-11-14). The posting function refuses any entry, of any source, after which a box's balance in its currency would be negative at the end of the entry date or of any later date (`CASH_BOX_NEGATIVE`, naming the box, the first such date and the shortfall). It takes each box of the entry in a per-box lock after the head lock (ADR 0008 lock order), and reads the box's balance at the entry date from the period balances and the lines, then the running balance of every later dated line. A reversal that would make a box negative is refused too: the later payment is reversed first. Bank accounts are not checked (an overdraft is a borrowing, Q17).

### Vouchers (N1)
9. A voucher is prepared as a voucher draft and follows S03 rules 4–11: saved as typed, submitted for approval when approval is on, posted by `post()`, refused whole on any failure. At posting, in the same transaction, the function takes the next number of the voucher's kind and fiscal year (the fiscal year of the voucher date, as entry numbers, S03), writes `cash_vouchers`, and sets the entry's reference to the voucher's printed number when the accountant left it empty. A refusal consumes no number (gapless, as entry numbers).
10. **Receipt (سند قبض):** exactly one line on the voucher's cash account, a debit in its currency; one or more counter lines, none on that cash account, in any currency. A counter line on a control account names its counterparty (and item for a document item) as S04 rules 5–9 require, so a receipt settles a client's billing, an advance or any balance.
11. **Payment (سند صرف):** the mirror of rule 10: exactly one credit line on the cash account; debit counter lines in any currency.
12. **Transfer (سند تحويل):** exactly one credit line on the source cash account, one debit line on the destination cash account (not the same account, `CASH_ACCOUNT_INVALID`), and at most one debit fee line on an expense account in the source's currency (owner, 2026-11-14: a stated fee is its own expense line, by default `532002` bank and transfer charges). The source's credit equals the destination's debit plus the fee when both are in one currency. When the currencies differ it is a **currency exchange**: the dealt rate is derived from the two amounts, `destination amount / (source credit − fee)`, quoted in the company's orientation for that pair (S02 `RATE_ORIENTATION`), at 10 decimals rounded half away from zero, and offered to the ledgers as S03 rule 13 does. The preview shows it, and the accountant may overwrite it by typing the rate instead of an amount.
13. **Cash count (محضر جرد):** for a box and a date in an open period, the accountant enters the counted amount and a reason. At posting, the function computes the expected balance (the box's balance at the end of that date, under the box lock) and compares it with the expected amount the preview showed: if it changed, the count is refused (`CASH_COUNT_STALE`, with the new expected amount) and the accountant counts again. A shortage posts Dr `532007` cash shortages / Cr the box; an overage posts Dr the box / Cr `422002` cash overages; a match records the count with no entry. Every count gets its number. A count is not redone when an entry is later back-dated before it; the statement shows both.
14. **Cancelling a voucher** is reversing its entry (S03 rule 9). The voucher keeps its number and prints "ملغى" with the reversal's number. A count with no entry cannot be cancelled; a new count follows.
15. A voucher's lines, apart from the rules above, are ordinary manual lines: S02 rule 8 (accounts, currencies, dimensions), S03 rules 12–16 (measurement, dealt rates, rounding, exchange differences), S04 (items, carrying amounts, residuals) and S07 (closed periods).

### Statements
16. The **cash position** at a date lists every cash account, unarchived, with its balance in its currency and its carrying amounts in the book and parallel ledgers, grouped by currency, with totals per currency and per ledger.
17. A **cash account's statement** for a range: the opening balance at the day before `from`; each line on the account in entry date then entry number order, with the entry number, the voucher's kind and number, the description, the counter account (or "متعدد"), the counterparty and the contract, in, out and the running balance in the account's currency; the book and parallel amounts as optional columns; each count as a row with its expected and counted amounts; the closing balance. The closing balance equals the account's balance at `to`.

## Accounting treatment
S11 adds no new measurement rule: every voucher line is measured by the rules of S03, S04 and S07. What it fixes is which accounts each voucher posts to, and that a currency exchange is a purchase of one currency with another whose result is realised.

| Operation | Entry | Basis |
|---|---|---|
| Receipt settling a client's billing (a document item on `112001`) | Dr cash account (new measurement, at the dealt rate where a market ledger accepts it) / Cr `112001` item (carried, in proportion to what remains); each ledger's residual to `421001` or `541001` | IAS 21.28; ADR 0013; S04 rule 10 |
| Receipt of an advance from a client | Dr cash / Cr `212002` advances from clients (running, non-monetary, new measurement), with client and contract | IFRS 15.106; IAS 21.16, IFRIC 22.8 (fixed at the receipt's rate; not revalued) |
| Receipt in another currency than the item's (TRY for a USD billing) | As the first row: the cash line in TRY, the item line in USD | IAS 21.28; S03 rule 15 |
| Payment of a site cost | Dr the cost account (`511001`–`511006`, with contract; new measurement) / Cr cash | IAS 1.102 (by nature); S12 deepens it |
| Payment to a supplier, subcontractor or worker | Dr `211001`, `211002` or `211007` running item (cleared at its average carrying amount; the excess beyond a credit balance is a new measurement and an advance in the same account) / Cr cash; residuals realised | ADR 0007 (running balances); IAS 21.28 |
| Advance paid to a supplier or subcontractor | Dr `114002` (running, non-monetary, with supplier and contract) / Cr cash | IAS 21.16; IFRIC 22.8 |
| Transfer between two cash accounts in one currency | Dr destination / Cr source; a fee line Dr `532002` | No difference: both lines are new measurements of one amount at one rate |
| Currency exchange | Dr destination (its currency, new measurement) / Cr source (its currency, new measurement); a fee line Dr `532002`; each ledger's residual to `421001` or `541001` | IAS 21.28 (a realised difference on the exchange); S03 rules 13 and 15 |
| Cash shortage at a count | Dr `532007` / Cr box, new measurements | IAS 1.97–98 (other expenses); `is.other_expenses` |
| Cash overage at a count | Dr box / Cr `422002`, new measurements | `is.other_income` |
| Cancellation | The exact reversal of the voucher's entry, which reopens any item it cleared at its earlier carrying amount | S03 rule 9; S04 rule 13 |

**Revaluation** (S07, unchanged): the boxes and banks are monetary. In the client's company the SYP and TRY cash accounts are revalued in the USD book, the USD and TRY ones in the SYP parallel ledger, each at month end at that ledger's policy rate (IAS 21.23). Advances (`114002`, `212002`) are non-monetary and are never revalued (IAS 21.16); running items on monetary accounts (`211001`, `211002`, `211006`, `211007`) are revalued per counterparty and currency (S07).

**Example** (the client's shape: USD book at market accepting dealt rates, SYP parallel at the bulletin; Tuesday 1 to Thursday 3 December 2026; bulletin 120.0000 SYP per USD and 3.5000 SYP per TRY on each day, market 34.0000 TRY per USD on 3 December):

Exchange voucher, 1 December: 1,000.00 USD from the USD box, 34,500.00 TRY into the TRY box at a money changer (dealt 34.5000 TRY per USD), and a 10.00 USD fee paid from the USD box.

| Account | Currency | Amount | Book (USD) | Parallel (SYP) |
|---|---|---|---|---|
| 111005 TRY box | TRY | 34,500.00 | 1,000.00 (÷ 34.5 dealt) | 120,750.00 (× 3.5) |
| 532002 bank and transfer charges | USD | 10.00 | 10.00 | 1,200.00 (× 120) |
| 111002 USD box | USD | −1,010.00 | −1,010.00 | −121,200.00 (× 120) |
| 421001 realised exchange gain | SYP | −750.00 | 0 | −750.00 |

Payment voucher, 3 December: 6,800.00 TRY to supplier S1, whose running balance on `211001` is a credit of 10,200.00 TRY carried at 318.75 USD and 34,680.00 SYP (opened when the market was 32.0000 and the bulletin 3.4000).

| Account | Currency | Amount | Book (USD) | Parallel (SYP) |
|---|---|---|---|---|
| 211001 suppliers, S1 (cleared 6,800 of 10,200 at the average) | TRY | 6,800.00 | 212.50 (2/3 × 318.75) | 23,120.00 (2/3 × 34,680) |
| 111005 TRY box | TRY | −6,800.00 | −200.00 (÷ 34 market) | −23,800.00 (× 3.5) |
| 421001 realised exchange gain | USD | −12.50 | −12.50 | 0 |
| 541001 realised exchange loss | SYP | 680.00 | 0 | 680.00 |

These numbers are confirmed in `cash/transfer-and-exchange` and `cash/receipt-and-payment` before any code (`/posting-rule`).

## Currencies, rates and rounding
- Every voucher line is a new measurement (S03 rule 12) except a line that clears an item, which is carried (S04). New measurements convert per ledger at the policy rate in force on the voucher date (S02 rule 16), or at a dealt rate for the book ledger, the only one that accepts it, and only for the pair it is given for (S03 rule 13).
- A currency exchange between two currencies that are both foreign to the book (TRY to SYP in the client's company) has no dealt rate the book can use: both lines convert at the market rate to USD, and the residual is realised. The parallel ledger converts at the bulletin in every case.
- The derived dealt rate of rule 12 is rounded once to 10 decimals; the book amount it gives may differ from the other side by at most half a minor unit, which the residual takes as a realised difference (S03 rule 15), never as a rounding line, since the entry has two currencies.
- A transfer in one currency and a count are one-currency entries: any residual is conversion rounding (S03 rule 14), which cannot arise when the lines carry equal amounts.
- Each ledger's residual is one difference line in that ledger only (ADR 0007 "Difference lines"). No allocation is introduced.
- The four shapes: `usd-syp` with TRY is the client's and the scenarios' main shape; the scenarios also run an exchange in `syp` (one ledger) and in `syp-usd`, to show the residual moving between ledgers with the book currency.

## Periods
- A voucher's date follows S03 rule 6; a closed period refuses it (`PERIOD_CLOSED`). A count's date is in an open period.
- Voucher drafts are drafts: the close checklist's "no drafts or unapproved entries" item (S07) counts them.
- A back-dated voucher is checked against the box at its date and every later date (rule 8), so a back-dated payment cannot make an already-posted later balance negative.
- Voucher numbers restart each fiscal year by voucher date, as entry numbers do; a voucher dated 31 December posted on 2 January takes the earlier year's next number.

## API
All under `/api`, with `X-Mizan-Company`; lists are cursor-paged (S01 pattern). Schemas go in `packages/contracts/src/cash.ts` (new) and the existing `chart.ts`, `dimensions.ts`, `open-items.ts` and `entries.ts`.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/chart/templates` (S02) | `accounts.read` | — | now lists `general@3` and `contracting@1` | as S02 |
| `PUT /api/chart/accounts/:id` (S02) | `accounts.manage` | gains `counterpartyType`, `cashKind` | the account | S02's, `CASH_ACCOUNT_INVALID` |
| `POST /api/drafts` · `PUT /api/drafts/:id` (S03) | `drafts.manage` | gains `voucher: { kind, cashAccountId, counterCashAccountId?, partyName?, countedMinor? }` | the draft, with the voucher header | S03's, `CASH_ACCOUNT_INVALID` |
| `POST /api/drafts/:id/preview` · `/submit` · `/post` · `/approve` (S03) | as S03 | as S03 | as S03, plus the voucher's kind and, after posting, its number; for a transfer the derived dealt rate; for a count the expected amount and the difference | S03's and S04's, `CASH_BOX_NEGATIVE`, `CASH_COUNT_STALE`, `CASH_ACCOUNT_INVALID` |
| `GET /api/cash/accounts` | `reports.read` | `asOf` | cash accounts with kind, currency, balance and both carrying amounts; totals per currency and ledger | — |
| `GET /api/cash/accounts/:id/statement` | `reports.read` | `from`, `to`, `ledgers` | rule 17 | `NOT_FOUND`, `VALIDATION_FAILED` |
| `GET /api/cash/accounts/:id/statement/export` | `reports.read` | as above, `format` (`xlsx` · `pdf`) | the file | as above |
| `GET /api/vouchers` | `reports.read` | `kind`, `cashAccount`, `from`, `to`, `state` (`posted` · `cancelled`), cursor | vouchers with number, date, amount, party, entry and state | — |
| `GET /api/vouchers/:id` · `/pdf` | `reports.read` | — | the voucher with its entry · the printed voucher | `NOT_FOUND` |
| `GET /api/open-items`, ageing, running balances, statements (S04) | `open_items.read` | gain `counterpartyType`; `client` becomes `counterparty`; `GET /api/client-funds` becomes `GET /api/running-balances`, `GET /api/clients/:valueId/statement` becomes `GET /api/counterparties/:valueId/statement` (the web app is the API's only client, ADR 0021) | as S04 | as S04 |

New error codes, appended to the registry:

| Code | Status | When |
|---|---|---|
| `CASH_BOX_NEGATIVE` | 409 | An entry would take a box below zero at its date or a later one (rule 8) |
| `CASH_COUNT_STALE` | 409 | The box's expected balance changed between the count's preview and its posting (rule 13) |
| `CASH_ACCOUNT_INVALID` | 422 | A voucher's cash account is not a cash account, a transfer's two accounts are the same, a voucher's lines break rules 10–13, or a cash kind is set on an account that cannot carry it |

Posting stays idempotent by the draft id (S03); a voucher is written once per draft (`unique (company_id, draft_id)`).

## Jobs and events
- No job. No event is received or emitted. The voucher PDF is rendered by the worker's existing PDF printing (S09), on request.

## Screens
Design-system components only (ADR 0010). Missing general components go to `packages/ui` first, built for accounting work and tested: `VoucherHeader` (kind, number, date, cash account with its balance, party), and `CashAccountPicker` (cash accounts by currency with their balances, `Alt+↓`).

| Route | Purpose and content | Actions | States | Roles |
|---|---|---|---|---|
| `/cash` | The cash position at a date (rule 16): one card per cash account, grouped by currency, with its balance through `Amount` and both carrying amounts | New receipt, payment, transfer or count from a card or the toolbar; open a statement; export Excel or PDF | Empty: "لا توجد حسابات نقدية" with a link to the chart; loading skeleton; a box at zero marked | Every role reads; owner and accountant act |
| `/cash/:accountId` | The statement (rule 17) for a range, with the counts | Range, ledger columns, export Excel or PDF; each row drills to its entry or voucher | As above | As above |
| `/cash/vouchers` | Vouchers by kind, date, cash account and state | Open, print, cancel (reverse) | Empty, loading | As above |
| `/cash/vouchers/new/:kind`, `/drafts/:id` (S03) | The voucher form: the header (`VoucherHeader`), then the counter lines in S03's fast line editor (S04's item cell on control accounts). A transfer shows source, destination, both amounts, the derived rate and the fee. A count shows the expected balance and the difference. The preview shows every line in both ledgers and the residuals before posting | Save, submit or post, discard, print after posting | A refusal names the line, the box and the date; a voucher number appears only after posting | Owner and accountant prepare and post; approvers approve |
| `/chart` (S02) | The account sheet gains the counterparty type (when "control" is ticked) and the cash kind (on an eligible account) | As S02 | Locked after first use | As S02 |
| `/receivables/clients/:valueId` (S04) | Becomes `/counterparties/:valueId` for any counterparty, the old route redirecting | As S04 | As S04 | As S04 |

The command palette gains "سند قبض"، "سند صرف"، "سند تحويل"، "جرد صندوق" and "كشف صندوق…". Every screen is RTL and works from 360 px; on a phone the voucher's lines stack as cards.

## Reports
- **Cash position:** each cash account's balance equals its trial-balance balance in every ledger at the date (read from the period balances and the lines of the date's month).
- **Cash account statement:** opening plus in minus out equals closing, which equals the account's balance at `to`; a test checks it after any sequence of postings, reversals and back-dated vouchers.
- **Voucher register:** every posted voucher has its entry, and every entry with a voucher has one voucher; numbers per kind and fiscal year are gapless. The integrity check (S03 rule 19) adds both comparisons.
- S09's account statement shows a voucher column; its trial balance, income statement and balance sheet read the new accounts through their statement lines, with no change.

## Printing and legal books
- **The voucher** (A5, portrait, Arabic, RTL), from the worker's PDF printing: the company's name, the voucher's kind and number (`2026/15`), its date, the cash account, the amount in figures through the money module and **in words** ("فقط ألف وخمسمئة دولار أمريكي لا غير", owner, 2026-11-14), the party ("استلمنا من" or "صرفنا إلى"), the description, each counter line with its account, counterparty, contract and amount, the entry number, the preparer and the approver, and signature lines (المستلم، أمين الصندوق، المحاسب، المدير). A transfer shows both accounts, both amounts, the dealt rate and the fee; a count shows the expected and counted amounts and the reason. A cancelled voucher prints "ملغى" and the reversal's number.
- **Amounts in words:** a general function `amountInWords(minor, currency)` in `packages/i18n`, Arabic, with the currency's unit and sub-unit names and their grammatical agreement (دولار أمريكي / سنت, ليرة سورية جديدة / قرش, ليرة تركية / قرش), tested on a table of amounts (0, 1, 2, 3–10, 11–99, 100–999, thousands, millions, with and without a fraction).
- SYP is labelled "الليرة السورية الجديدة" in figures and in words. Digits are Latin.
- The cash account statement prints as S09's statements do, with page numbers.

## Volume and performance
- The contractor: up to 5 cash accounts, 300 vouchers and 20 counts a month a company; 100 counterparties.
- The box check (rule 8) reads one period-balance row and the box's lines from the entry date to the latest dated line, at most a few hundred, by the index `(company_id, account_id, entry_date)` on journal lines (S03). The posting stays under S03's target.
- The cash position reads period balances plus one month's lines; the statement reads the account's lines in the range. Both answer under 1 s for 10,000 lines.

## Migration and compatibility
- **`packages/contracts`:** `CHART_TEMPLATE_IDS` gains `contracting`; `chart-templates.ts` gains `contracting@1`; `BUILTIN_DIMENSION_TYPES` gains `supplier` and `worker`; the account schemas gain `counterpartyType` and `cashKind`; `open-items.ts` renames `client` to `counterparty` and gains `counterpartyType`; `cash.ts` (vouchers, the cash position, the statement); the error codes appended.
- **`packages/db` (`/db-migration`):** the two enums and columns on `chart_accounts` with their checks and the lock; the rename of `open_items.client_value_id` and the counterparty-type guard; the new built-in types for existing companies; `voucher_sequences` and `cash_vouchers` with grants, RLS, guards and registry entries; the drafts' voucher columns; `post()` gains the voucher numbering and rule 8. Existing control accounts get `counterparty_type = client`; existing data needs nothing else. No guard is weakened.
- **`packages/ledger`:** the voucher shape checks (rules 10–13) and the derived dealt rate are pure functions with property tests; the box check's arithmetic (the minimum of a running balance from a date) too.
- **`apps/api`, `apps/web`:** the endpoints and screens above; the S04 routes renamed with redirects.
- **`admin:create-company`:** `--template contracting`.
- **The scenario book:** the runner accepts `template: contracting`; the move below is its own PR.

### Moving the scenario book to `contracting@1` (owner, 2026-11-14: same codes and a mapping table, no change of numbers)
The 13 files that name `template: service-agency` switch to `template: contracting`. No expected amount changes: the template keeps the codes the cases use for cash, receivables, roles and equity, and a case needing an account the template lacks creates it in its own setup, with the agency's flags, under the matching header. The owner approves the mapping and each moved file in the move PR; then `packages/scenarios/src/agency-chart.ts` is deleted.

| Agency account used | Uses | In the move |
|---|---|---|
| `111001`–`111004`, `311001`, `312001`, `312002`, `313001`, `421001`, `421002`, `422001`, `531001`–`531006`, `532002`, `532005`, `532006`, `541001`–`541003`, `551001`, `561001`, `214001`, `211003`, `121003` | most | Same code and flags; names may differ |
| `121001` computers and camera equipment | 5 | `121001` construction machinery and equipment: same flags |
| `112001` trade receivables (client) | 316 | Same code; `contracting@1` also requires `contract`, so each case adds a contract value to those lines |
| `113001` contract assets (client, contract) | 15 | Same code and flags |
| `212001` contract liabilities (client, contract; non-monetary, not control) | 11 | Same code and flags |
| `411001` service revenue (client, service) | 115 | Same code; requires `client` and `contract` instead of `service`, so each case adds a contract value |
| `511001` direct project costs (client, contract, department) | 3 | `511001` materials (contract): the lines keep their dimensions |
| `521001` salaries (department) | 10 | Same code; no required dimension (the lines keep theirs) |
| `111006` USD e-wallet | 14 | Created by the case as `111006`, a USD bank-like cash account without a cash kind |
| `213001` client ad funds (running, USD, client) | 29 | Created by the case under a header `213` with the agency's flags and `counterparty_type = client` |
| `211001` ad platforms payable (client) | 1 | Created by the case as `211091` with the agency's flags (`211001` is suppliers in `contracting@1`) |
| `211002` project expenses awaiting payment source | 5 | Created by the case as `211092` with the agency's flags (`211002` is subcontractors) |
| `111007` TRY cash, `532009` | 77, 49 | Already created by the cases; unchanged |

The move is mechanical: an expected amount that changes means the mapping is wrong, and the move PR stops there for the owner.

## Arabic strings and number formats
- New i18n namespace `cash` (the screens, the voucher kinds: سند قبض، سند صرف، سند تحويل، محضر جرد; ملغى; عجز; زيادة; الرصيد المتوقع; المبلغ المعدود; سعر الصرف المنفّذ; العمولة), and keys in `chart` (نوع الطرف: عميل، مورّد، عامل; نوع الحساب النقدي: صندوق، حساب مصرفي) and `dimensions` (المورّد، العامل).
- The template's Arabic and English names are in "Templates".
- Voucher numbers print as `<year>/<number>`; dates `YYYY-MM-DD`; amounts through the money module; Latin digits.
- Glossary rows: cash account, box, voucher (now phase 1), receipt voucher, payment voucher, transfer voucher, currency exchange, cash count, cash shortage and overage, counterparty, counterparty type, supplier, worker, subcontractor, retention, progress billing, advance from a client.

## Audit
In the same transaction (S01 rule 23): `account.updated` with before and after of `counterparty_type` and `cash_kind`; `chart.template_applied` for `contracting@1`; `dimension_type.created` for the new built-in types, by the migration (actor `system`); a voucher's posting, submission, approval and reversal as S03's entry actions, with the voucher's kind and number; `cash_count.recorded` for a count without an entry; `export.cash_statement`, `export.cash_position` and `export.voucher` for each export or print.

## Abuse and failure cases
- **Double submit or replay:** posting is idempotent by the draft; one voucher per draft (unique key).
- **Two payments from one box at once:** both take the box lock after the head lock; the second sees the first's line and is refused if it would go negative.
- **A back-dated payment hiding a shortfall:** rule 8 checks every later date.
- **A count posted on a stale expected balance:** `CASH_COUNT_STALE`.
- **A gap in voucher numbers:** numbers are taken inside the posting transaction under the sequence row's lock; the integrity check reports any gap.
- **Editing a posted voucher:** refused by the table guards; a cancellation is a reversal.
- **Cross-company access:** RLS on the new tables, composite foreign keys (the voucher's entry, draft and accounts), every endpoint tested as another company's member; the isolation property test covers the new tables.
- **A stolen session:** vouchers need `entries.post` like any entry; approval, when on, needs a second person (S03 rule 8).
- **Race with a close:** the period lock of S07 serialises a voucher's posting with the close; a voucher dated in a period closed meanwhile is refused.
- **A box turned into a bank to escape rule 8:** the cash kind is locked after first use.

## Edge cases
1. A receipt or payment of zero: refused (`VALIDATION_FAILED`, S03 edge case 3).
2. A payment that takes a box exactly to zero: allowed.
3. A payment back-dated to a day when the box held enough, but a later payment then lacks cover: refused, naming the later date.
4. The reversal of a receipt whose cash was spent since: `CASH_BOX_NEGATIVE`; reverse the payment first.
5. A transfer from a box to itself: `CASH_ACCOUNT_INVALID`.
6. An exchange between two foreign currencies (TRY to SYP in the client's company): both lines at market in the book, realised residual (Currencies section).
7. An exchange in `syp` (one ledger): one residual, in the book only.
8. An exchange into the book currency (TRY to USD in the client's company): the USD side is exact in the book; the dealt rate gives the TRY side's book amount, so the book residual is at most half a cent; the parallel residual is the bulletin's.
9. A dealt rate typed instead of the destination amount: the amount is computed from it and rounded half away from zero; the stored rate is the typed one.
10. A missing bulletin for TRY on a working day: `RATE_MISSING` naming TRY/SYP; the draft stays (S02 rule 16; Q10).
11. A payment to a worker beyond the worker's credit balance: the running item crosses zero; the excess is an advance in the same account (S04 rule 3).
12. A receipt settling two billings and an advance at once: one item line each; one difference line per ledger (S04 edge case 8).
13. A count dated before a back-dated voucher posted later: the count stays; the statement shows the count's expected amount and the later line.
14. A count with a difference on a day with an unposted voucher draft: the draft does not count; the preview says so.
15. A voucher dated 31 December posted on 2 January: the earlier year's number, while December is open.
16. An archived cash account: refused on new vouchers (S02 rule 6); its statement stays readable.
17. A cash account blocked: refused (S02 rule 5).
18. A supplier value archived: refused on new lines (S02 rule 13), so its running balance is settled first.
19. A line on `211001` carrying a client value instead of a supplier: `OPEN_ITEM_MISMATCH` (rule 4).
20. Month-end revaluation of a box with a zero transaction balance but non-zero carrying amounts: S07 revalues it to zero carrying amounts, as for any monetary account.

## Templates

### Contracting (`contracting@1`)
Dimension types: the six built-in types. Columns and flags as S02's tables: `M` monetary, `Ctl doc` or `Ctl run` a control account of document or running items with its counterparty type, `Box` or `Bank` a cash account, a currency a restriction. Accounts not listed under a header are not in the template; codes shared with `general@3` keep their meaning except `121001`, `121005`–`121008`, `211001`, `211002`, `211006`, `211007`, `212002`, `411001`, `422002`, `511001`–`511006`, `532004`, `532007`, `533004` and `533005`.

| Code | Arabic | English | Kind | Bal | Flags | Required | Line | Role |
|---|---|---|---|---|---|---|---|---|
| 1 | الأصول | Assets | H | D | | | | |
| 11 | الأصول المتداولة | Current assets | H | D | | | | |
| 111 | النقد وما يعادله | Cash and cash equivalents | H | D | | | | |
| 111001 | الصندوق — ليرة سورية | Cash on hand — SYP | P | D | M, SYP, Box | | `bs.cash` | |
| 111002 | الصندوق — دولار أمريكي | Cash on hand — USD | P | D | M, USD, Box | | `bs.cash` | |
| 111003 | الحساب المصرفي — ليرة سورية | Bank account — SYP | P | D | M, SYP, Bank | | `bs.cash` | |
| 111004 | الحساب المصرفي — دولار أمريكي | Bank account — USD | P | D | M, USD, Bank | | `bs.cash` | |
| 111005 | الصندوق — ليرة تركية | Cash on hand — TRY | P | D | M, TRY, Box | | `bs.cash` | |
| 112 | الذمم المدينة | Receivables | H | D | | | | |
| 112001 | ذمم العملاء (المستخلصات) | Trade receivables (progress billings) | P | D | M, Ctl doc client | client, contract | `bs.trade_receivables` | |
| 112002 | ذمم مدينة أخرى | Other receivables | P | D | M | | `bs.trade_receivables` | |
| 112003 | سلف الموظفين | Employee advances | P | D | M | | `bs.trade_receivables` | |
| 112009 | مخصص الخسائر الائتمانية المتوقعة | Allowance for expected credit losses | P | C | M | client | `bs.trade_receivables` | |
| 113 | أصول العقود | Contract assets | H | D | | | | |
| 113001 | أصول العقود (أعمال منفذة غير مفوترة) | Contract assets (work done, not billed) | P | D | M, Ctl doc client | client, contract | `bs.contract_assets` | |
| 113002 | محتجزات لدى العملاء | Retentions receivable from clients | P | D | M, Ctl doc client | client, contract | `bs.contract_assets` | |
| 114 | أصول متداولة أخرى | Other current assets | H | D | | | | |
| 114001 | مصاريف مدفوعة مقدمًا | Prepaid expenses | P | D | | | `bs.other_current_assets` | |
| 114002 | دفعات مقدمة للموردين ومقاولي الباطن | Advances to suppliers and subcontractors | P | D | Ctl run supplier | supplier, contract | `bs.other_current_assets` | |
| 114003 | تأمينات مستردة | Refundable deposits | P | D | M | | `bs.other_current_assets` | |
| 12 | الأصول غير المتداولة | Non-current assets | H | D | | | | |
| 121 | الممتلكات والمعدات | Property and equipment | H | D | | | | |
| 121001 | الآليات والمعدات الإنشائية | Construction machinery and equipment | P | D | | | `bs.ppe` | |
| 121002 | الأثاث والمفروشات | Furniture and fittings | P | D | | | `bs.ppe` | |
| 121003 | مجمع استهلاك الآليات والمعدات | Accumulated depreciation — machinery and equipment | P | C | | | `bs.ppe` | |
| 121004 | مجمع استهلاك الأثاث والمفروشات | Accumulated depreciation — furniture | P | C | | | `bs.ppe` | |
| 121005 | السيارات ووسائط النقل | Vehicles | P | D | | | `bs.ppe` | |
| 121006 | مجمع استهلاك السيارات ووسائط النقل | Accumulated depreciation — vehicles | P | C | | | `bs.ppe` | |
| 121007 | العدد والسقالات والقوالب | Tools, scaffolding and formwork | P | D | | | `bs.ppe` | |
| 121008 | مجمع استهلاك العدد والسقالات والقوالب | Accumulated depreciation — tools, scaffolding and formwork | P | C | | | `bs.ppe` | |
| 122 | الأصول غير الملموسة | Intangible assets | H | D | | | | |
| 122001 | البرمجيات والمواقع الإلكترونية | Software and websites | P | D | | | `bs.intangible_assets` | |
| 122002 | مجمع الإطفاء | Accumulated amortisation | P | C | | | `bs.intangible_assets` | |
| 2 | الخصوم | Liabilities | H | C | | | | |
| 21 | الخصوم المتداولة | Current liabilities | H | C | | | | |
| 211 | الذمم الدائنة | Payables | H | C | | | | |
| 211001 | ذمم الموردين | Trade payables — suppliers | P | C | M, Ctl run supplier | supplier | `bs.trade_payables` | |
| 211002 | ذمم مقاولي الباطن | Payables — subcontractors | P | C | M, Ctl run supplier | supplier | `bs.trade_payables` | |
| 211003 | ذمم دائنة أخرى | Other payables | P | C | M | | `bs.trade_payables` | |
| 211004 | اشتراكات التأمينات الاجتماعية المستحقة | Social insurance contributions payable | P | C | M | | `bs.trade_payables` | |
| 211005 | مبالغ مستردة مستحقة للعملاء | Refund liabilities to clients | P | C | M | client | `bs.trade_payables` | |
| 211006 | محتجزات مقاولي الباطن | Retentions payable to subcontractors | P | C | M, Ctl run supplier | supplier, contract | `bs.trade_payables` | |
| 211007 | ذمم العمال والحرفيين | Workers' and craftsmen's balances | P | C | M, Ctl run worker | worker | `bs.trade_payables` | |
| 212 | التزامات العقود | Contract liabilities | H | C | | | | |
| 212001 | التزامات العقود (فواتير تتجاوز الأعمال المنفذة) | Contract liabilities (billings in excess of work done) | P | C | | client, contract | `bs.contract_liabilities` | |
| 212002 | دفعات مقدمة من العملاء | Advances from clients | P | C | Ctl run client | client, contract | `bs.contract_liabilities` | |
| 214 | الضرائب والرسوم المستحقة | Taxes and fees payable | H | C | | | | |
| 214001 | ضريبة الدخل المستحقة | Income tax payable | P | C | M | | `bs.tax_liabilities` | |
| 214002 | رسم الإنفاق الاستهلاكي المستحق | Consumption expenditure fee payable | P | C | M | | `bs.other_taxes_payable` | |
| 214003 | رسم الطابع المستحق | Stamp duty payable | P | C | M | | `bs.other_taxes_payable` | |
| 214004 | ضريبة الرواتب والأجور المقتطعة | Payroll tax withheld | P | C | M | | `bs.other_taxes_payable` | |
| 214005 | ضريبة غير المقيمين المقتطعة | Non-resident tax withheld | P | C | M | | `bs.other_taxes_payable` | |
| 215 | المصاريف المستحقة | Accrued expenses | H | C | | | | |
| 215001 | رواتب وأجور مستحقة | Accrued salaries and wages | P | C | M | | `bs.accruals` | |
| 215002 | مصاريف مستحقة أخرى | Other accrued expenses | P | C | M | | `bs.accruals` | |
| 216 | القروض والسلف قصيرة الأجل | Short-term borrowings | H | C | | | | |
| 216001 | القروض والسلف قصيرة الأجل | Short-term borrowings | P | C | M | | `bs.borrowings` | |
| 217 | جاري الشركاء | Partners' current accounts | H | C | | | | |
| 217001 | جاري الشركاء | Partners' current accounts | P | C | M | | `bs.trade_payables` | |
| 3 | حقوق الملكية | Equity | H | C | | | | |
| 31 | رأس المال والاحتياطيات | Capital and reserves | H | C | | | | |
| 311 | رأس المال | Capital | H | C | | | | |
| 311001 | رأس المال | Capital | P | C | | | `bs.share_capital` | |
| 312 | الأرباح المحتجزة | Retained earnings | H | C | | | | |
| 312001 | الأرباح المحتجزة | Retained earnings | P | C | | | `bs.retained_earnings` | `retained_earnings` |
| 312002 | نتيجة السنة قبل بدء الدفاتر | Result of the year before the books start | P | C | | | `bs.retained_earnings` | `pre_opening_result` |
| 313 | جاري المالك | Owner's current account | H | C | | | | |
| 313001 | جاري المالك | Owner's current account | P | C | | | `bs.owner_current` | |
| 314 | الاحتياطيات | Reserves | H | C | | | | |
| 314001 | الاحتياطي القانوني | Legal reserve | P | C | | | `bs.reserves` | |
| 4 | الإيرادات | Revenue | H | C | | | | |
| 41 | إيرادات النشاط | Operating revenue | H | C | | | | |
| 411 | إيرادات العقود | Contract revenue | H | C | | | | |
| 411001 | إيرادات عقود المقاولات | Construction contract revenue | P | C | | client, contract | `is.revenue` | |
| 42 | إيرادات أخرى | Other income | H | C | | | | |
| 421 | أرباح فروق الصرف | Exchange gains | H | C | | | | |
| 421001 | أرباح فروق صرف محققة | Realised exchange gains | P | C | | | `is.fx_differences` | `fx_realised_gain` |
| 421002 | أرباح فروق صرف غير محققة | Unrealised exchange gains | P | C | | | `is.fx_differences` | `fx_unrealised_gain` |
| 422 | إيرادات متنوعة | Sundry income | H | C | | | | |
| 422001 | إيرادات أخرى | Other income | P | C | | | `is.other_income` | |
| 422002 | زيادة الصناديق | Cash overages | P | C | | | `is.other_income` | |
| 5 | المصاريف | Expenses | H | D | | | | |
| 51 | تكاليف المشاريع | Project costs | H | D | | | | |
| 511 | تكاليف المشاريع المباشرة | Direct project costs | H | D | | | | |
| 511001 | المواد | Materials | P | D | | contract | `is.direct_costs` | |
| 511002 | أجور العمال والحرفيين | Wages of workers and craftsmen | P | D | | contract | `is.direct_costs` | |
| 511003 | مقاولو الباطن | Subcontractors | P | D | | contract | `is.direct_costs` | |
| 511004 | استئجار الآليات والمعدات | Machinery and equipment hire | P | D | | contract | `is.direct_costs` | |
| 511005 | نقل ومحروقات الموقع | Site transport and fuel | P | D | | contract | `is.direct_costs` | |
| 511006 | تكاليف موقع أخرى | Other site costs | P | D | | contract | `is.direct_costs` | |
| 52 | مصاريف الموظفين | Employee costs | H | D | | | | |
| 521 | الرواتب والأجور | Salaries and wages | H | D | | | | |
| 521001 | رواتب وأجور | Salaries and wages | P | D | | | `is.employee_benefits` | |
| 521002 | مزايا الموظفين الأخرى | Other employee benefits | P | D | | | `is.employee_benefits` | |
| 521003 | حصة صاحب العمل من التأمينات الاجتماعية | Employer's social insurance contributions | P | D | | | `is.employee_benefits` | |
| 53 | المصاريف التشغيلية | Operating expenses | H | D | | | | |
| 531 | مصاريف المكتب | Office expenses | H | D | | | | |
| 531001 | الإيجار | Rent | P | D | | | `is.other_expenses` | |
| 531002 | الكهرباء والمياه والمحروقات | Utilities and fuel | P | D | | | `is.other_expenses` | |
| 531003 | الاتصالات والإنترنت | Telecom and internet | P | D | | | `is.other_expenses` | |
| 531004 | اشتراكات البرمجيات | Software subscriptions | P | D | | | `is.other_expenses` | |
| 531005 | القرطاسية والمستلزمات | Stationery and supplies | P | D | | | `is.other_expenses` | |
| 531006 | الصيانة والإصلاح | Repairs and maintenance | P | D | | | `is.other_expenses` | |
| 532 | المصاريف الإدارية | Administrative expenses | H | D | | | | |
| 532001 | الأتعاب المهنية | Professional fees | P | D | | | `is.other_expenses` | |
| 532002 | الرسوم المصرفية وعمولات التحويل | Bank and transfer charges | P | D | | | `is.other_expenses` | |
| 532003 | الرسوم والطوابع الحكومية | Government fees and stamps | P | D | | | `is.other_expenses` | |
| 532004 | التسويق والإعلان | Marketing and advertising | P | D | | | `is.other_expenses` | |
| 532005 | ضريبة غير المقيمين المتحمَّلة | Non-resident tax borne | P | D | | | `is.other_expenses` | |
| 532006 | خسائر انخفاض قيمة الذمم المدينة وأصول العقود | Impairment losses on receivables and contract assets | P | D | | | `is.impairment_losses` | |
| 532007 | عجز الصناديق | Cash shortages | P | D | | | `is.other_expenses` | |
| 533 | الاستهلاك والإطفاء | Depreciation and amortisation | H | D | | | | |
| 533001 | استهلاك الآليات والمعدات | Depreciation — machinery and equipment | P | D | | | `is.depreciation` | |
| 533002 | استهلاك الأثاث والمفروشات | Depreciation — furniture | P | D | | | `is.depreciation` | |
| 533003 | إطفاء الأصول غير الملموسة | Amortisation of intangible assets | P | D | | | `is.depreciation` | |
| 533004 | استهلاك السيارات ووسائط النقل | Depreciation — vehicles | P | D | | | `is.depreciation` | |
| 533005 | استهلاك العدد والسقالات والقوالب | Depreciation — tools, scaffolding and formwork | P | D | | | `is.depreciation` | |
| 54 | مصاريف أخرى | Other expenses | H | D | | | | |
| 541 | خسائر فروق الصرف والتقريب | Exchange losses and rounding | H | D | | | | |
| 541001 | خسائر فروق صرف محققة | Realised exchange losses | P | D | | | `is.fx_differences` | `fx_realised_loss` |
| 541002 | خسائر فروق صرف غير محققة | Unrealised exchange losses | P | D | | | `is.fx_differences` | `fx_unrealised_loss` |
| 541003 | فروق تقريب التحويل | Conversion rounding differences | P | D | | | `is.fx_differences` | `conversion_rounding` |
| 55 | ضريبة الدخل | Income tax | H | D | | | | |
| 551 | مصروف ضريبة الدخل | Income tax expense | H | D | | | | |
| 551001 | مصروف ضريبة الدخل | Income tax expense | P | D | | | `is.income_tax` | |
| 56 | تكاليف التمويل | Finance costs | H | D | | | | |
| 561 | فوائد القروض والسحب على المكشوف | Interest on loans and overdrafts | H | D | | | | |
| 561001 | فوائد القروض والسحب على المكشوف | Interest on loans and overdrafts | P | D | | | `is.finance_costs` | |

Notes, each the owner's answer of 2026-11-14 or the standard it rests on:
- **Cash accounts:** one box per currency the client uses and the two banks of `general@3`, all monetary (IAS 21.16). Further boxes (a site box) are added by the accountant under `111`, each in one currency.
- **Clients:** billings and retentions are document items, one per billing (ADR 0013), monetary; retentions receivable are contract assets while conditional on completion (IFRS 15.107; IFRS 15.105). Advances from clients are a running item per client and currency, non-monetary (IAS 21.16, IFRIC 22): a contract liability (IFRS 15.106).
- **Suppliers, subcontractors, workers:** a running balance per counterparty and currency (ADR 0007), monetary, on separate accounts by kind; an advance paid beyond the balance stays in the same account (a debit balance, presented as a receivable by S09). Advances paid before any invoice go to `114002`, non-monetary, so the cost they pay is measured at their rate (IFRIC 22, S12).
- **Project costs:** six kinds by nature under `is.direct_costs` (IAS 1.102), each requiring the contract; office costs under `53` without it.
- **Fixed assets:** four classes with their accumulated depreciation (IAS 16.37, 16.73(d)), and the intangibles of `general@3`.
- **Tax accounts** as in `general@3`; their Syrian rules stay UNVERIFIED and no posting rule depends on them.

## Scenarios
Accounting rules this spec introduces or confirms, each written and approved through `/posting-rule` before its code, in the `usd-syp` shape with TRY unless stated:
- **`docs/scenarios/cash/receipt-and-payment.md`:**
  - a USD receipt settling a client's USD billing on `112001` (no book difference; the parallel difference at the bulletin);
  - a TRY receipt settling a USD billing at the USD/TRY rate dealt with the client (no book difference, the parallel difference at the bulletin), and the same receipt with no dealt rate (differences in both ledgers, the book's at market);
  - a receipt of an advance from a client on `212002`, then the month-end revaluation that leaves it unchanged;
  - a payment of a site cost in TRY on `511005` with its contract;
  - a TRY payment to supplier S1's running balance (the example above);
  - a payment to a worker beyond the worker's balance, crossing zero;
  - a payment that would take the box below zero, and a back-dated one that would make a later date negative, both refused;
  - the cancellation of a receipt that settled a billing, reopening it at its carrying amount.
- **`docs/scenarios/cash/transfer-and-exchange.md`:**
  - a USD transfer from a box to the bank, with a fee (no difference);
  - an exchange USD to TRY with a dealt rate and a fee (the example above);
  - an exchange TRY to SYP, both foreign to the book (realised in both ledgers at market and bulletin);
  - an exchange TRY to USD whose derived rate is not exact (a residual of under half a cent);
  - the same exchange in `syp` and in `syp-usd`;
  - the cancellation of an exchange.
- **`docs/scenarios/cash/cash-count.md`:** a shortage in the TRY box and an overage in the USD box, both measured new; a count that matches; a stale count refused.
- **The move of the scenario book** (its own PR, no new rule): the owner approves the mapping and the moved files with their numbers unchanged.
- **For S12 (not here):** the application of an advance against a billing or an invoice at the advance's carrying amount (IFRIC 22.8–9), in `advances/application.md`.

## Open questions
- **Q10 (owner, 2026-11-14, UNVERIFIED):** the TRY bulletin is assumed daily, as USD's. Verify against the Central Bank's published bulletin before the client's first company; if it is weekly, a per-pair schedule is specified before that company's first TRY entry.
- **Q20 (new, for S12 or later; not blocking):** how the client's contract revenue is recognised: over time by progress (IFRS 15.35(b), 15.39–45), with billings, contract assets and contract liabilities, or as billed. S11 gives the accounts only; until decided, revenue is posted by manual invoice (S04).
- **Q1 (unchanged, UNVERIFIED):** whether the tax authority accepts statutory books kept as the SYP parallel ledger of a USD-book company; a Syrian certified auditor's written view before the client's first tax return.
- None blocks S11.

## Acceptance
- **The owner's end-to-end check:**
  1. Create a test company "شركة مقاولات تجريبية" with `--book-currency USD --parallel-currency SYP --template contracting`, the book policy market (accepting dealt rates) and the parallel policy bulletin. The chart shows the template; `/chart/roles` shows the seven roles; `111001`, `111002` and `111005` are boxes, `111003` and `111004` banks; `211001` asks for a supplier.
  2. Record the bulletin for 1–3 December (120.0000 SYP per USD, 3.5000 SYP per TRY) and the market for 3 December (34.0000 TRY per USD). Add the supplier "مورد تجريبي 1", the worker "عامل تجريبي 1", the client "عميل تجريبي 1" and its contract "مشروع البناء التجريبي".
  3. Post a receipt of 5,000.00 USD into the USD box from the owner's current account. `/cash` shows 5,000.00 USD.
  4. Post the exchange of the example: the TRY box shows 34,500.00 TRY, the USD box 3,990.00 USD; the entry shows the 750.00 SYP gain in the parallel ledger only; print the voucher and read the amount in words.
  5. Try a payment of 40,000.00 TRY from the TRY box: refused, naming the box and the shortfall of 5,500.00 TRY.
  6. Count the TRY box at 34,450.00 TRY: a shortage of 50.00 TRY posts to `532007`.
  7. Open the TRY box's statement: opening, the exchange, the count, the closing balance 34,450.00 TRY; export it to Excel and PDF.
  8. Cancel the count's voucher: it prints "ملغى"; the box shows 34,500.00 TRY again.
- **Tests:**
  - API: success, 401, 403, another company and an idempotent replay per endpoint;
  - unit and property tests: the voucher shapes (rules 10–13); the derived dealt rate; the box check (any order of back-dated postings and reversals never leaves a box negative at any date, and refuses exactly when it would); voucher numbers gapless per kind and year under concurrent postings; `amountInWords` on its table; the template's data (every postable account has a statement line fitting its class; roles fit S02 rule 7; control accounts have a counterparty type and require it; cash kinds only on eligible accounts; codes fit the shape; names present);
  - database tests as `mizan_app`: the guards on `cash_vouchers` and `voucher_sequences`, the counterparty-type guard, the cash-kind check and lock, isolation;
  - the scenario book: the three `cash/` files, and every moved file with unchanged numbers;
  - E2E with RTL screenshots at 360 px and desktop: the cash position, a receipt, an exchange, a count, a statement, a printed voucher.
