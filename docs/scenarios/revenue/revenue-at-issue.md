# Revenue at issue from Hub's invoices

Status: Proposed

S05 wrote these cases (S05 "Scenarios"); their expected entries and outcomes await the owner's approval.

The cases stay `Proposed` until S05 brings their executors: the `event` executor through the event inbox, the posting rules of `invoice.issued` (lines recognised at issue), `invoice.voided` and `invoice.line_service_changed`, the mapping slots `receivable`, `revenue_at_issue` and `termination_fee_revenue`, a contract value made from the event (its kind and client, S05 rule 23), and the hold `NO_MAPPING` with its details `deferred_revenue` and `tax_lines` (S05 rules 8, 12–14). S05's feature slice switches the file to `Approved (owner, <the approval's date>)`.

## Rule

`invoice.issued` whose every line is recognised at issue (`extra_work`, `manual` not marked deferred, `retainer_charge` of kind `termination_fee`) and whose taxes are zero posts one entry on the invoice's accounting date: a debit to trade receivables for the invoice's total, as one document item under Hub's invoice number with the client and, when named, the contract; and a credit per line to service revenue (`revenue_at_issue`) or to contract termination fees (`termination_fee_revenue`), with the client, the line's service and, when named, the contract. Every line, the item's included, is a new measurement in each ledger: the book ledger at the bulletin of the day, a ledger in the invoice's currency at the amount as is, and a market ledger that accepts the transaction's rate at Hub's `syp_per_usd`. Whatever the conversions leave a ledger out of balance by is conversion rounding, one line per ledger to the `conversion_rounding` role account. An invoice with any line whose revenue is deferred (a retainer cycle charge, a deposit, a milestone, a manual line marked deferred) is held `NO_MAPPING` (`deferred_revenue`) whole, and one with a non-zero tax is held `NO_MAPPING` (`tax_lines`); nothing of it posts. `invoice.line_service_changed` moves the line's revenue from the old service to the new on the change date: a debit with the old service and a credit with the new, on the account the line posted to, at the amounts the line posted at issue in both ledgers, so no rate is read. `invoice.voided` posts, on the void date, the exact reversal of every entry still standing for the invoice, latest first, and closes the item; no rate is read.

## Basis

- **IFRS 15.31 and 15.38:** extra work and a manual invoice not marked deferred are invoiced once the work is delivered, so the performance obligation is satisfied and the revenue is recognised at issue. A termination fee is consideration for no further service: nothing is left to deliver, so it too is revenue at issue (`phase-1-scope.md` §6, "Termination fee").
- **IFRS 9.5.1.3 and IFRS 15.108:** the right to consideration is unconditional once invoiced, so the invoice's total is a trade receivable.
- **IFRS 15.31 applied to the contract once:** an invoice that also carries a deferred line is S06's, held whole until S06's rules exist, so one invoice is never split between two specs (owner, 2026-11-07).
- **IAS 21.21–22:** each line is recorded at the spot rate of its date: the bulletin of the day for the book ledger (S02 rule 16; ADR 0011), and for a market ledger that accepts it, the rate the invoice was dealt at, Hub's `syp_per_usd`. An invoice in one currency exchanges nothing, so its residual is the rounding of the conversions alone (IAS 21.28 does not apply), at most half a minor unit per converted line.
- **IAS 1.32:** the rounding line has its own account (`541003`, presented with the exchange differences) and is never offset inside a revenue line.
- **ADR 0005 and ADR 0012:** posted entries are append-only; a void or a service change in Hub is a reversal or a reclassification entry in Mizan, dated on its own date, so a month already reported keeps its figures. A Hub entry is reversed only by its events (S05 rule 14).
- **Company policy:** `phase-1-scope.md` §4 (the book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate; no tax posting rule in phase 1) and §6 ("Extra work and manual invoices", "Termination fee", "Invoice voided", "Service changed on a line"); ADR 0007 "Rounding lines"; S05 "Accounting treatment", rules 2, 8, 12–14 and "Currencies, rates and rounding" (owner, 2026-11-07); S04 rules 2 and 13 (the document item and its closing).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No tax rule is applied (the tax reform expected for 2027 is CONFIRMED as announced, SANA, 2026-10-11; its content is not known).

## Cases

The account codes are the service-agency template's (S02): trade receivables `112001` (a `document` control account, client required), service revenue `411001` (client and service required), contract termination fees `411002` (client required) and the conversion-rounding account `541003`. The mapping slots take their template defaults (S05 "Data"). Every rate and amount is synthetic. Thursday 29 October and Tuesday 3, Tuesday 10 and Tuesday 24 November 2026 are publication days.

An item opened by `invoice.issued` is named by Hub's invoice number (`INV-2026-1`) and carries the invoice's client and, when the invoice names one, its contract. The payloads carry the fields of ADR 0006's catalogue that the rules read, in the short form of `receivables/hub-payment.md`: dimensions by their code, and each document by its number. A contract travels with its kind and its client (S05 rule 2), so the setup makes it from the event. S05 fixes the full payload contract with Hub (Q5), which changes the payloads but no expected value. A Hub void's entries have the void event as their source, a service change's the change event.

A rounding line carries its amount in one ledger only, in that ledger's currency (ADR 0007). A half minor unit rounds away from zero: 908,212.5 → 908,213.

Shapes:
- **`syp-usd`** is Vertex Media, the company Hub feeds; most cases are in it.
- **`syp`** and **`usd-syp`** each have one case with a USD and an SYP invoice, for a company fed by Hub without a parallel ledger or with USD books.
- **`third`** cannot occur: Hub invoices only in SYP and USD and its events carry only `syp_per_usd` (ADR 0006), so an invoice in another currency is refused by the contract (S05 rule 2) and stores nothing.

The cases leave out what other scenarios or later specs own:
- payments of these invoices, and a void held `OPEN_ITEM_HAS_SETTLEMENTS` while a payment stands (`receivables/hub-payment.md`);
- the deferred lines' own rules, and the void or service change of an invoice that has them (S06);
- a manual line marked deferred, held `NO_MAPPING` (`deferred_revenue`) like the retainer line below: its marker is a field of the payload contract S05 fixes with Hub (Q5);
- an invoice, void or service change dated in a closed period, held `PERIOD_CLOSED` (the scenario setup closes periods with S07; `inbox/holds-and-actions.md` posts one in the next open period);
- an event received before the invoice it names (a void or a service change), held `UNKNOWN_REFERENCE` like the payments of `receivables/hub-payment.md`;
- a replayed event (the same idempotency key), which posts nothing new: a property test of S05, since a step carries no event ID;
- a line of zero or a negative amount: refused by the contract (422), nothing stored (S05 rule 2, edge case 8);
- `invoice.due_date_changed`, which posts nothing (`receivables/hub-payment.md`).

### Vertex Media: a USD invoice with an extra-work line and a manual line

Each line converts on its own at the bulletin, and so does the invoice's total on the item; the book ledger is left 0.01 SYP short of a debit, which is conversion rounding. The USD parallel ledger takes the amounts as is.

```yaml
case: a 100.00 USD invoice of 74.75 extra work and 25.25 manual at bulletin 121.5; a book rounding debit of 0.01 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 7475, source: extra_work, service: S1 },
                       { line: L2, amount: 2525, source: manual, service: S2 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # the total: 100.00 USD × 121.5 = 12,150.00 SYP exactly; parallel: USD as is (Hub's 122 is not read)
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        # 74.75 USD × 121.5 = 9,082.125 SYP → 908,212.5 minor → 908,213
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -7475, book: -908213, parallel: -7475 }
        # 25.25 USD × 121.5 = 3,067.875 SYP → 306,787.5 minor → 306,788
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: -2525, book: -306788, parallel: -2525 }
        # book residual: 1,215,000 − 908,213 − 306,788 = −1 → a debit of 0.01 SYP, within
        # 3 converted lines × 0.5 = 1.5 minor units; parallel: no residual
        - { account: "541003", currency: SYP, amount: 1, book: 1, parallel: 0 }
  balances:
    - { account: "112001", book: 1215000, parallel: 10000 }
    - { account: "411001", dims: { service: S1 }, book: -908213, parallel: -7475 }
    - { account: "411001", dims: { service: S2 }, book: -306788, parallel: -2525 }
    - { account: "541003", book: 1, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
```

### Vertex Media: an SYP invoice with two extra-work lines

The SYP books take the amounts as is, so no bulletin is read and the case records none. The USD parallel ledger measures each line and the total at Hub's 123, and is left 0.01 USD short of a credit.

```yaml
case: a 12,200.00 SYP invoice of two 6,100.00 extra-work lines at Hub's 123; a parallel rounding credit of 0.01 USD
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: SYP, syp_per_usd: "123.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 610000, source: extra_work, service: S1 },
                       { line: L2, amount: 610000, source: extra_work, service: S2 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # parallel: 12,200.00 SYP / 123 = 99.1869… USD → 99.19
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 1220000, book: 1220000, parallel: 9919 }
        # parallel: 6,100.00 SYP / 123 = 49.5934… USD → 49.59, each line
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -610000, book: -610000, parallel: -4959 }
        - { account: "411001", dims: { client: C1, service: S2 }, currency: SYP, amount: -610000, book: -610000, parallel: -4959 }
        # parallel residual: 9,919 − 4,959 − 4,959 = 1 → a credit of 0.01 USD; book: no residual
        - { account: "541003", currency: USD, amount: -1, book: 0, parallel: -1 }
  balances:
    - { account: "112001", book: 1220000, parallel: 9919 }
    - { account: "411001", book: -1220000, parallel: -9918 }
    - { account: "541003", book: 0, parallel: -1 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 1220000, book: 1220000, parallel: 9919 }
