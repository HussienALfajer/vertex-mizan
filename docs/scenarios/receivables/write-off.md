# Writing off a receivable

Status: Proposed

The expected entries await the owner's approval. Once approved, the cases stay `Proposed` until S04 brings their executors: the manual line's item fields, the item lines of the posting function, the open-item reader, and a setup that creates the dimension values a case names (client `C1`, service `S1`).

## Rule

A write-off is a manual entry on two lines and the difference. The line on the receivable control account names the item and clears it at its carrying amount in each ledger, in proportion to what remains as any clearing does (S04 rule 4). The debit goes to the expense account the accountant picks, in the item's currency and for the same transaction amount; it is a new measurement at each ledger's policy rate on the write-off date. Each ledger's residual, rounding included, posts in that ledger only as a realised exchange difference: a credit to `fx_realised_gain`, a debit to `fx_realised_loss`. So the item is remeasured to the spot rate of the write-off date, then derecognised, and the expense equals the amount written off at that rate. A reversal negates every line exactly and reopens the item at what it carried before. Writing off more than is open is refused (`RELEASE_EXCEEDS_BALANCE`).

## Basis

- **IFRS 9.5.4.4:** an entity directly reduces the gross carrying amount of a financial asset when it has no reasonable expectations of recovering it, in whole or in part; a write-off is a derecognition event (IFRS 9.B3.2.16(r)). Phase 1 keeps no expected-credit-loss allowance (IFRS 9.5.5 is out of scope, S04), so the write-off clears the item directly to an expense.
- **IAS 21.23(a) and 21.28:** a foreign-currency monetary item is translated at the closing rate at the end of each period and is not converted again on settlement; on derecognition, the gap between what the item carried and its amount at the rate of the write-off date is a realised exchange difference in profit or loss, in each ledger separately. **IAS 21.21–22:** the expense is recorded at the spot rate of its date: the bulletin of the day for the book ledger (S02 rule 16), the market rate for Vertex Media's parallel ledger.
- **ADR 0005:** posted entries are append-only and a correction is a reversal, so a write-off made in error is reversed, never edited.
- **Company policy:** `phase-1-scope.md` §4 (book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and F06; ADR 0007 "Carrying amount" and "Exchange residuals"; ADR 0013 "Write-off" (owner, 2026-10-28); S04 rules 4, 7, 10, 11 and 13 (owner, 2026-10-28).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. Whether a written-off debt is deductible for income tax is not decided here and no case depends on it.

## Cases

The account codes are the service-agency template's (S02): the SYP and USD bank accounts `111003` and `111004`, trade receivables `112001` (a `document` control account, client required), service revenue `411001` (client and service required), realised exchange gains `421001` and losses `541001`. The template has no account for written-off receivables, and the statement-line catalogue no line for impairment losses (IAS 1.82(ba); S04 "Open questions", for the templates' review, Q3), so every case adds `532005` "ديون معدومة مشطوبة" (Bad debts written off) under the administrative expenses `532`, on `is.other_expenses`, with no currency restriction. Every rate and amount is synthetic. Tuesday 3, Tuesday 10, Thursday 19 and Wednesday 25 November 2026 are publication days.

A manual line opens an item with `open_item: { ref, due? }` and moves one with `item: <ref>`; it then takes the item's dimensions, so it states none (S04 rules 6–7). The expense line carries no dimension: `532005` requires none. A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007).

The cases leave out what other scenarios or later specs own: a write-off of a Hub item, which needs a line memo and is marked "معدّل في ميزان" (S04 rule 8; `receivables/hub-payment.md`, S05); a write-off dated in a closed period and one after a month-end revaluation, added with S07's jobs.

### Vertex Media: a USD item written off whole as the bulletin rises

The S04 example. The item carries 120,000.00 SYP at bulletin 120 and is written off at 123: the expense is 123,000.00 SYP, and the 3,000.00 SYP between them is a realised gain. Profit or loss falls by 120,000.00 SYP in all, what the item carried.

