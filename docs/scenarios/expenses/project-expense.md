# Project expenses from Hub

Status: Proposed

S05 wrote these cases (S05 "Scenarios"); they await the owner's approval of their expected entries and outcomes.

The cases stay `Proposed` until S05 brings their executors: the `event` executor through the event inbox, the posting rules of `project_expense.recorded`, `project_expense.changed` and `project_expense.archived`, the mapping slots `project_cost` and `project_expense_awaiting_payment`, a contract value made from the event (its kind and client, S05 rule 23), and the hold `NO_MAPPING` (S05 rules 8, 12–14). S05's feature slice switches the file to `Approved (owner, <the approval's date>)`.

## Rule

`project_expense.recorded` posts one entry on the expense's accounting date, its `spent_on`: a debit to direct project costs (`project_cost`) with the client, the project and the department, and a credit of the same amount to project expenses awaiting payment source (`project_expense_awaiting_payment`), both in the expense's currency and both new measurements in each ledger: the book ledger at the bulletin of the day, a ledger in the expense's currency at the amount as is, and a market ledger that accepts the transaction's rate at Hub's `syp_per_usd`. The two lines convert the same amount at the same rate, so the entry has no residual. `project_expense.changed` carries the expense's full new state and posts two entries on the change date: the exact reversal of the entry standing for the expense, then the new state, measured at each ledger's rate **of the new state's `spent_on`** (the bulletin of that day, or the new state's `syp_per_usd` where the ledger accepts it), never at the change date's. A change of the description alone therefore nets to zero in both ledgers, and a change of the amount moves the cost by the difference at the expense's own rate. When the bulletin of `spent_on` was corrected after the expense posted, the new state takes the corrected rate (S02 rule 15). `project_expense.archived` posts, on the archive date, the exact reversal of the entry still standing for the expense. A reversal carries the amounts it reverses, so no rate is read for it.

## Basis

- **Conceptual Framework 4.69 and IAS 1.88:** a cost the agency incurs on a client's project decreases its equity through a liability it now owes, so it is an expense in profit or loss of the period it is incurred in, presented as a direct cost (`is.direct_costs`). Whether some of it is a cost to fulfil a contract to be recognised as an asset (IFRS 15.95) is not phase 1's: the scope posts project expenses as direct costs when incurred (`phase-1-scope.md` §6 "Expenses").
- **Conceptual Framework 4.26 and scope Q7:** the obligation exists once the expense is incurred, though Hub does not say how it is paid; it waits on a clearing liability, `211002`, that the accountant clears by a manual entry once the source of payment is known.
- **IAS 21.21–22:** an expense in a foreign currency is recorded at the spot rate at the date of the transaction, its `spent_on`: the bulletin of that day for the book ledger (S02 rule 16; ADR 0011), and for a market ledger that accepts it, the rate Hub recorded the expense at, its `syp_per_usd`. An expense in one currency exchanges nothing, and its two lines convert the same amount at the same rate, so no rounding residual arises.
- **IAS 21.21–22 and 21.28, for a change:** the date of the transaction does not move when Hub edits the expense, so its new state is measured at the rate of its `spent_on`; the rate's movement between `spent_on` and the change date is an exchange difference on the payable, never cost (S05 rule 13, owner, 2026-11-07, after the accounting review). A new state with another `spent_on` is measured at that day's rate, the date of the transaction as corrected.
- **IAS 8.36, ADR 0005 and ADR 0012:** posted entries are append-only; a change or an archive in Hub is a reversal and a new entry in Mizan, dated on the change date, so a month already reported keeps its figures and the change appears in the month it was made. A Hub entry is reversed only by its events (S05 rule 14).
- **Company policy:** `phase-1-scope.md` §4 (the book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and §6 "Expenses" (project expense, expense edited, expense archived); scope Q7 (the clearing account); S05 "Accounting treatment", rules 2, 8, 12–14 and "Currencies, rates and rounding" (owner, 2026-11-07); S02 rule 15 (a corrected rate applies to what converts after the correction; the entries already posted stay).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes are the service-agency template's (S02): direct project costs `511001` (client, contract and department required) and project expenses awaiting payment source `211002` (monetary, no dimension required). The mapping slots take their template defaults (S05 "Data"). Every rate and amount is synthetic. Tuesday 10, Tuesday 24 November and Thursday 3, Thursday 10 December 2026 are publication days.

An expense is named by Hub's expense (`E-1`). The payloads carry the fields of ADR 0006's catalogue that the rules read, in the short form of `receivables/hub-payment.md`: dimensions by their code, the project as the contract it is (with its kind and its client, S05 rule 2), and the department by Hub's fixed code (`photography`, `design`). A `.changed` payload is the expense's full new state (ADR 0006) with its change date. S05 fixes the full payload contract with Hub (Q5), which changes the payloads but no expected value. A change's entries have the change event as their source, its reversal included; an archive's, the archive event.

Shapes:
- **`syp-usd`** is Vertex Media, the company Hub feeds; most cases are in it.
- **`syp`** and **`usd-syp`** each have one case with a USD and an SYP expense, a change of the amount of one, a change of the description of the other in the next month, and an archive, for a company fed by Hub without a parallel ledger or with USD books.
- **`third`** cannot occur: Hub records expenses only in SYP and USD and its events carry only `syp_per_usd` (ADR 0006), so an expense in another currency is refused by the contract (S05 rule 2) and stores nothing.

The cases leave out what other scenarios or later specs own:
- the accountant's manual entry that clears `211002` once the source of payment is known (S05 "Accounting treatment"; a manual entry of S03), and the month-end revaluation of a foreign-currency balance left on `211002`, a monetary liability (F08, S07);
- an expense, change or archive dated in a closed period, held `PERIOD_CLOSED` (the scenario setup closes periods with S07; `inbox/holds-and-actions.md` posts one in the next open period);
- an expense dated on a publication day whose bulletin is not yet recorded, held `RATE_MISSING`, and an event on the same expense waiting behind it (`ad-funds/running-balance.md` shows both);
- a change or an archive received before the expense it names, held `UNKNOWN_REFERENCE` like the payments of `receivables/hub-payment.md`;
- a replayed event (the same idempotency key), which posts nothing new: a property test of S05, since a step carries no event ID;
- an expense of zero or a negative amount: refused by the contract (422), nothing stored (S05 rule 2, edge case 8).

### Vertex Media: an SYP expense at Hub's rate

The example of S05 "Accounting treatment". The SYP books take the amount as is; the USD parallel ledger measures both lines at Hub's 124, never at the bulletin of the day (122), which the case records to show it is not read.

```yaml
case: a 50,000.00 SYP expense of 10 November at Hub's 124; the bulletin of 122 not read
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: SYP, amount: 5000000,
               syp_per_usd: "124.0000", description: "تصوير منتجات العميل" }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # parallel: 50,000.00 SYP / 124 = 403.2258… USD → 403.23, on each line, so no residual
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: 5000000, book: 5000000, parallel: 40323 }
        - { account: "211002", currency: SYP, amount: -5000000, book: -5000000, parallel: -40323 }
  balances:
    - { account: "511001", book: 5000000, parallel: 40323 }
    - { account: "211002", book: -5000000, parallel: -40323 }