```

### Vertex Media: a termination fee, then its service changed

The invoice names the client's retainer, so the item and the revenue line carry the contract. A termination fee is a `retainer_charge` of kind `termination_fee`: revenue at issue on contract termination fees `411002`, not deferred. A week later Hub moves the line to another service: the reclassification stays on `411002`, the account the line posted to, at the amounts it posted at issue; the bulletin of 10 November is not read.

```yaml
case: a 500.00 USD termination fee of retainer R1 at bulletin 120; its service changed on 10 November at the issue amounts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 50000, source: retainer_charge, kind: termination_fee, service: S3 }] }
  - event: invoice.line_service_changed
    accounting_date: 2026-11-10
    payload: { invoice: INV-2026-1, line: L1, old_service: S3, new_service: S4, changed_on: 2026-11-10 }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 500.00 USD × 120 = 60,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 50000, book: 6000000, parallel: 50000 }
        - { account: "411002", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: -50000, book: -6000000, parallel: -50000 }
    - source: invoice.line_service_changed
      date: 2026-11-10
      lines:
        # the line's issue amounts, not 500.00 × 122: a reclassification, never a new measurement
        - { account: "411002", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: 50000, book: 6000000, parallel: 50000 }
        - { account: "411002", dims: { client: C1, contract: R1, service: S4 }, currency: USD, amount: -50000, book: -6000000, parallel: -50000 }
  balances:
    - { account: "411002", dims: { service: S3 }, book: 0, parallel: 0 }
    - { account: "411002", dims: { service: S4 }, book: -6000000, parallel: -50000 }
    - { account: "411001", book: 0, parallel: 0 }
  open_items:
    # the item does not move with the service change
    - { item: INV-2026-1, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 50000, book: 6000000, parallel: 50000 }
