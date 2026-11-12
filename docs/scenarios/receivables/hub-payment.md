# Settling a receivable by Hub's payment events

Status: Approved (owner, 2026-11-07)

The expected entries were approved by the owner on 2026-11-06, with three decisions, the first and third revised the same day after the accounting review:
- **A payment in the other currency:** the gap between Hub's applied amount and the amount received at Hub's `syp_per_usd`, both in the invoice's currency, is a realised exchange difference while it is within a tolerance of 1.00 in the invoice's currency (a company setting, default 1.00 USD or 1.00 SYP), not a discount. A wider gap is an overpayment, a liability (IFRS 15.106), or a concession, so the payment is held `NEEDS_DECISION`.
- **The book ledger** measures foreign cash at the bulletin, even when Hub applied it at its own rate.
- **A payment in the invoice's currency:** an amount above the applied amount is an overpayment, held `NEEDS_DECISION`. An applied amount above the amount is refused by S05's contract (422, nothing stored), since a gap in one currency is never an exchange difference (ADR 0007). S05 confirms with Hub how it sends an overpayment (Q5).

S05 added six cases, whose expected entries and outcomes the owner approved on 2026-11-07 (S05 "Scenarios"): the tolerance on a payment in the other currency (a gap of exactly the tolerance posts as a realised difference; one minor unit more is held, in USD and in SYP), an amount above the applied amount in the invoice's currency (held), an invoice void received before its payment's void (held, then posted by the retry), and two payments received before their invoice (held, then posted in order with the entries of Hub's order). No expected value of the earlier cases changed; their payments gained `invoice_currency`, which S05's contract requires (rule 3).

S05's feature slice brought their executors: the `event` executor through the event inbox, the posting rules of `invoice.issued`, `invoice.voided`, `invoice.due_date_changed`, `payment.recorded` and `payment.voided`, the mapping of each payment method to its account, the holds `UNKNOWN_REFERENCE`, `WAITING_FOR_EARLIER_EVENT`, `NEEDS_DECISION` and `OPEN_ITEM_HAS_SETTLEMENTS`, and the automatic retries (S04 "Out of scope"; owner, 2026-10-28; S05 rules 8–11).

## Rule

`invoice.issued` opens one document item per invoice on trade receivables, under Hub's invoice number, a new measurement at each ledger's policy rate; an extra-work line is revenue at issue. `payment.recorded` debits the account of the payment's method in the payment's currency, a new measurement: the book ledger at the bulletin of the day, a market ledger that accepts the transaction's rate at Hub's `syp_per_usd`. It credits the invoice's item by the amount Hub applied in the invoice's currency, at the item's carrying amount in proportion to what remains (S04 rule 4). Each ledger's residual, rounding included, posts in that ledger only as a realised exchange difference: a credit to `fx_realised_gain`, a debit to `fx_realised_loss`. A payment is held `NEEDS_DECISION` when it applies more than is open, when in the invoice's currency its amount exceeds the applied amount, or when in the other currency its amount at Hub's `syp_per_usd` differs from the applied amount by more than the company's tolerance (1.00 in the invoice's currency by default); the accountant then places the excess in a liability or decides the concession. `payment.voided` posts the exact reversal of the payment's entry, which reopens the item at what it had. `invoice.voided` posts the exact reversal of the issue entry, and is held `OPEN_ITEM_HAS_SETTLEMENTS` while a payment on the invoice stands; once the payment's void posts, the held void is retried and posts on its own date. `invoice.due_date_changed` posts nothing. Events on one invoice post in Hub's order: a payment received before its invoice is held `UNKNOWN_REFERENCE`, a later event on that invoice waits behind it (`WAITING_FOR_EARLIER_EVENT`), and the invoice itself never waits: it posts, then the held events are retried in received order, each measured on its own date, so the entries are those of Hub's order.

## Basis