```

### Vertex Media: a USD expense at the bulletin

The SYP books measure both lines at the bulletin of `spent_on`; the book ledger does not accept a transaction's rate, so Hub's 124 is not read. The USD parallel ledger takes the amount as is.

```yaml
case: a 187.35 USD expense of 10 November at bulletin 122; Hub's 124 not read
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: design, spent_on: 2026-11-10, currency: USD, amount: 18735,
               syp_per_usd: "124.0000", description: "اشتراك أداة تصميم للمشروع" }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # book: 187.35 USD × 122 = 22,856.70 SYP; parallel: USD as is
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 18735, book: 2285670, parallel: 18735 }
        - { account: "211002", currency: USD, amount: -18735, book: -2285670, parallel: -18735 }
  balances:
    - { account: "511001", book: 2285670, parallel: 18735 }
    - { account: "211002", book: -2285670, parallel: -18735 }
```

### Vertex Media: a change of the description in the next month, netting to zero

Hub edits only the description on 3 December, when the bulletin is 125. The change reverses the 10 November entry and posts the new state on 3 December, measured at the bulletin of its `spent_on`, 10 November (122), so the two entries net to zero in both ledgers: November keeps its cost, December shows the two entries and no change. Measured at the change date, the new state would have been 25,000.00 SYP, and 600.00 SYP of the rate's movement would have become cost.

```yaml
case: a 200.00 USD expense of 10 November at bulletin 122, its description changed on 3 December at bulletin 125; the two entries net to zero
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "تصوير" }
  - event: project_expense.changed
    accounting_date: 2026-12-03
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "تصوير منتجات الحملة", changed_on: 2026-12-03 }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # 200.00 USD × 122 = 24,400.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the exact negation of the 10 November entry; no rate read
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
        - { account: "211002", currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the new state at the bulletin of its spent_on, 10 November: 200.00 × 122 = 24,400.00 SYP (not × 125 = 25,000.00)
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
  balances:
    - { account: "511001", book: 2440000, parallel: 20000 }
    - { account: "211002", book: -2440000, parallel: -20000 }
```

### Vertex Media: a change of the amount in the next month, then an archive

On 3 December Hub raises the expense from 200.00 to 250.00 USD: the new state is measured at the bulletin of its `spent_on` (122), not the change date's (125). On 10 December Hub archives it: the archive reverses the entry standing for the expense, the new state; the 10 November entry was already reversed by the change, so it is not reversed again. The bulletin of 10 December is not read. Every account comes back to zero.

```yaml
case: a 200.00 USD expense of 10 November at bulletin 122, raised to 250.00 on 3 December at 30,500.00 SYP (122, not 125), archived on 10 December
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "126.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "تصوير" }
  - event: project_expense.changed
    accounting_date: 2026-12-03
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: USD, amount: 25000,
               syp_per_usd: "124.0000", description: "تصوير", changed_on: 2026-12-03 }
  - event: project_expense.archived
    accounting_date: 2026-12-10
    payload: { expense: E-1, archived_on: 2026-12-10 }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # 200.00 USD × 122 = 24,400.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the exact negation of the 10 November entry
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
        - { account: "211002", currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the new state at the bulletin of 10 November: 250.00 × 122 = 30,500.00 SYP (not × 125 = 31,250.00)
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: 25000, book: 3050000, parallel: 25000 }
        - { account: "211002", currency: USD, amount: -25000, book: -3050000, parallel: -25000 }
    - source: project_expense.archived
      date: 2026-12-10
      lines:
        # the exact negation of the standing entry, the new state of 3 December; no rate read
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: -25000, book: -3050000, parallel: -25000 }
        - { account: "211002", currency: USD, amount: 25000, book: 3050000, parallel: 25000 }
  balances:
    - { account: "511001", book: 0, parallel: 0 }
    - { account: "211002", book: 0, parallel: 0 }
