# Settling a receivable by manual entry

Status: Proposed

The expected entries were approved by the owner on 2026-11-06, with an overpayment's excess posted to other payables `211003` and an opening reversible once every settlement on its item is reversed. The cases stay `Proposed` until S04 brings their executors: the manual line's item fields, the item lines of the posting function, the open-item reader, and a setup that creates the dimension values a case names (client `C1`, service `S1`).

## Rule

A manual line on a receivable control account names its document item. The line that opens an item measures it anew at each ledger's policy rate on the entry date. A line that clears part of an item takes, in each ledger, the item's carrying amount in proportion to the transaction amount cleared over the amount still open, rounded half away from zero. The line that clears all that is open takes everything left in each ledger. Cash and any other new line are measured anew, at the policy rate or at the dealt rate for a market ledger that accepts it. Each ledger's residual, rounding included, posts in that ledger only as a realised exchange difference: a credit to `fx_realised_gain`, a debit to `fx_realised_loss`. A reversal negates every line exactly and reopens the item at what it had. Clearing more than is open is refused (`RELEASE_EXCEEDS_BALANCE`), and so is reversing an opening while settlements on the item stand (`OPEN_ITEM_HAS_SETTLEMENTS`). A movement against a client's running ad-funds item clears at its average, and one that crosses zero is split at zero, with the excess measured anew.

## Basis