- **IAS 21.21–22:** the invoice and the cash received are recorded at the spot rate of their dates: the bulletin of the day for the book ledger (S02 rule 16), and for Vertex Media's USD parallel ledger the rate the transaction was dealt at, which Hub sends as `syp_per_usd` and the ledger's policy accepts.
- **IAS 21.23(b) and 21.28:** a receivable is not converted again when it is settled. The gap, in each ledger separately, between what was received at the rate of its date and what the item carried is a realised exchange difference in profit or loss of the period.
- **IFRS 9.3.2.3(a):** the receivable is derecognised, in whole or in part, when the right to its cash flows is settled. **IFRS 15.106 and IAS 1.32:** an amount paid beyond what is open is a liability (a contract liability or another payable, the accountant's decision), never a credit balance on the client's receivable.
- **IFRS 15.38:** extra work is delivered when it is invoiced, so its revenue is recognised at issue (`phase-1-scope.md` §6, "Extra work").
- **ADR 0005:** posted entries are append-only; a void in Hub is a reversal in Mizan, dated on the void date.
- **Company policy:** `phase-1-scope.md` §4 (the book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate), F06 and §6 ("Payments", "Invoice voided", "Due date changed"); scope Q6 (one account per payment method); ADR 0006 and 0008 (the event catalogue, the hold reasons); ADR 0007 "Carrying amount" and "Exchange residuals"; ADR 0013 (settlement in proportion to what remains; a Hub payment beyond the open amount held; a Hub void of an invoice with payments held; owner, 2026-10-28); S04 rules 2, 4, 10 and 13 and its "Accounting treatment" of Hub events (owner, 2026-10-28).
- **S05 rules 8–11 and the tolerance** (owner, 2026-11-07): the hold reasons and their order, the automatic retries, the order per invoice, and the gap compared in the invoice's currency, rounded half away from zero, held only when it is more than the tolerance.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes are the service-agency template's (S02): cash on hand in SYP and USD `111001` and `111002`, the SYP and USD bank accounts `111003` and `111004`, the SYP e-wallet `111005`, trade receivables `112001` (a `document` control account, client required), service revenue `411001` (client and service required), realised exchange gains `421001` and losses `541001`. A payment's method maps to the account of that method in the payment's currency (scope Q6): `cash` to `111001` or `111002`, `bank_transfer` to `111003` or `111004`, `e_wallet` to `111005` or `111006`. Every rate and amount is synthetic. Tuesday 3, Thursday 19, Tuesday 24, Wednesday 25 and Thursday 26 November 2026 are publication days.

An item opened by `invoice.issued` is named by Hub's invoice number (`INV-2026-1`), and carries the invoice's client. The payloads carry the fields of ADR 0006's catalogue that the rules read, in a short form: dimensions by their code, and each document by its number. S05 fixes the full payload contract with Hub (Q5: `due_on` on `invoice.issued`, the applied amount and `invoice_currency` on `payment.recorded`), which changes the payloads but no expected value. A Hub void's entry has the void event as its source. A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007).