```

### Vertex Media: a service change on one line of an invoice

Only the changed line moves; the other line keeps its service.

```yaml
case: a 500.00 USD invoice of two extra-work lines at bulletin 120; line L1 moved from S1 to S3 on 10 November at its issue amounts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 30000, source: extra_work, service: S1 },
                       { line: L2, amount: 20000, source: extra_work, service: S2 }] }
  - event: invoice.line_service_changed
    accounting_date: 2026-11-10
    payload: { invoice: INV-2026-1, line: L1, old_service: S1, new_service: S3, changed_on: 2026-11-10 }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 500.00 USD × 120 = 60,000.00 SYP; 300.00 × 120 = 36,000.00; 200.00 × 120 = 24,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 50000, book: 6000000, parallel: 50000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: -20000, book: -2400000, parallel: -20000 }
    - source: invoice.line_service_changed
      date: 2026-11-10
      lines:
        # L1's issue amounts: 300.00 USD, 36,000.00 SYP (not × 122)
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, service: S3 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
  balances:
    - { account: "411001", dims: { service: S1 }, book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S2 }, book: -2400000, parallel: -20000 }
    - { account: "411001", dims: { service: S3 }, book: -3600000, parallel: -30000 }
    - { account: "411001", book: -6000000, parallel: -50000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 50000, book: 6000000, parallel: 50000 }