```yaml
case: a 1,000.00 USD item at bulletin 120 written off on 19 November at 123; a book gain of 3,000.00 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: write-off of M-1
    accounting_date: 2026-11-19
    payload: { description: "شطب دين غير قابل للتحصيل",
               lines: [{ account: "532005", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: 1,000.00 USD × 120 = 120,000.00 SYP; parallel: USD as is
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-19
      lines:
        # a new measurement: 1,000.00 USD × 123 = 123,000.00 SYP
        - { account: "532005", currency: USD, amount: 100000, book: 12300000, parallel: 100000 }
        # all that is open, at what the item carries
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        # book residual: 12,300,000 − 12,000,000 = 300,000 → a credit: realised gain 3,000.00 SYP; parallel 0
        - { account: "421001", currency: SYP, amount: -300000, book: -300000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "532005", book: 12300000, parallel: 100000 }
    - { account: "421001", book: -300000, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a USD item written off as the bulletin falls

```yaml
case: a 1,000.00 USD item at bulletin 123 written off on 25 November at 121.5; a book loss of 1,500.00 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-19 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: write-off of M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "532005", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-19
      lines:
        # book: 1,000.00 USD × 123 = 123,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12300000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12300000, parallel: -100000 }
    - source: manual
      date: 2026-11-25
      lines:
        # a new measurement: 1,000.00 USD × 121.5 = 121,500.00 SYP
        - { account: "532005", currency: USD, amount: 100000, book: 12150000, parallel: 100000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12300000, parallel: -100000 }
        # book residual: 12,150,000 − 12,300,000 = −150,000 → a debit: realised loss 1,500.00 SYP
        - { account: "541001", currency: SYP, amount: 150000, book: 150000, parallel: 0 }
  balances:
    - { account: "532005", book: 12150000, parallel: 100000 }
    - { account: "541001", book: 150000, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a partial receipt, then the rest written off

The write-off clears all that remains after the receipt, so it takes everything the item still carries in each ledger.

```yaml
case: 400.00 USD received on a 1,000.00 USD item at 123; the remaining 600.00 written off at 123.5
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: receipt on M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
  - manual: write-off of what remains on M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "532005", currency: USD, amount: 60000 },
                       { account: "112001", currency: USD, amount: -60000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-19
      lines:
        # book: 400.00 USD × 123 = 49,200.00 SYP
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        # 400 of 1,000 open: 12,000,000 × 4/10 = 4,800,000; 100,000 × 4/10 = 40,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        # book residual: 4,920,000 − 4,800,000 = 120,000 → realised gain 1,200.00 SYP
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: manual
      date: 2026-11-25
      lines:
        # a new measurement: 600.00 USD × 123.5 = 74,100.00 SYP
        - { account: "532005", currency: USD, amount: 60000, book: 7410000, parallel: 60000 }
        # 600 of 600 open: all that remains, 12,000,000 − 4,800,000 = 7,200,000; 100,000 − 40,000 = 60,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
        # book residual: 7,410,000 − 7,200,000 = 210,000 → realised gain 2,100.00 SYP
        - { account: "421001", currency: SYP, amount: -210000, book: -210000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "532005", book: 7410000, parallel: 60000 }
    # 120,000 + 210,000
    - { account: "421001", book: -330000, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a third written off, the rest received

A partial write-off clears its share of what the item carries, rounded half away from zero; the receipt that follows clears all that remains.

```yaml
case: 333.33 USD of a 1,000.00 USD item at 120.5 written off at 123; the remaining 666.67 received at 123.5
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.5000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: write-off of a part of M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "532005", currency: USD, amount: 33333 },
                       { account: "112001", currency: USD, amount: -33333, item: M-1 }] }
  - manual: receipt of what remains on M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111004", currency: USD, amount: 66667 },
                       { account: "112001", currency: USD, amount: -66667, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: 1,000.00 USD × 120.5 = 120,500.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12050000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12050000, parallel: -100000 }
    - source: manual
      date: 2026-11-19
      lines:
        # a new measurement: 333.33 USD × 123 = 40,999.59 SYP
        - { account: "532005", currency: USD, amount: 33333, book: 4099959, parallel: 33333 }
        # 333.33 of 1,000.00 open: book 12,050,000 × 33,333/100,000 = 4,016,626.5 → 4,016,627 (half away from zero)
        #                          parallel 100,000 × 33,333/100,000 = 33,333
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -33333, book: -4016627, parallel: -33333 }
        # book residual: 4,099,959 − 4,016,627 = 83,332 → realised gain 833.32 SYP
        - { account: "421001", currency: SYP, amount: -83332, book: -83332, parallel: 0 }
    - source: manual
      date: 2026-11-25
      lines:
        # book: 666.67 USD × 123.5 = 82,333.745 → 82,333.75 SYP (half away from zero)
        - { account: "111004", currency: USD, amount: 66667, book: 8233375, parallel: 66667 }
        # 666.67 of 666.67 open: all that remains, 12,050,000 − 4,016,627 = 8,033,373; 100,000 − 33,333 = 66,667
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -66667, book: -8033373, parallel: -66667 }
        # book residual: 8,233,375 − 8,033,373 = 200,002 → realised gain 2,000.02 SYP
        - { account: "421001", currency: SYP, amount: -200002, book: -200002, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "532005", book: 4099959, parallel: 33333 }
    # 83,332 + 200,002
    - { account: "421001", book: -283334, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a write-off made in error, reversed, then the item received

The client pays after the item was written off in error. The write-off is reversed (ADR 0005): the reversal negates each of its lines, the expense and the gain included, and reopens the item at the 120,000.00 SYP it carried. The receipt then settles it like any other, with its own difference. The reversal reads no rate.

```yaml
case: M-1 written off on 19 November at 123; the write-off reversed on 25 November and 1,000.00 USD received at 123.5
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: write-off of M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "532005", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
  - reversal: 2
    accounting_date: 2026-11-25
  - manual: receipt on M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111004", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-19
      lines:
        - { account: "532005", currency: USD, amount: 100000, book: 12300000, parallel: 100000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        - { account: "421001", currency: SYP, amount: -300000, book: -300000, parallel: 0 }
    - source: reversal
      date: 2026-11-25
      lines:
        # the exact negation of entry 2; the item moves back to 1,000.00 USD, 120,000.00 SYP
        - { account: "532005", currency: USD, amount: -100000, book: -12300000, parallel: -100000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "421001", currency: SYP, amount: 300000, book: 300000, parallel: 0 }
    - source: manual
      date: 2026-11-25
      lines:
        # book: 1,000.00 USD × 123.5 = 123,500.00 SYP
        - { account: "111004", currency: USD, amount: 100000, book: 12350000, parallel: 100000 }
        # all that is open again, at what the item carries
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        # book residual: 12,350,000 − 12,000,000 = 350,000 → realised gain 3,500.00 SYP
        - { account: "421001", currency: SYP, amount: -350000, book: -350000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "532005", book: 0, parallel: 0 }
    # −300,000 + 300,000 − 350,000
    - { account: "421001", book: -350000, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: writing off more than is open

```yaml
case: 500.00 USD written off on M-1 with 400.00 open is refused; the item keeps what it carries
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: receipt on M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 60000 },
                       { account: "112001", currency: USD, amount: -60000, item: M-1 }] }
  - manual: a write-off beyond what is open
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "532005", currency: USD, amount: 50000 },
                       { account: "112001", currency: USD, amount: -50000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-19
      lines:
        # book: 600.00 USD × 123 = 73,800.00 SYP; 600 of 1,000 open: 12,000,000 × 6/10 = 7,200,000
        - { account: "111004", currency: USD, amount: 60000, book: 7380000, parallel: 60000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
        - { account: "421001", currency: SYP, amount: -180000, book: -180000, parallel: 0 }
  balances:
    - { account: "532005", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
  outcome: { status: refused, reason: RELEASE_EXCEEDS_BALANCE }
```

### Vertex Media: an SYP item written off, a difference in the parallel ledger only

An SYP item carries its parallel amount at the market rate of its date. The write-off measures the SYP expense at the market rate of its own date, so the book ledger has no difference and the parallel ledger has one.

```yaml
case: a 100,000.00 SYP item at market 121 written off on 25 November at market 124; a parallel loss of 20.00 USD
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "121.0000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "124.0000", type: market }
steps:
  - manual: invoice M-1 to client C1, in SYP
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 10000000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -10000000 }] }
  - manual: write-off of M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "532005", currency: SYP, amount: 10000000 },
                       { account: "112001", currency: SYP, amount: -10000000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # parallel: 100,000.00 SYP / 121 = 826.4462… → 826.45 USD
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 10000000, book: 10000000, parallel: 82645 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -10000000, book: -10000000, parallel: -82645 }
    - source: manual
      date: 2026-11-25
      lines:
        # parallel: 100,000.00 SYP / 124 = 806.4516… → 806.45 USD
        - { account: "532005", currency: SYP, amount: 10000000, book: 10000000, parallel: 80645 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -10000000, book: -10000000, parallel: -82645 }
        # parallel residual: 80,645 − 82,645 = −2,000 → realised loss 20.00 USD; book residual 0
        - { account: "541001", currency: USD, amount: 2000, book: 0, parallel: 2000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "532005", book: 10000000, parallel: 80645 }
    - { account: "541001", book: 0, parallel: 2000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
```

### SYP books only

A USD item written off posts a book difference; an SYP item written off posts none.

```yaml
case: SYP books only; the S04 example, a 1,000.00 USD item at 120 written off at 123
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: write-off of M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "532005", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000 }
    - source: manual
      date: 2026-11-19
      lines:
        # 1,000.00 USD × 123 = 123,000.00 SYP; the item clears its 120,000.00; residual 300,000 → gain
        - { account: "532005", currency: USD, amount: 100000, book: 12300000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000 }
        - { account: "421001", currency: SYP, amount: -300000, book: -300000 }
  balances:
    - { account: "112001", book: 0 }
    - { account: "532005", book: 12300000 }
    - { account: "421001", book: -300000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0 }