Shapes:
- **`syp-usd`** is Vertex Media, the company Hub feeds; most cases are in it.
- **`syp`** and **`usd-syp`** each have one case, for a company fed by Hub without a parallel ledger or with USD books.
- **`third`** cannot occur: Hub invoices and receives only SYP and USD, and its events carry only `syp_per_usd` (ADR 0006), so an event in another currency is refused by the contract (S05 rule 2, from Hub's `CURRENCIES`, read on 2026-11-07), and stores nothing.

The cases leave out what other scenarios or later specs own:
- the manual movements of a Hub item, which need a line memo (S04 rule 8; `receivables/manual-settlement.md` for the mechanics);
- a payment dated in a closed period, held `PERIOD_CLOSED` (`periods/close-and-reopen.md`, `inbox/post-in-next-open-period.md`), and one after a month-end revaluation (`currency/month-end-revaluation.md`, `currency/stale-revaluation.md`);
- a replayed event (the same idempotency key), which posts nothing new: a property test of S05, since a step carries no event ID;
- a payment of zero or a negative amount, and one in the invoice's currency that applies more than its amount: refused by the contract (422), nothing stored (owner, 2026-11-06);
- a company tolerance other than the default 1.00: the setting is S05's (rule 9), and its cases here use the default;
- a payment resolved by a manual entry and the hold of its later void (`inbox/holds-and-actions.md`, S05);
- the ad-wallet events (`ad-funds/running-balance.md`, S05).

### Vertex Media: a USD invoice paid in USD as the bulletin rises (ADR 0007, B1)

The payment's `syp_per_usd` is not read: the cash is in USD, so the book ledger takes the bulletin of the day and the parallel ledger the USD amount as is.

```yaml
case: a 100.00 USD extra-work invoice at bulletin 120 paid in USD at 123; a book gain of 300.00 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: USD, amount: 10000, syp_per_usd: "125.0000",
               applied_amount: 10000, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # book: 100.00 USD × 120 (bulletin) = 12,000.00 SYP; parallel: USD as is (Hub's 122 is not read)
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # bank_transfer in USD → 111004; book: 100.00 USD × 123 = 12,300.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 1230000, parallel: 10000 }
        # all that is open, at what the item carries
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
        # book residual: 1,230,000 − 1,200,000 = 30,000 → a credit: realised gain 300.00 SYP; parallel 0
        - { account: "421001", currency: SYP, amount: -30000, book: -30000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "421001", book: -30000, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: an SYP invoice paid in SYP as Hub's rate rises

The SYP books post no difference. The USD parallel ledger measures the invoice and the cash each at Hub's rate of its date, and the gap is a parallel loss.

```yaml
case: a 12,200.00 SYP invoice at Hub's 122 paid in SYP cash at Hub's 125; a parallel loss of 2.40 USD
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: SYP, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 1220000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: cash, currency: SYP, amount: 1220000, syp_per_usd: "125.0000",
               applied_amount: 1220000, invoice_currency: SYP }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # book: SYP as is; parallel: 12,200.00 SYP / 122 (Hub's rate) = 100.00 USD
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 1220000, book: 1220000, parallel: 10000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -1220000, book: -1220000, parallel: -10000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # cash in SYP → 111001; parallel: 12,200.00 SYP / 125 = 97.60 USD
        - { account: "111001", currency: SYP, amount: 1220000, book: 1220000, parallel: 9760 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -1220000, book: -1220000, parallel: -10000 }
        # parallel residual: 9,760 − 10,000 = −240 → a debit: realised loss 2.40 USD; book 0
        - { account: "541001", currency: USD, amount: 240, book: 0, parallel: 240 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "541001", book: 0, parallel: 240 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a USD invoice paid in two SYP payments, with Hub's applied amounts

The item clears by the USD amount Hub applied, never by a conversion of the SYP received; the cash is in the book currency, so the bulletin of the payment's date is not read. The first payment's applied amount is Hub's rate exactly, so the parallel ledger posts nothing. The last payment closes the invoice: Hub applies the 595.14 USD still open, while 73,800.00 SYP at Hub's 124 is 595.16 USD, and the 0.02 USD between them, within the 1.00 USD tolerance, is a parallel gain, not a discount (owner, 2026-11-06).

```yaml
case: a 1,000.00 USD invoice at 120; 50,000.00 SYP applied as 404.86 USD, then 73,800.00 SYP applied as the 595.14 USD left
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: e_wallet, currency: SYP, amount: 5000000, syp_per_usd: "123.5000",
               applied_amount: 40486, invoice_currency: USD }
  - event: payment.recorded
    accounting_date: 2026-11-25
    payload: { payment: PAY-2, receipt: R-2026-2, invoice: INV-2026-1, paid_on: 2026-11-25,
               method: bank_transfer, currency: SYP, amount: 7380000, syp_per_usd: "124.0000",
               applied_amount: 59514, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # book: 1,000.00 USD × 120 = 120,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # e_wallet in SYP → 111005; parallel: 50,000.00 SYP / 123.5 = 404.8583… → 404.86 USD
        - { account: "111005", currency: SYP, amount: 5000000, book: 5000000, parallel: 40486 }
        # 404.86 of 1,000.00 open: book 12,000,000 × 40,486 / 100,000 = 4,858,320 exactly
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40486, book: -4858320, parallel: -40486 }
        # book residual: 5,000,000 − 4,858,320 = 141,680 → realised gain 1,416.80 SYP; parallel 40,486 − 40,486 = 0
        - { account: "421001", currency: SYP, amount: -141680, book: -141680, parallel: 0 }
    - source: payment.recorded
      date: 2026-11-25
      lines:
        # bank_transfer in SYP → 111003; parallel: 73,800.00 SYP / 124 = 595.1612… → 595.16 USD
        - { account: "111003", currency: SYP, amount: 7380000, book: 7380000, parallel: 59516 }
        # 595.14 of 595.14 open: all that remains, book 12,000,000 − 4,858,320 = 7,141,680; parallel 59,514
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -59514, book: -7141680, parallel: -59514 }
        # book residual: 7,380,000 − 7,141,680 = 238,320 → realised gain 2,383.20 SYP
        - { account: "421001", currency: SYP, amount: -238320, book: -238320, parallel: 0 }
        # parallel residual: 59,516 − 59,514 = 2 → realised gain 0.02 USD
        - { account: "421001", currency: USD, amount: -2, book: 0, parallel: -2 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    # book: 123,800.00 SYP received − 120,000.00 SYP carried = 3,800.00 SYP
    - { account: "421001", book: -380000, parallel: -2 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: an SYP invoice paid first in USD, then in SYP

The USD cash is measured in the book ledger at the bulletin, 123, while Hub applied it at its own 124: the statutory books record a loss of 500.00 SYP, since 500.00 USD is worth 61,500.00 SYP at the bulletin against the 62,000.00 SYP it settled. The partial clearing rounds in the parallel ledger, and the last payment takes what is left.

```yaml
case: a 122,000.00 SYP invoice at Hub's 122; 500.00 USD applied as 62,000.00 SYP at 124, then 60,000.00 SYP at 125
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: SYP, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 12200000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: cash, currency: USD, amount: 50000, syp_per_usd: "124.0000",
               applied_amount: 6200000, invoice_currency: SYP }
  - event: payment.recorded
    accounting_date: 2026-11-25
    payload: { payment: PAY-2, receipt: R-2026-2, invoice: INV-2026-1, paid_on: 2026-11-25,
               method: bank_transfer, currency: SYP, amount: 6000000, syp_per_usd: "125.0000",
               applied_amount: 6000000, invoice_currency: SYP }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # parallel: 122,000.00 SYP / 122 = 1,000.00 USD
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 12200000, book: 12200000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -12200000, book: -12200000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # cash in USD → 111002; book: 500.00 USD × 123 (bulletin; Hub's 124 is not the book's rate) = 61,500.00 SYP
        - { account: "111002", currency: USD, amount: 50000, book: 6150000, parallel: 50000 }
        # 62,000.00 of 122,000.00 open: parallel 100,000 × 62/122 = 50,819.67… → 50,820
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -6200000, book: -6200000, parallel: -50820 }
        # book residual: 6,150,000 − 6,200,000 = −50,000 → realised loss 500.00 SYP
        - { account: "541001", currency: SYP, amount: 50000, book: 50000, parallel: 0 }
        # parallel residual: 50,000 − 50,820 = −820 → realised loss 8.20 USD
        - { account: "541001", currency: USD, amount: 820, book: 0, parallel: 820 }
    - source: payment.recorded
      date: 2026-11-25
      lines:
        # bank_transfer in SYP → 111003; parallel: 60,000.00 SYP / 125 = 480.00 USD
        - { account: "111003", currency: SYP, amount: 6000000, book: 6000000, parallel: 48000 }
        # 60,000.00 of 60,000.00 open: all that remains, parallel 100,000 − 50,820 = 49,180
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -6000000, book: -6000000, parallel: -49180 }
        # parallel residual: 48,000 − 49,180 = −1,180 → realised loss 11.80 USD; book 0
        - { account: "541001", currency: USD, amount: 1180, book: 0, parallel: 1180 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    # parallel: 1,000.00 USD carried − (500.00 + 480.00) received = 20.00 USD
    - { account: "541001", book: 50000, parallel: 2000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: partial payments, a void after the second, and the payment again

The void of the first payment is its exact reversal: the item reopens by 400.00 USD at the 48,000.00 SYP that payment cleared, and the gain it posted is taken back. The new payment clears all that is open again, at the bulletin of its own date.

```yaml
case: a 1,000.00 USD invoice at 120; 400.00 USD at 123 and 600.00 USD at 123.5; the first voided on 26 November and paid again at 124
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: USD, amount: 40000, syp_per_usd: "124.0000",
               applied_amount: 40000, invoice_currency: USD }
  - event: payment.recorded
    accounting_date: 2026-11-25
    payload: { payment: PAY-2, receipt: R-2026-2, invoice: INV-2026-1, paid_on: 2026-11-25,
               method: bank_transfer, currency: USD, amount: 60000, syp_per_usd: "124.5000",
               applied_amount: 60000, invoice_currency: USD }
  - event: payment.voided
    accounting_date: 2026-11-26
    payload: { payment: PAY-1, voided_on: 2026-11-26 }
  - event: payment.recorded
    accounting_date: 2026-11-26
    payload: { payment: PAY-3, receipt: R-2026-3, invoice: INV-2026-1, paid_on: 2026-11-26,
               method: bank_transfer, currency: USD, amount: 40000, syp_per_usd: "125.0000",
               applied_amount: 40000, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # book: 400.00 USD × 123 = 49,200.00 SYP
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        # 400 of 1,000 open: book 12,000,000 × 4/10 = 4,800,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        # book residual: 4,920,000 − 4,800,000 = 120,000 → realised gain 1,200.00 SYP
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: payment.recorded
      date: 2026-11-25
      lines:
        # book: 600.00 USD × 123.5 = 74,100.00 SYP
        - { account: "111004", currency: USD, amount: 60000, book: 7410000, parallel: 60000 }
        # 600 of 600 open: all that remains, 12,000,000 − 4,800,000 = 7,200,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
        # book residual: 7,410,000 − 7,200,000 = 210,000 → realised gain 2,100.00 SYP
        - { account: "421001", currency: SYP, amount: -210000, book: -210000, parallel: 0 }
    - source: payment.voided
      date: 2026-11-26
      lines:
        # the exact negation of the 19 November entry; the item reopens by 400.00 USD at 48,000.00 SYP
        - { account: "111004", currency: USD, amount: -40000, book: -4920000, parallel: -40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        - { account: "421001", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
    - source: payment.recorded
      date: 2026-11-26
      lines:
        # book: 400.00 USD × 124 = 49,600.00 SYP
        - { account: "111004", currency: USD, amount: 40000, book: 4960000, parallel: 40000 }
        # 400 of 400 open: all that remains, 4,800,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        # book residual: 4,960,000 − 4,800,000 = 160,000 → realised gain 1,600.00 SYP
        - { account: "421001", currency: SYP, amount: -160000, book: -160000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    # book: 74,100.00 + 49,600.00 = 123,700.00 SYP held for 1,000.00 USD
    - { account: "111004", book: 12370000, parallel: 100000 }
    # book: −1,200.00 − 2,100.00 + 1,200.00 − 1,600.00 = −3,700.00 SYP
    - { account: "421001", book: -370000, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a payment beyond the open amount

The second payment applies 700.00 USD to an invoice with 600.00 USD open. It is held for the accountant, who posts the excess by hand to contract liabilities or another payable (IFRS 15.106); nothing posts, and the item keeps what it carries.

```yaml
case: 700.00 USD applied on an invoice with 600.00 USD open is held NEEDS_DECISION; the item keeps what it carries
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: USD, amount: 40000, syp_per_usd: "124.0000",
               applied_amount: 40000, invoice_currency: USD }
  - event: payment.recorded
    accounting_date: 2026-11-25
    payload: { payment: PAY-2, receipt: R-2026-2, invoice: INV-2026-1, paid_on: 2026-11-25,
               method: bank_transfer, currency: USD, amount: 70000, syp_per_usd: "124.5000",
               applied_amount: 70000, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
  outcome: { status: held, reason: NEEDS_DECISION, detail: payment_exceeds_open }
```

### Vertex Media: the tolerance on a payment in the other currency

The gap is measured in the invoice's currency: the payment's amount at Hub's `syp_per_usd`, rounded half away from zero, against the applied amount. A gap of exactly the tolerance (1.00, the default) is within it and posts as a realised difference; one minor unit more is held `NEEDS_DECISION` (`payment_gap_beyond_tolerance`), and nothing posts (S05 rule 9).

```yaml
case: 50,000.00 SYP at Hub's 124 applied as 402.23 USD, a gap of exactly 1.00 USD, posts with a parallel gain of 1.00 USD
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    # the gap: 5,000,000 / 124 = 40,322.58… → 40,323; 40,323 − 40,223 = 100 = 1.00 USD, not more than the tolerance
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: SYP, amount: 5000000, syp_per_usd: "124.0000",
               applied_amount: 40223, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # bank_transfer in SYP → 111003; parallel: 50,000.00 SYP / 124 = 403.2258… → 403.23 USD
        - { account: "111003", currency: SYP, amount: 5000000, book: 5000000, parallel: 40323 }
        # 402.23 of 1,000.00 open: book 12,000,000 × 40,223 / 100,000 = 4,826,760 exactly
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40223, book: -4826760, parallel: -40223 }
        # book residual: 5,000,000 − 4,826,760 = 173,240 → realised gain 1,732.40 SYP
        - { account: "421001", currency: SYP, amount: -173240, book: -173240, parallel: 0 }
        # parallel residual: 40,323 − 40,223 = 100 → realised gain 1.00 USD, the gap within the tolerance
        - { account: "421001", currency: USD, amount: -100, book: 0, parallel: -100 }
  balances:
    - { account: "421001", book: -173240, parallel: -100 }
  open_items:
    # 1,000.00 − 402.23 = 597.77 USD; book 12,000,000 − 4,826,760 = 7,173,240
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 59777, book: 7173240, parallel: 59777 }
```

```yaml
case: 50,000.00 SYP at Hub's 124 applied as 402.22 USD, a gap of 1.01 USD, is held NEEDS_DECISION
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    # the gap: 40,323 − 40,222 = 101 = 1.01 USD, more than the tolerance
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: SYP, amount: 5000000, syp_per_usd: "124.0000",
               applied_amount: 40222, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
  outcome: { status: held, reason: NEEDS_DECISION, detail: payment_gap_beyond_tolerance }