```

### Vertex Media: a void in the next month

The invoice is issued on 29 October at bulletin 121.5, with a rounding line, and voided on 3 November. The void is the exact negation of the issue entry, the rounding line included, dated on the void date: October keeps its revenue, November takes it back, and the bulletin of 3 November is not read.

```yaml
case: the 100.00 USD invoice of 29 October at bulletin 121.5 voided on 3 November; the exact reversal, no rate read
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-10-29
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-10-29, due_on: 2026-11-28,
               lines: [{ line: L1, amount: 7475, source: extra_work, service: S1 },
                       { line: L2, amount: 2525, source: manual, service: S2 }] }
  - event: invoice.voided
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, voided_on: 2026-11-03, reason: "أُلغيت الفاتورة في Hub" }
expect:
  entries:
    - source: invoice.issued
      date: 2026-10-29
      lines:
        # as in the first case: 12,150.00; 9,082.125 → 908,213; 3,067.875 → 306,788; rounding 0.01 debit
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -7475, book: -908213, parallel: -7475 }
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: -2525, book: -306788, parallel: -2525 }
        - { account: "541003", currency: SYP, amount: 1, book: 1, parallel: 0 }
    - source: invoice.voided
      date: 2026-11-03
      lines:
        # the exact negation of the issue entry, not 100.00 × 120: the item closes at what it carries
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: 7475, book: 908213, parallel: 7475 }
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: 2525, book: 306788, parallel: 2525 }
        - { account: "541003", currency: SYP, amount: -1, book: -1, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
    - { account: "541003", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a void after a service change

A void reverses every entry still standing for the invoice, latest first (S05 rule 14, edge case 16): the service change, then the issue, each as its own entry on the void date. Every service comes back to zero.

```yaml
case: the two-line invoice of 3 November, L1 moved to S3 on 10 November, voided on 24 November; two reversals, latest first
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 30000, source: extra_work, service: S1 },
                       { line: L2, amount: 20000, source: extra_work, service: S2 }] }
  - event: invoice.line_service_changed
    accounting_date: 2026-11-10
    payload: { invoice: INV-2026-1, line: L1, old_service: S1, new_service: S3, changed_on: 2026-11-10 }
  - event: invoice.voided
    accounting_date: 2026-11-24
    payload: { invoice: INV-2026-1, voided_on: 2026-11-24, reason: "أُلغيت الفاتورة في Hub" }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 50000, book: 6000000, parallel: 50000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: -20000, book: -2400000, parallel: -20000 }
    - source: invoice.line_service_changed
      date: 2026-11-10
      lines:
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, service: S3 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: invoice.voided
      date: 2026-11-24
      lines:
        # first the latest entry: the negation of the service change
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "411001", dims: { client: C1, service: S3 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
    - source: invoice.voided
      date: 2026-11-24
      lines:
        # then the negation of the issue entry; no rate of 24 November is read
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -50000, book: -6000000, parallel: -50000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: 20000, book: 2400000, parallel: 20000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S1 }, book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S2 }, book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S3 }, book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: an invoice with a retainer line, held whole

The invoice mixes an extra-work line with a monthly retainer charge, whose revenue is deferred over its cycle (S06). It is held `NO_MAPPING` (`deferred_revenue`) whole: the extra-work line does not post on its own, and no item opens. S06's deployment retries it.

```yaml
case: an invoice of 100.00 USD extra work and a 1,000.00 USD monthly retainer charge is held NO_MAPPING whole; nothing posts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S1 },
                       { line: L2, amount: 100000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-01, cycle_end: 2026-11-30, service: S2 }] }
    outcome: { status: held, reason: NO_MAPPING, detail: deferred_revenue }
expect:
  entries: []
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
```

### Vertex Media: an invoice with a tax line

A non-zero tax is stored, never posted, while phase 1 has no tax rule: the invoice is held `NO_MAPPING` (`tax_lines`) whole (owner, 2026-11-07). A tax of zero changes nothing: the invoice posts as if it had none (S05 edge case 7).

```yaml
case: a 100.00 USD extra-work invoice with a 5.00 USD tax is held NO_MAPPING; nothing posts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S1,
                         taxes: [{ code: SALES, base: 10000, rate: "5.00", amount: 500 }] }] }
    outcome: { status: held, reason: NO_MAPPING, detail: tax_lines }