```

### Vertex Media: a change of the amount of an SYP expense at Hub's rate

On 24 November Hub raises the SYP expense of 10 November from 50,000.00 to 61,000.00 SYP; the new state carries the expense's `syp_per_usd`, 124. The USD parallel ledger measures it at that rate, as it measured the expense; the bulletin of either day is not read.

```yaml
case: a 50,000.00 SYP expense of 10 November at Hub's 124, raised to 61,000.00 SYP on 24 November; the new state at 124
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: SYP, amount: 5000000,
               syp_per_usd: "124.0000", description: "تصوير منتجات العميل" }
  - event: project_expense.changed
    accounting_date: 2026-11-24
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: SYP, amount: 6100000,
               syp_per_usd: "124.0000", description: "تصوير منتجات العميل", changed_on: 2026-11-24 }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # parallel: 50,000.00 SYP / 124 = 403.2258… → 403.23
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: 5000000, book: 5000000, parallel: 40323 }
        - { account: "211002", currency: SYP, amount: -5000000, book: -5000000, parallel: -40323 }
    - source: project_expense.changed
      date: 2026-11-24
      lines:
        # the exact negation of the 10 November entry
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: -5000000, book: -5000000, parallel: -40323 }
        - { account: "211002", currency: SYP, amount: 5000000, book: 5000000, parallel: 40323 }
    - source: project_expense.changed
      date: 2026-11-24
      lines:
        # parallel: 61,000.00 SYP / 124 = 491.9354… USD → 491.94
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: 6100000, book: 6100000, parallel: 49194 }
        - { account: "211002", currency: SYP, amount: -6100000, book: -6100000, parallel: -49194 }
  balances:
    - { account: "511001", book: 6100000, parallel: 49194 }
    - { account: "211002", book: -6100000, parallel: -49194 }