- **IAS 21.21–22:** the opening, cash and every other new line are recorded at the spot rate of their date: the bulletin of the day for the book ledger (S02 rule 16), the market rate or the rate dealt at for Vertex Media's parallel ledger.
- **IAS 21.23(b) and 21.28:** a receivable is not converted again when it is settled. The gap between what was received, at the rate of its date, and what the item carried is a realised exchange difference in profit or loss of the period, in each ledger separately.
- **IFRS 9.3.2.3(a):** the receivable is derecognised, in whole or in part, when the right to its cash flows is settled. **IFRS 15.106 and IAS 1.32:** an amount paid beyond what is open is a liability, never a credit balance on the client's receivable, and balances of different clients are never offset.
- **Company policy:** `phase-1-scope.md` §4 (book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and F06; ADR 0007 "Carrying amount" and "Exchange residuals"; ADR 0013 (settlement in proportion to what remains; manual movements; a document item never crosses zero; residuals of entries with carried lines; owner, 2026-10-28); S04 rules 2–13 (owner, 2026-10-28).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes are the service-agency template's (S02): the SYP and USD bank accounts `111003` and `111004`, trade receivables `112001` (a `document` control account, client required), other payables `211003`, client ad funds held `213001` (a `running` control account, USD only, client required), service revenue `411001` (client and service required), realised exchange gains `421001` and losses `541001`. A `third` case adds a TRY cash account `111007` to the template (monetary, restricted to TRY, statement line `bs.cash`). Every rate and amount is synthetic. Tuesday 3, Tuesday 10, Thursday 19, Tuesday 24, Wednesday 25 and Thursday 26 November 2026 are publication days.

A manual line opens an item with `open_item: { ref, due? }` and moves one with `item: <ref>`; it then takes the item's dimensions, so it states none. A line on `213001` names the client and the running item is found or made (S04 rules 6–9). A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007).

The cases leave out what other scenarios or later specs own: a write-off (`receivables/write-off.md`); Hub's payments (`receivables/hub-payment.md`, S05) and ad-fund movements (`ad-funds/running-balance.md`, S05); a settlement dated in a closed period and one after a month-end revaluation, added with S07's jobs.

### Vertex Media: a USD invoice settled in two receipts, in USD and in SYP

The S04 example. Neither settlement reads a rate for the item: it clears 400/1,000 of what it carries, then all that remains. The 25 November bulletin is not read either, since the SYP cash line is in the book currency.

```yaml
case: a 1,000.00 USD invoice at bulletin 120; 400.00 USD received at 123, then 74,400.00 SYP for the remaining 600.00
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "124.0000", type: market }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: first receipt on M-1, in USD
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
  - manual: final receipt on M-1, in SYP
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111003", currency: SYP, amount: 7440000 },
                       { account: "112001", currency: USD, amount: -60000, item: M-1 }] }
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
        # book: 400.00 USD × 123 = 49,200.00 SYP
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        # 400 of 1,000 open: book 12,000,000 × 400/1,000 = 4,800,000; parallel 100,000 × 400/1,000 = 40,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        # book residual: 4,920,000 − 4,800,000 = 120,000 → a credit: realised gain 1,200.00 SYP
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: manual
      date: 2026-11-25
      lines:
        # parallel: 74,400.00 SYP / 124 (market) = 600.00 USD
        - { account: "111003", currency: SYP, amount: 7440000, book: 7440000, parallel: 60000 }
        # 600 of 600 open: all that remains, 12,000,000 − 4,800,000 = 7,200,000; 100,000 − 40,000 = 60,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
        # book residual: 7,440,000 − 7,200,000 = 240,000 → realised gain 2,400.00 SYP; parallel residual 0
        - { account: "421001", currency: SYP, amount: -240000, book: -240000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "421001", book: -360000, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a receipt at a dealt rate

```yaml
case: a 1,000.00 USD invoice at 120 settled by 124,000.00 SYP dealt at 124; a book gain only
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "124.5000", type: market }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: receipt on M-1 in SYP at the rate dealt with the client
    accounting_date: 2026-11-25
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "124.0000" }],
               lines: [{ account: "111003", currency: SYP, amount: 12400000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-25
      lines:
        # parallel: 124,000.00 SYP / 124 (dealt) = 1,000.00 USD; the market's 124.5 is not read
        - { account: "111003", currency: SYP, amount: 12400000, book: 12400000, parallel: 100000 }
        # all that is open, at what the item carries; the dealt rate is not read for it
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        # book residual: 12,400,000 − 12,000,000 = 400,000 → realised gain 4,000.00 SYP; parallel residual 0
        - { account: "421001", currency: SYP, amount: -400000, book: -400000, parallel: 0 }
  balances:
    - { account: "421001", book: -400000, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

```yaml
case: the same receipt with no dealt rate; the parallel ledger takes the market rate and posts a loss
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "124.5000", type: market }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: receipt on M-1 in SYP
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111003", currency: SYP, amount: 12400000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-25
      lines:
        # parallel: 124,000.00 SYP / 124.5 (market) = 995.9839… → 995.98 USD
        - { account: "111003", currency: SYP, amount: 12400000, book: 12400000, parallel: 99598 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        # book residual: 12,400,000 − 12,000,000 = 400,000 → realised gain 4,000.00 SYP
        - { account: "421001", currency: SYP, amount: -400000, book: -400000, parallel: 0 }
        # parallel residual: 99,598 − 100,000 = −402 → a debit: realised loss 4.02 USD
        - { account: "541001", currency: USD, amount: 402, book: 0, parallel: 402 }
  balances:
    - { account: "421001", book: -400000, parallel: 0 }
    - { account: "541001", book: 0, parallel: 402 }
```

### Vertex Media: two invoices cleared by one receipt

Each item clears at what it carries; the entry posts one difference line per ledger (S04 edge case 8).

```yaml
case: invoices M-1 (1,000.00 USD at 120) and M-2 (500.00 USD at 122) cleared by one 1,500.00 USD receipt at 123
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: invoice M-2 to client C1, with no due date
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 50000,
                         open_item: { ref: M-2 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -50000 }] }
  - manual: one receipt for M-1 and M-2
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 150000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 },
                       { account: "112001", currency: USD, amount: -50000, item: M-2 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-10
      lines:
        # book: 500.00 USD × 122 = 61,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 50000, book: 6100000, parallel: 50000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -50000, book: -6100000, parallel: -50000 }
    - source: manual
      date: 2026-11-19
      lines:
        # book: 1,500.00 USD × 123 = 184,500.00 SYP
        - { account: "111004", currency: USD, amount: 150000, book: 18450000, parallel: 150000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -50000, book: -6100000, parallel: -50000 }
        # book residual: 18,450,000 − 12,000,000 − 6,100,000 = 350,000 → one gain line of 3,500.00 SYP
        - { account: "421001", currency: SYP, amount: -350000, book: -350000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: M-2, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: the first receipt voided after the second, then received again

The S04 example continued (ADR 0013). The void reopens 400.00 USD at exactly the 48,000.00 SYP it cleared, and the next receipt of 400.00 clears exactly that.

```yaml
case: M-1 settled in two receipts; the first voided on 26 November and received again the same day at 124
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "124.0000", type: market }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: first receipt on M-1, in USD
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
  - manual: final receipt on M-1, in SYP
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111003", currency: SYP, amount: 7440000 },
                       { account: "112001", currency: USD, amount: -60000, item: M-1 }] }
  - reversal: 2
    accounting_date: 2026-11-26
  - manual: the first receipt received again
    accounting_date: 2026-11-26
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
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
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: manual
      date: 2026-11-25
      lines:
        - { account: "111003", currency: SYP, amount: 7440000, book: 7440000, parallel: 60000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
        - { account: "421001", currency: SYP, amount: -240000, book: -240000, parallel: 0 }
    - source: reversal
      date: 2026-11-26
      lines:
        # entry 2 negated: M-1 reopens at 400.00 USD, 48,000.00 SYP, 400.00 USD; no rate is read
        - { account: "111004", currency: USD, amount: -40000, book: -4920000, parallel: -40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        - { account: "421001", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
    - source: manual
      date: 2026-11-26
      lines:
        # book: 400.00 USD × 124 = 49,600.00 SYP
        - { account: "111004", currency: USD, amount: 40000, book: 4960000, parallel: 40000 }
        # 400 of 400 open: all that remains, exactly the 4,800,000 the void put back
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        # book residual: 4,960,000 − 4,800,000 = 160,000 → realised gain 1,600.00 SYP
        - { account: "421001", currency: SYP, amount: -160000, book: -160000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    # −120,000 − 240,000 + 120,000 − 160,000
    - { account: "421001", book: -400000, parallel: 0 }
    - { account: "111004", currency: USD, amount: 40000, book: 4960000, parallel: 40000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: an SYP invoice with halves in the parallel ledger, a void between receipts

An SYP item carries its parallel amount at the market rate of its date. The two partial clearings each round a half away from zero. After the void, the last receipt clears all that remains, so the item ends at zero in every ledger (ADR 0013).

```yaml
case: a 100,000.00 SYP invoice; 30,000.00 and 35,000.00 SYP received; the first voided; 65,000.00 SYP received
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "121.0000", type: market }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: market }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "124.0000", type: market }
steps:
  - manual: invoice M-1 to client C1, in SYP
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 10000000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -10000000 }] }
  - manual: first receipt on M-1
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "111003", currency: SYP, amount: 3000000 },
                       { account: "112001", currency: SYP, amount: -3000000, item: M-1 }] }
  - manual: second receipt on M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111003", currency: SYP, amount: 3500000 },
                       { account: "112001", currency: SYP, amount: -3500000, item: M-1 }] }
  - reversal: 2
    accounting_date: 2026-11-24
  - manual: final receipt on M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111003", currency: SYP, amount: 6500000 },
                       { account: "112001", currency: SYP, amount: -6500000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # parallel: 100,000.00 SYP / 121 = 826.4462… → 826.45 USD
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 10000000, book: 10000000, parallel: 82645 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -10000000, book: -10000000, parallel: -82645 }
    - source: manual
      date: 2026-11-10
      lines:
        # parallel: 30,000.00 SYP / 122 = 245.9016… → 245.90 USD
        - { account: "111003", currency: SYP, amount: 3000000, book: 3000000, parallel: 24590 }
        # 30,000 of 100,000 open: parallel 82,645 × 3/10 = 24,793.5 → 24,794 (half away from zero)
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -3000000, book: -3000000, parallel: -24794 }
        # parallel residual: 24,590 − 24,794 = −204 → realised loss 2.04 USD; book residual 0
        - { account: "541001", currency: USD, amount: 204, book: 0, parallel: 204 }
    - source: manual
      date: 2026-11-19
      lines:
        # parallel: 35,000.00 SYP / 123 = 284.5528… → 284.55 USD
        - { account: "111003", currency: SYP, amount: 3500000, book: 3500000, parallel: 28455 }
        # 35,000 of 70,000 open: parallel (82,645 − 24,794) × 1/2 = 57,851 / 2 = 28,925.5 → 28,926
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -3500000, book: -3500000, parallel: -28926 }
        # parallel residual: 28,455 − 28,926 = −471 → realised loss 4.71 USD
        - { account: "541001", currency: USD, amount: 471, book: 0, parallel: 471 }
    - source: reversal
      date: 2026-11-24
      lines:
        # entry 2 negated: M-1 reopens to 65,000.00 SYP, parallel 57,851 − 28,926 + 24,794 = 53,719
        - { account: "111003", currency: SYP, amount: -3000000, book: -3000000, parallel: -24590 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 3000000, book: 3000000, parallel: 24794 }
        - { account: "541001", currency: USD, amount: -204, book: 0, parallel: -204 }
    - source: manual
      date: 2026-11-25
      lines:
        # parallel: 65,000.00 SYP / 124 = 524.1935… → 524.19 USD
        - { account: "111003", currency: SYP, amount: 6500000, book: 6500000, parallel: 52419 }
        # 65,000 of 65,000 open: all that remains, 53,719
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -6500000, book: -6500000, parallel: -53719 }
        # parallel residual: 52,419 − 53,719 = −1,300 → realised loss 13.00 USD
        - { account: "541001", currency: USD, amount: 1300, book: 0, parallel: 1300 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    # 204 + 471 − 204 + 1,300
    - { account: "541001", book: 0, parallel: 1771 }
    # 24,590 + 28,455 − 24,590 + 52,419
    - { account: "111003", book: 10000000, parallel: 80874 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: clearing more than is open

```yaml
case: 500.00 USD received on M-1 with 400.00 open is refused; the item keeps what it carries
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
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
  - manual: first receipt on M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 60000 },
                       { account: "112001", currency: USD, amount: -60000, item: M-1 }] }
  - manual: a receipt beyond what is open
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111004", currency: USD, amount: 50000 },
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
        # book: 600.00 USD × 123 = 73,800.00 SYP
        - { account: "111004", currency: USD, amount: 60000, book: 7380000, parallel: 60000 }
        # 600 of 1,000 open: 12,000,000 × 6/10 = 7,200,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
        # book residual: 7,380,000 − 7,200,000 = 180,000 → realised gain 1,800.00 SYP
        - { account: "421001", currency: SYP, amount: -180000, book: -180000, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
  outcome: { status: refused, reason: RELEASE_EXCEEDS_BALANCE }
```

The accountant posts what exceeds the open amount to a liability instead (S04 edge case 6). Here a client paid 1,100.00 USD on a 1,000.00 USD invoice and the 100.00 is held for refund in other payables. The excess is a new measurement, never a gain: in USD the lines other than the difference balance.

```yaml
case: 1,100.00 USD received on a 1,000.00 USD invoice; the 100.00 excess to other payables
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: receipt on M-1, the excess held for the client
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 110000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 },
                       { account: "211003", currency: USD, amount: -10000, memo: "دفعة زائدة من العميل C1" }] }
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
        # book: 1,100.00 USD × 123 = 135,300.00 SYP
        - { account: "111004", currency: USD, amount: 110000, book: 13530000, parallel: 110000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        # a new measurement: 100.00 USD × 123 = 12,300.00 SYP
        - { account: "211003", currency: USD, amount: -10000, book: -1230000, parallel: -10000 }
        # book residual: 13,530,000 − 12,000,000 − 1,230,000 = 300,000 → realised gain 3,000.00 SYP
        - { account: "421001", currency: SYP, amount: -300000, book: -300000, parallel: 0 }
  balances:
    - { account: "211003", book: -1230000, parallel: -10000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: reversing an invoice that has a receipt

```yaml
case: the reversal of invoice M-1 is refused while its receipt stands
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: first receipt on M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
  - reversal: 1
    accounting_date: 2026-11-24
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
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
  outcome: { status: refused, reason: OPEN_ITEM_HAS_SETTLEMENTS }
```

```yaml
case: the receipt reversed first, then the invoice; every account and the item back to zero
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: first receipt on M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
  - reversal: 2
    accounting_date: 2026-11-24
  - reversal: 1
    accounting_date: 2026-11-24
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
        - { account: "111004", currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: reversal
      date: 2026-11-24
      lines:
        - { account: "111004", currency: USD, amount: -40000, book: -4920000, parallel: -40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        - { account: "421001", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
    - source: reversal
      date: 2026-11-24
      lines:
        # the receipt's movement is reversed, so the opening may be: M-1 goes from 1,000.00 open to zero
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: an offset against the client's ad funds that crosses zero

The client holds 300.00 USD of ad funds, carried at 122, and instructs that 400.00 USD of M-1 be paid from them. The debit on `213001` clears the whole 300.00 balance at its carrying amount, and the 100.00 beyond it is split off as a new measurement at the day's bulletin. The running item then shows a 100.00 USD debit, due from the client (S04 rules 3 and 12).

```yaml
case: 400.00 USD of M-1 offset against 300.00 USD of ad funds; the funds cross zero to a 100.00 debit
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: ad funds deposited by client C1
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "111004", currency: USD, amount: 30000 },
                       { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000 }] }
  - manual: part of M-1 paid from the client's ad funds, on the client's instruction
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "213001", dims: { client: C1 }, currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-10
      lines:
        # a new running item for C1 in USD: 300.00 USD × 122 = 36,600.00 SYP
        - { account: "111004", currency: USD, amount: 30000, book: 3660000, parallel: 30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3660000, parallel: -30000 }
    - source: manual
      date: 2026-11-19
      lines:
        # the split at zero: first the whole 300.00 balance, cleared at what it carries
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3660000, parallel: 30000 }
        # then the 100.00 beyond zero, a new measurement: 100.00 USD × 123 = 12,300.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1230000, parallel: 10000 }
        # 400 of 1,000 open: 12,000,000 × 4/10 = 4,800,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        # book residual: 3,660,000 + 1,230,000 − 4,800,000 = 90,000 → realised gain 900.00 SYP; parallel residual 0
        - { account: "421001", currency: SYP, amount: -90000, book: -90000, parallel: 0 }
  balances:
    - { account: "213001", book: 1230000, parallel: 10000 }
    - { account: "112001", book: 7200000, parallel: 60000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
    # a running item is named by the client's code
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1230000, parallel: 10000 }
```

### SYP books only

A USD item settled posts a book difference only; an SYP item settled in SYP posts none.

```yaml
case: SYP books only; the S04 example, with no parallel ledger
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
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
  - manual: first receipt on M-1, in USD
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
  - manual: final receipt on M-1, in SYP
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111003", currency: SYP, amount: 7440000 },
                       { account: "112001", currency: USD, amount: -60000, item: M-1 }] }
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
        - { account: "111004", currency: USD, amount: 40000, book: 4920000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000 }
        - { account: "421001", currency: SYP, amount: -120000, book: -120000 }
    - source: manual
      date: 2026-11-25
      lines:
        - { account: "111003", currency: SYP, amount: 7440000, book: 7440000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7200000 }
        - { account: "421001", currency: SYP, amount: -240000, book: -240000 }
  balances:
    - { account: "112001", book: 0 }
    - { account: "421001", book: -360000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0 }