expect:
  entries: []
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
```

```yaml
case: a 100.00 USD extra-work invoice with a zero tax posts as if it had none
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S1,
                         taxes: [{ code: SALES, base: 10000, rate: "0.00", amount: 0 }] }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 100.00 USD × 120 = 12,000.00 SYP; no tax line
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
```

### SYP books only

With no parallel ledger, Hub's `syp_per_usd` measures nothing. The USD invoice converts at the bulletin with the same rounding as the first case; the SYP termination fee takes its amount as is.

```yaml
case: SYP books only; a 100.00 USD invoice at bulletin 121.5 with a rounding debit of 0.01 SYP, and a 61,000.00 SYP termination fee
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 7475, source: extra_work, service: S1 },
                       { line: L2, amount: 2525, source: manual, service: S2 }] }
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-2, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 6100000, source: retainer_charge, kind: termination_fee, service: S3 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 12,150.00; 9,082.125 → 908,213; 3,067.875 → 306,788; residual 1,215,000 − 1,215,001 = −1 → a debit
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1215000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -7475, book: -908213 }
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: -2525, book: -306788 }
        - { account: "541003", currency: SYP, amount: 1, book: 1 }
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # SYP as is; no rate read
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6100000, book: 6100000 }
        - { account: "411002", dims: { client: C1, contract: R1, service: S3 }, currency: SYP, amount: -6100000, book: -6100000 }
  balances:
    - { account: "112001", book: 7315000 }
    - { account: "411001", book: -1215001 }
    - { account: "411002", book: -6100000 }
    - { account: "541003", book: 1 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1215000 }
    - { item: INV-2026-2, account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6100000, book: 6100000 }
```

### USD books with an SYP parallel ledger

The USD books take the USD invoice as is and measure the SYP termination fee at the bulletin, never at Hub's rate (the book ledger does not accept a transaction's rate). The SYP parallel ledger accepts it: it measures the USD invoice at Hub's 122.5, with a rounding debit of 0.01 SYP, and takes the SYP fee as is.

```yaml
case: USD books; a 100.00 USD invoice at Hub's 122.5 with a parallel rounding debit of 0.01 SYP, and a 61,000.00 SYP termination fee at bulletin 120
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.5000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 7475, source: extra_work, service: S1 },
                       { line: L2, amount: 2525, source: manual, service: S2 }] }
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-2, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "122.5000", issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 6100000, source: retainer_charge, kind: termination_fee, service: S3 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # book: USD as is; parallel: 100.00 USD × 122.5 (Hub's rate) = 12,250.00 SYP exactly
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 10000, parallel: 1225000 }
        # parallel: 74.75 USD × 122.5 = 9,156.875 SYP → 915,687.5 minor → 915,688
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -7475, book: -7475, parallel: -915688 }
        # parallel: 25.25 USD × 122.5 = 3,093.125 SYP → 309,312.5 minor → 309,313
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: -2525, book: -2525, parallel: -309313 }
        # parallel residual: 1,225,000 − 915,688 − 309,313 = −1 → a debit of 0.01 SYP; book: no residual
        - { account: "541003", currency: SYP, amount: 1, book: 0, parallel: 1 }
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # book: 61,000.00 SYP / 120 (bulletin) = 508.3333… USD → 508.33 (Hub's 122.5 is not read); parallel: SYP as is
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6100000, book: 50833, parallel: 6100000 }
        - { account: "411002", dims: { client: C1, contract: R1, service: S3 }, currency: SYP, amount: -6100000, book: -50833, parallel: -6100000 }
  balances:
    - { account: "112001", book: 60833, parallel: 7325000 }
    - { account: "411001", book: -10000, parallel: -1225001 }
    - { account: "411002", book: -50833, parallel: -6100000 }
    - { account: "541003", book: 0, parallel: 1 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 10000, parallel: 1225000 }
    - { item: INV-2026-2, account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6100000, book: 50833, parallel: 6100000 }
```

Each posted entry balances in both ledgers:
- **First case:** book 1,215,000 − 908,213 − 306,788 + 1 = 0; parallel 10,000 − 7,475 − 2,525 = 0.
- **SYP invoice:** book 1,220,000 − 610,000 − 610,000 = 0; parallel 9,919 − 4,959 − 4,959 − 1 = 0.
- **USD books:** book 10,000 − 7,475 − 2,525 = 0 and 50,833 − 50,833 = 0; parallel 1,225,000 − 915,688 − 309,313 + 1 = 0 and 6,100,000 − 6,100,000 = 0.
- A service change and a reversal carry posted amounts line by line, so they balance as their source does.