```

### Vertex Media: a change of the expense's date

Hub corrects the expense's `spent_on` from 10 to 24 November on 3 December. The new state is measured at the bulletin of its own `spent_on`, 24 November (123): the date of the transaction as corrected, never the change date's (125).

```yaml
case: a 200.00 USD expense of 10 November at bulletin 122, its spent_on moved to 24 November on 3 December; the new state at 123
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "تصوير" }
  - event: project_expense.changed
    accounting_date: 2026-12-03
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-24, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "تصوير", changed_on: 2026-12-03 }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # 200.00 USD × 122 = 24,400.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the exact negation of the 10 November entry
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
        - { account: "211002", currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the new state at the bulletin of its new spent_on, 24 November: 200.00 × 123 = 24,600.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: 20000, book: 2460000, parallel: 20000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2460000, parallel: -20000 }
  balances:
    - { account: "511001", book: 2460000, parallel: 20000 }
    - { account: "211002", book: -2460000, parallel: -20000 }
```

### Vertex Media: a change of the description after the bulletin of spent_on was corrected

The bulletin of 10 November was mistyped as 122 and corrected to 122.5 after the expense posted. The expense's entry stays as posted, and the correction's answer lists it (S02 rule 15). The description change on 3 December reverses the entry at its posted amounts and measures the new state at the bulletin of 10 November as it now stands, 122.5: the correction applies (S05 rule 13), so the two entries do not net to zero; the 100.00 SYP between them is the correction reaching the expense.

```yaml
case: a 200.00 USD expense of 10 November at bulletin 122, the bulletin corrected to 122.5, the description changed on 3 December; the new state at 122.5
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "تصوير" }
  - rate: { date: 2026-11-10, base: USD, quote: SYP, rate: "122.5000", type: bulletin,
            reason: "خطأ في إدخال النشرة" }
  - event: project_expense.changed
    accounting_date: 2026-12-03
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "تصوير منتجات الحملة", changed_on: 2026-12-03 }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # 200.00 USD × 122 (the row then in force) = 24,400.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the exact negation of the posted entry, at 122
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
        - { account: "211002", currency: USD, amount: 20000, book: 2440000, parallel: 20000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the new state at the corrected bulletin of 10 November: 200.00 × 122.5 = 24,500.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: USD, amount: 20000, book: 2450000, parallel: 20000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2450000, parallel: -20000 }
  balances:
    - { account: "511001", book: 2450000, parallel: 20000 }
    - { account: "211002", book: -2450000, parallel: -20000 }
  corrections:
    - { step: 2, used_by: [1] }