```

The tolerance is in the invoice's currency, so on an SYP invoice it is 1.00 SYP, and the gap may run either way: here Hub applies 1.01 SYP more than the USD received is worth at its rate.

```yaml
case: 500.00 USD at Hub's 124 applied as 62,001.01 SYP on an SYP invoice, a gap of 1.01 SYP, is held NEEDS_DECISION
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: SYP, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 12200000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    # the gap: 50,000 × 124 = 6,200,000; 6,200,000 − 6,200,101 = −101 = −1.01 SYP, more than the tolerance
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: cash, currency: USD, amount: 50000, syp_per_usd: "124.0000",
               applied_amount: 6200101, invoice_currency: SYP }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 12200000, book: 12200000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -12200000, book: -12200000, parallel: -100000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 12200000, book: 12200000, parallel: 100000 }
  outcome: { status: held, reason: NEEDS_DECISION, detail: payment_gap_beyond_tolerance }
```

### Vertex Media: a payment in the invoice's currency above its applied amount

No tolerance applies in one currency: a gap there is never an exchange difference (ADR 0007), so even 0.01 USD received beyond what Hub applied is an overpayment for the accountant (IFRS 15.106), held `NEEDS_DECISION` (`amount_above_applied`).

```yaml
case: 400.01 USD received in USD and applied as 400.00 USD is held NEEDS_DECISION
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: USD, amount: 40001, syp_per_usd: "124.0000",
               applied_amount: 40000, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
  outcome: { status: held, reason: NEEDS_DECISION, detail: amount_above_applied }