```

```yaml
case: SYP books only; an SYP invoice settled in two SYP receipts posts no difference
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - manual: invoice M-1 to client C1, in SYP
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 12000000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -12000000 }] }
  - manual: first receipt on M-1
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111003", currency: SYP, amount: 5000000 },
                       { account: "112001", currency: SYP, amount: -5000000, item: M-1 }] }
  - manual: final receipt on M-1
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111003", currency: SYP, amount: 7000000 },
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
        # 50,000 of 120,000 open; in the book currency the share is the amount itself; residual 0
        - { account: "111003", currency: SYP, amount: 5000000, book: 5000000 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -5000000, book: -5000000 }
    - source: manual
      date: 2026-11-25
      lines:
        - { account: "111003", currency: SYP, amount: 7000000, book: 7000000 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -7000000, book: -7000000 }
  balances:
    - { account: "112001", book: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 0 }
```

### USD books with an SYP parallel ledger

A USD item is in the book currency, so the book ledger posts a difference only when SYP is received; the SYP parallel ledger, at the market rate, posts the difference of each receipt.

```yaml
case: USD books; the S04 example with the SYP parallel ledger at market 121, 124 and 124
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "121.0000", type: market }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "124.0000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "124.0000", type: market }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: first receipt on M-1, in USD
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
  - manual: final receipt on M-1, in SYP
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111003", currency: SYP, amount: 7440000 },
                       { account: "112001", currency: USD, amount: -60000, item: M-1 }] }
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
        # parallel: 400.00 USD × 124 = 49,600.00 SYP
        - { account: "111004", currency: USD, amount: 40000, book: 40000, parallel: 4960000 }
        # 400 of 1,000 open: parallel 12,100,000 × 4/10 = 4,840,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -40000, parallel: -4840000 }
        # parallel residual: 4,960,000 − 4,840,000 = 120,000 → realised gain 1,200.00 SYP; book residual 0
        - { account: "421001", currency: SYP, amount: -120000, book: 0, parallel: -120000 }
    - source: manual
      date: 2026-11-25
      lines:
        # book: 74,400.00 SYP / 123.5 (bulletin) = 602.4291… → 602.43 USD
        - { account: "111003", currency: SYP, amount: 7440000, book: 60243, parallel: 7440000 }
        # 600 of 600 open: all that remains, 12,100,000 − 4,840,000 = 7,260,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -60000, parallel: -7260000 }
        # book residual: 60,243 − 60,000 = 243 → realised gain 2.43 USD
        - { account: "421001", currency: USD, amount: -243, book: -243, parallel: 0 }
        # parallel residual: 7,440,000 − 7,260,000 = 180,000 → realised gain 1,800.00 SYP
        - { account: "421001", currency: SYP, amount: -180000, book: 0, parallel: -180000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "421001", book: -243, parallel: -300000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### A third currency: a TRY invoice settled in TRY

Book SYP at the bulletin, crossed through USD; the USD parallel ledger at the market TRY rate. The partial clearing rounds in both ledgers, and each receipt posts a difference in each.

```yaml
case: a 41,000.00 TRY invoice settled by 15,000.00 and 26,000.00 TRY as the lira weakens; a loss in both ledgers
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: TRY, rate: "41.5000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: TRY, rate: "41.6000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: TRY, rate: "41.8000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: TRY, rate: "42.0000", type: market }
steps:
  - manual: invoice M-1 to client C1, in TRY
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: TRY, amount: 4100000,
                         open_item: { ref: M-1, due: 2026-12-10 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: TRY, amount: -4100000 }] }
  - manual: first receipt on M-1, in TRY cash
    accounting_date: 2026-11-19
    payload: { lines: [{ account: "111007", currency: TRY, amount: 1500000 },
                       { account: "112001", currency: TRY, amount: -1500000, item: M-1 }] }
  - manual: final receipt on M-1, in TRY cash
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "111007", currency: TRY, amount: 2600000 },
                       { account: "112001", currency: TRY, amount: -2600000, item: M-1 }] }
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
      date: 2026-11-19
      lines:
        # book: 15,000.00 TRY / 41.5 × 123 (one exact product) = 44,457.8313… → 44,457.83 SYP
        # parallel: 15,000.00 TRY / 41.6 = 360.5769… → 360.58 USD
        - { account: "111007", currency: TRY, amount: 1500000, book: 4445783, parallel: 36058 }
        # 15,000 of 41,000 open: book 12,200,000 × 15/41 = 4,463,414.63… → 4,463,415
        #                        parallel 99,515 × 15/41 = 36,407.93… → 36,408
        - { account: "112001", dims: { client: C1 }, currency: TRY, amount: -1500000, book: -4463415, parallel: -36408 }
        # book residual: 4,445,783 − 4,463,415 = −17,632 → realised loss 176.32 SYP
        - { account: "541001", currency: SYP, amount: 17632, book: 17632, parallel: 0 }
        # parallel residual: 36,058 − 36,408 = −350 → realised loss 3.50 USD
        - { account: "541001", currency: USD, amount: 350, book: 0, parallel: 350 }
    - source: manual
      date: 2026-11-25
      lines:
        # book: 26,000.00 TRY / 41.8 × 123.5 = 76,818.1818… → 76,818.18 SYP
        # parallel: 26,000.00 TRY / 42 = 619.0476… → 619.05 USD
        - { account: "111007", currency: TRY, amount: 2600000, book: 7681818, parallel: 61905 }
        # 26,000 of 26,000 open: all that remains, 12,200,000 − 4,463,415 = 7,736,585; 99,515 − 36,408 = 63,107
        - { account: "112001", dims: { client: C1 }, currency: TRY, amount: -2600000, book: -7736585, parallel: -63107 }
        # book residual: 7,681,818 − 7,736,585 = −54,767 → realised loss 547.67 SYP
        - { account: "541001", currency: SYP, amount: 54767, book: 54767, parallel: 0 }
        # parallel residual: 61,905 − 63,107 = −1,202 → realised loss 12.02 USD
        - { account: "541001", currency: USD, amount: 1202, book: 0, parallel: 1202 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    # 17,632 + 54,767; 350 + 1,202
    - { account: "541001", book: 72399, parallel: 1552 }
    # 4,445,783 + 7,681,818; 36,058 + 61,905
    - { account: "111007", currency: TRY, amount: 4100000, book: 12127601, parallel: 97963 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: TRY, amount: 0, book: 0, parallel: 0 }
```