```

### A company on the general template: held for its mapping

The general template's companies start with no posting rule mapped (S05 "Data"), so the expense is held `NO_MAPPING` and nothing posts; mapping `project_cost` and `project_expense_awaiting_payment` retries it (S05 rule 10). Both slots are unmapped, so the hold's detail is not compared.

```yaml
case: a company on the general template holds a 200.00 USD expense NO_MAPPING; nothing posts
company: { shape: syp-usd, book: SYP, parallel: USD, template: general,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "تصوير" }
    outcome: { status: held, reason: NO_MAPPING }
expect:
  entries: []
  balances:
    - { account: "511001", book: 0, parallel: 0 }
```

### SYP books only

With no parallel ledger, Hub's `syp_per_usd` measures nothing. The USD expense converts at the bulletin of its `spent_on`, and its description change in December at the same bulletin, so the two entries net to zero; the SYP expense takes its amounts as is, through a change of its amount and its archive.

```yaml
case: SYP books only; a 200.00 USD expense at bulletin 122 whose description changes on 3 December at 125, and a 50,000.00 SYP expense raised to 61,000.00 then archived
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: design, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "اشتراك أداة تصميم" }
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-2, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: SYP, amount: 5000000,
               syp_per_usd: "124.0000", description: "تصوير منتجات العميل" }
  - event: project_expense.changed
    accounting_date: 2026-11-24
    payload: { expense: E-2, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: SYP, amount: 6100000,
               syp_per_usd: "124.0000", description: "تصوير منتجات العميل", changed_on: 2026-11-24 }
  - event: project_expense.changed
    accounting_date: 2026-12-03
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: design, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "اشتراك أداة تصميم للمشروع", changed_on: 2026-12-03 }
  - event: project_expense.archived
    accounting_date: 2026-12-03
    payload: { expense: E-2, archived_on: 2026-12-03 }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # 200.00 USD × 122 = 24,400.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 20000, book: 2440000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2440000 }
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # SYP as is; no rate read
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: 5000000, book: 5000000 }
        - { account: "211002", currency: SYP, amount: -5000000, book: -5000000 }
    - source: project_expense.changed
      date: 2026-11-24
      lines:
        # the exact negation of E-2's entry
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: -5000000, book: -5000000 }
        - { account: "211002", currency: SYP, amount: 5000000, book: 5000000 }
    - source: project_expense.changed
      date: 2026-11-24
      lines:
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: 6100000, book: 6100000 }
        - { account: "211002", currency: SYP, amount: -6100000, book: -6100000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the exact negation of E-1's entry
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: -20000, book: -2440000 }
        - { account: "211002", currency: USD, amount: 20000, book: 2440000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # E-1's new state at the bulletin of 10 November: 200.00 × 122 = 24,400.00 SYP (not × 125)
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 20000, book: 2440000 }
        - { account: "211002", currency: USD, amount: -20000, book: -2440000 }
    - source: project_expense.archived
      date: 2026-12-03
      lines:
        # the exact negation of E-2's standing entry, its new state of 24 November
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: -6100000, book: -6100000 }
        - { account: "211002", currency: SYP, amount: 6100000, book: 6100000 }
  balances:
    - { account: "511001", dims: { department: design }, book: 2440000 }
    - { account: "511001", dims: { department: photography }, book: 0 }
    - { account: "211002", currency: USD, amount: -20000, book: -2440000 }
    - { account: "211002", currency: SYP, amount: 0, book: 0 }