```

```yaml
case: SYP books only; 50,000.00 SYP received on a 120,000.00 SYP item, the remaining 70,000.00 written off
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
steps:
  - manual: invoice M-1 to client C1, in SYP
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 12000000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -12000000 }] }
  - manual: receipt on M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111003", currency: SYP, amount: 5000000 },
                       { account: "112001", currency: SYP, amount: -5000000, item: M-1 }] }
  - manual: write-off of what remains on M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "532005", currency: SYP, amount: 7000000 },
                       { account: "112001", currency: SYP, amount: -7000000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 12000000, book: 12000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -12000000, book: -12000000 }
    - source: manual
      date: 2026-11-19
      lines:
        - { account: "111003", currency: SYP, amount: 5000000, book: 5000000 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -5000000, book: -5000000 }
    - source: manual
      date: 2026-11-25
      lines:
        # in the book currency the expense is the amount itself and the item clears what remains; residual 0
        - { account: "532005", currency: SYP, amount: 7000000, book: 7000000 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -7000000, book: -7000000 }
  balances:
    - { account: "112001", book: 0 }
    - { account: "532005", book: 7000000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 0 }
```

### USD books with an SYP parallel ledger

A USD item is in the book currency, so the book ledger has no difference; the SYP parallel ledger, at the market rate, has one.

```yaml
case: USD books; a 1,000.00 USD item at market 121 written off at market 124; a parallel gain of 3,000.00 SYP
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "121.0000", type: market }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "124.0000", type: market }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: write-off of M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "532005", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # parallel: 1,000.00 USD × 121 (market) = 121,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 100000, parallel: 12100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -100000, parallel: -12100000 }
    - source: manual
      date: 2026-11-19
      lines:
        # parallel: 1,000.00 USD × 124 = 124,000.00 SYP
        - { account: "532005", currency: USD, amount: 100000, book: 100000, parallel: 12400000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -100000, parallel: -12100000 }
        # parallel residual: 12,400,000 − 12,100,000 = 300,000 → realised gain 3,000.00 SYP; book residual 0
        - { account: "421001", currency: SYP, amount: -300000, book: 0, parallel: -300000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "532005", book: 100000, parallel: 12400000 }
    - { account: "421001", book: 0, parallel: -300000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### A third currency: a TRY item written off

Book SYP at the bulletin, crossed through USD; the USD parallel ledger at the market TRY rate. The lira weakens between the invoice and the write-off, so each ledger posts a loss.

```yaml
case: a 41,000.00 TRY item written off on 25 November as the lira weakens; a loss in both ledgers
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "532005", name: "ديون معدومة مشطوبة", name_latin: "Bad debts written off",
                        statement_line: is.other_expenses }] }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: TRY, rate: "41.8000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: TRY, rate: "42.0000", type: market }
steps:
  - manual: invoice M-1 to client C1, in TRY
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: TRY, amount: 4100000,
                         open_item: { ref: M-1, due: 2026-12-10 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: TRY, amount: -4100000 }] }
  - manual: write-off of M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "532005", currency: TRY, amount: 4100000 },
                       { account: "112001", currency: TRY, amount: -4100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-10
      lines:
        # book: 41,000.00 TRY / 41 × 122 = 122,000.00 SYP
        # parallel: 41,000.00 TRY / 41.2 (market) = 995.1456… → 995.15 USD
        - { account: "112001", dims: { client: C1 }, currency: TRY, amount: 4100000, book: 12200000, parallel: 99515 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: TRY, amount: -4100000, book: -12200000, parallel: -99515 }
    - source: manual
      date: 2026-11-25
      lines:
        # book: 41,000.00 TRY / 41.8 × 123.5 (one exact product) = 121,136.3636… → 121,136.36 SYP
        # parallel: 41,000.00 TRY / 42 = 976.1904… → 976.19 USD
        - { account: "532005", currency: TRY, amount: 4100000, book: 12113636, parallel: 97619 }
        - { account: "112001", dims: { client: C1 }, currency: TRY, amount: -4100000, book: -12200000, parallel: -99515 }
        # book residual: 12,113,636 − 12,200,000 = −86,364 → realised loss 863.64 SYP
        - { account: "541001", currency: SYP, amount: 86364, book: 86364, parallel: 0 }
        # parallel residual: 97,619 − 99,515 = −1,896 → realised loss 18.96 USD
        - { account: "541001", currency: USD, amount: 1896, book: 0, parallel: 1896 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "532005", book: 12113636, parallel: 97619 }
    - { account: "541001", book: 86364, parallel: 1896 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: TRY, amount: 0, book: 0, parallel: 0 }
```