```

### Vertex Media: voiding an invoice that has a payment

```yaml
case: invoice.voided is held OPEN_ITEM_HAS_SETTLEMENTS while a payment on the invoice stands
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: USD, amount: 40000, syp_per_usd: "124.0000",
               applied_amount: 40000, invoice_currency: USD }
  - event: invoice.voided
    accounting_date: 2026-11-24
    payload: { invoice: INV-2026-1, voided_on: 2026-11-24, reason: "أُلغيت الفاتورة في Hub" }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
  outcome: { status: held, reason: OPEN_ITEM_HAS_SETTLEMENTS }
```

Hub voids the payment first, then the invoice: each void is the exact reversal of its entry, dated on the void date, so every account and the item come back to zero and no rate is read on 24 November.

```yaml
case: the payment voided, then the invoice; every account and the item back to zero
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: USD, amount: 40000, syp_per_usd: "124.0000",
               applied_amount: 40000, invoice_currency: USD }
  - event: payment.voided
    accounting_date: 2026-11-24
    payload: { payment: PAY-1, voided_on: 2026-11-24 }
  - event: invoice.voided
    accounting_date: 2026-11-24
    payload: { invoice: INV-2026-1, voided_on: 2026-11-24, reason: "أُلغيت الفاتورة في Hub" }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: payment.voided
      date: 2026-11-24
      lines:
        - { account: "111004", currency: USD, amount: -40000, book: -4920000, parallel: -40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        - { account: "421001", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
    - source: invoice.voided
      date: 2026-11-24
      lines:
        # the exact negation of the issue entry: the revenue is taken back on the void date
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

When the invoice's void arrives before its payment's void, it is held `OPEN_ITEM_HAS_SETTLEMENTS`; the payment's void does not wait behind it (S05 rule 11), and once it posts the held void is retried and posts by itself (rule 10). Each keeps its own date: the payment's void on 24 November, the invoice's on 25 November, so the entries end the same as when Hub's order is kept, and no rate is read for either date.

```yaml
case: the invoice's void received before its payment's void is held, then posts by itself once the payment's void posts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: USD, amount: 40000, syp_per_usd: "124.0000",
               applied_amount: 40000, invoice_currency: USD }
  - event: invoice.voided
    accounting_date: 2026-11-25
    payload: { invoice: INV-2026-1, voided_on: 2026-11-25, reason: "أُلغيت الفاتورة في Hub" }
    outcome: { status: held, reason: OPEN_ITEM_HAS_SETTLEMENTS }
  - event: payment.voided
    accounting_date: 2026-11-24
    payload: { payment: PAY-1, voided_on: 2026-11-24 }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: payment.voided
      date: 2026-11-24
      lines:
        # the exact negation of the payment's entry
        - { account: "111004", currency: USD, amount: -40000, book: -4920000, parallel: -40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        - { account: "421001", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
    - source: invoice.voided
      date: 2026-11-25
      lines:
        # posted by the retry, after the payment's void; the exact negation of the issue entry on its own date
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: two payments received before their invoice

The first payment names an invoice Mizan has not received: held `UNKNOWN_REFERENCE`. The second waits behind it on the invoice's key: held `WAITING_FOR_EARLIER_EVENT`. The invoice does not wait behind them (S05 rule 11): it posts, then the payments are retried in received order, each at the rates of its own date. The entries are those of "an SYP invoice paid first in USD, then in SYP" above, in the same posting order, so the order of arrival changes nothing.

```yaml
case: two payments received before their invoice are held, then post in order after it; the entries are those of Hub's order
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: cash, currency: USD, amount: 50000, syp_per_usd: "124.0000",
               applied_amount: 6200000, invoice_currency: SYP }
    outcome: { status: held, reason: UNKNOWN_REFERENCE }
  - event: payment.recorded
    accounting_date: 2026-11-25
    payload: { payment: PAY-2, receipt: R-2026-2, invoice: INV-2026-1, paid_on: 2026-11-25,
               method: bank_transfer, currency: SYP, amount: 6000000, syp_per_usd: "125.0000",
               applied_amount: 6000000, invoice_currency: SYP }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: SYP, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 12200000, source: extra_work, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 12200000, book: 12200000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -12200000, book: -12200000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # retried first: cash in USD → 111002 at the bulletin of 19 November, 123
        - { account: "111002", currency: USD, amount: 50000, book: 6150000, parallel: 50000 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -6200000, book: -6200000, parallel: -50820 }
        - { account: "541001", currency: SYP, amount: 50000, book: 50000, parallel: 0 }
        - { account: "541001", currency: USD, amount: 820, book: 0, parallel: 820 }
    - source: payment.recorded
      date: 2026-11-25
      lines:
        # retried once the first leaves held: all that remains, parallel 100,000 − 50,820 = 49,180
        - { account: "111003", currency: SYP, amount: 6000000, book: 6000000, parallel: 48000 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -6000000, book: -6000000, parallel: -49180 }
        - { account: "541001", currency: USD, amount: 1180, book: 0, parallel: 1180 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "541001", book: 50000, parallel: 2000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a due date changed in Hub

The change records the item's new due date for ageing (S04 rule 15) and posts nothing; the item keeps what it carries. Its effect on the ageing is tested with S05's code, since the format states no due date.

```yaml
case: invoice.due_date_changed posts nothing; the item is unchanged
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: invoice.due_date_changed
    accounting_date: 2026-11-24
    payload: { invoice: INV-2026-1, due_on: 2026-12-20 }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
```

### SYP books only

With no parallel ledger, Hub's `syp_per_usd` measures nothing: the USD invoice takes the bulletin, the SYP cash its own amount. It is still read to check the payment's gap against the tolerance: 123,000.00 SYP / 123 = 1,000.00 USD, the applied amount, so there is no gap.

```yaml
case: SYP books only; a 1,000.00 USD invoice at 120 paid with 123,000.00 SYP applied as 1,000.00 USD; a gain of 3,000.00 SYP
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: cash, currency: SYP, amount: 12300000, syp_per_usd: "123.0000",
               applied_amount: 100000, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 1,000.00 USD × 120 = 120,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # cash in SYP → 111001
        - { account: "111001", currency: SYP, amount: 12300000, book: 12300000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000 }
        # residual: 12,300,000 − 12,000,000 = 300,000 → realised gain 3,000.00 SYP
        - { account: "421001", currency: SYP, amount: -300000, book: -300000 }
  balances:
    - { account: "112001", book: 0 }
    - { account: "421001", book: -300000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0 }
```

### USD books with an SYP parallel ledger

The SYP parallel ledger accepts the transaction's rate, so it measures the USD invoice at Hub's 122 and takes the SYP cash as is; the USD books measure the SYP cash at the bulletin. Each ledger posts its own difference.

```yaml
case: USD books; a 1,000.00 USD invoice at Hub's 122 paid with 124,000.00 SYP at bulletin 123; a gain in both ledgers
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: SYP, amount: 12400000, syp_per_usd: "124.0000",
               applied_amount: 100000, invoice_currency: USD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # book: USD as is; parallel: 1,000.00 USD × 122 (Hub's rate) = 122,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 100000, parallel: 12200000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -100000, parallel: -12200000 }
    - source: payment.recorded
      date: 2026-11-19
      lines:
        # bank_transfer in SYP → 111003; book: 124,000.00 SYP / 123 (bulletin) = 1,008.1300… → 1,008.13 USD
        - { account: "111003", currency: SYP, amount: 12400000, book: 100813, parallel: 12400000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -100000, parallel: -12200000 }
        # book residual: 100,813 − 100,000 = 813 → realised gain 8.13 USD
        - { account: "421001", currency: USD, amount: -813, book: -813, parallel: 0 }
        # parallel residual: 12,400,000 − 12,200,000 = 200,000 → realised gain 2,000.00 SYP
        - { account: "421001", currency: SYP, amount: -200000, book: 0, parallel: -200000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "421001", book: -813, parallel: -200000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```