```

### USD books with an SYP parallel ledger

The USD books take the USD expense as is and measure the SYP expense at the bulletin of its `spent_on`, never at Hub's rate (the book ledger does not accept a transaction's rate). The SYP parallel ledger accepts it: it measures the USD expense at Hub's 124 and takes the SYP expense as is. The SYP expense's description changes in December, when the bulletin is 125: the new state is measured at 122 again, so the USD books net to zero. The USD expense is raised from 200.00 to 250.00 USD on 24 November at Hub's 124, then archived.

```yaml
case: USD books; a 50,000.00 SYP expense at bulletin 122 whose description changes on 3 December at 125, and a 200.00 USD expense at Hub's 124 raised to 250.00 then archived
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: design, spent_on: 2026-11-10, currency: USD, amount: 20000,
               syp_per_usd: "124.0000", description: "اشتراك أداة تصميم" }
  - event: project_expense.recorded
    accounting_date: 2026-11-10
    payload: { expense: E-2, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: SYP, amount: 5000000,
               syp_per_usd: "124.0000", description: "تصوير" }
  - event: project_expense.changed
    accounting_date: 2026-11-24
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: design, spent_on: 2026-11-10, currency: USD, amount: 25000,
               syp_per_usd: "124.0000", description: "اشتراك أداة تصميم", changed_on: 2026-11-24 }
  - event: project_expense.changed
    accounting_date: 2026-12-03
    payload: { expense: E-2, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: photography, spent_on: 2026-11-10, currency: SYP, amount: 5000000,
               syp_per_usd: "124.0000", description: "تصوير منتجات الحملة", changed_on: 2026-12-03 }
  - event: project_expense.archived
    accounting_date: 2026-12-03
    payload: { expense: E-1, archived_on: 2026-12-03 }
expect:
  entries:
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # book: USD as is; parallel: 200.00 USD × 124 (Hub's rate) = 24,800.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 20000, book: 20000, parallel: 2480000 }
        - { account: "211002", currency: USD, amount: -20000, book: -20000, parallel: -2480000 }
    - source: project_expense.recorded
      date: 2026-11-10
      lines:
        # book: 50,000.00 SYP / 122 (bulletin) = 409.8360… USD → 409.84 (Hub's 124 is not read); parallel: SYP as is
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: 5000000, book: 40984, parallel: 5000000 }
        - { account: "211002", currency: SYP, amount: -5000000, book: -40984, parallel: -5000000 }
    - source: project_expense.changed
      date: 2026-11-24
      lines:
        # the exact negation of E-1's entry
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: -20000, book: -20000, parallel: -2480000 }
        - { account: "211002", currency: USD, amount: 20000, book: 20000, parallel: 2480000 }
    - source: project_expense.changed
      date: 2026-11-24
      lines:
        # parallel: 250.00 USD × 124 (the new state's syp_per_usd) = 31,000.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 25000, book: 25000, parallel: 3100000 }
        - { account: "211002", currency: USD, amount: -25000, book: -25000, parallel: -3100000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # the exact negation of E-2's entry
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: -5000000, book: -40984, parallel: -5000000 }
        - { account: "211002", currency: SYP, amount: 5000000, book: 40984, parallel: 5000000 }
    - source: project_expense.changed
      date: 2026-12-03
      lines:
        # E-2's new state at the bulletin of 10 November: 409.84 USD again (not 50,000.00 / 125 = 400.00)
        - { account: "511001", dims: { client: C1, contract: P1, department: photography }, currency: SYP, amount: 5000000, book: 40984, parallel: 5000000 }
        - { account: "211002", currency: SYP, amount: -5000000, book: -40984, parallel: -5000000 }
    - source: project_expense.archived
      date: 2026-12-03
      lines:
        # the exact negation of E-1's standing entry, its new state of 24 November
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: -25000, book: -25000, parallel: -3100000 }
        - { account: "211002", currency: USD, amount: 25000, book: 25000, parallel: 3100000 }
  balances:
    - { account: "511001", dims: { department: design }, book: 0, parallel: 0 }
    - { account: "511001", dims: { department: photography }, book: 40984, parallel: 5000000 }
    - { account: "211002", book: -40984, parallel: -5000000 }
```

Each posted entry has two lines of one amount in one currency, each converted at one rate, so it balances in both ledgers with no residual; a reversal carries the posted amounts line by line, so it balances as its source does.
