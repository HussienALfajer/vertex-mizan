# 0013 — Open items and settlements: item kinds, manual movements, settlement in proportion to what remains

Status: Accepted · Date: 2026-10-28 (owner's answers in the S04 interview) · Amends [0007](0007-book-and-parallel-currency-ledgers.md) (partial settlements) and [0012](0012-journal-entries-and-ledger-state.md) (residuals of manual entries)

## Context
S04 (`docs/specs/S04-open-items-settlements.md`) builds the open items behind the control accounts and the settlements that clear them. ADR 0007 fixes how an item is carried and cleared. Four points were left open:
- how an item is cleared after a void;
- what a manual entry may do on a control account;
- what happens when a movement would carry an item past zero;
- how a manual entry's residual is classified once it clears a carried balance.

**The void gap.** ADR 0007 clears a partial settlement "in proportion to the transaction amount settled, with cumulative rounding" over the item's original amounts. Take an item paid in two parts where the first payment is voided after the second. The void is an exact reversal (ADR 0005, invariant 3). After it, the ledger no longer holds what the cumulative formula expects, so the last settlement can leave one minor unit in a ledger on an item whose transaction amount is zero. Invariant 9 (ADR 0008) refuses that.

## Decision
- **Settlement in proportion to what remains** (owner, 2026-10-28; amends ADR 0007 "Carrying amount", partial settlement):
  - A movement that clears part of an item clears each ledger's carrying amount as it stands in the ledger. The share is the transaction amount cleared over the transaction amount still open, rounded half away from zero.
  - The movement that clears the whole open amount clears everything left in every ledger.
  - A void is an exact reversal and needs no extra line, because the next clearing starts from what the ledger holds. Without a void, the parts usually equal those of the cumulative rule.
  - Each ledger is still computed separately, and an item is never converted again (IAS 21.23(b)).
  - The carrying amount excludes month-end revaluations, which reverse (ADR 0007; S07).
- **Item kinds.** Every control account has an item kind, locked after first use like its other flags (ADR 0011):
  - `document`: one item per document (an invoice, a contract asset per milestone, a manual document), opened once and cleared by movements toward zero;
  - `running`: one item per counterparty and currency (client ad funds), carried at its average and allowed to cross zero (ADR 0007).
- **Manual movements** (owner, 2026-10-28):
  - A manual line on a control account names its item. It opens a new manual `document` item (a reference and an optional due date), moves an existing item, or, on a `running` account, moves the client's item.
  - A manual entry may move any item, Hub's included: a write-off (IFRS 9.5.4.4) or an offset against client funds. A manual movement on an item whose source is not manual needs a line memo. The item and the daily reconciliation (S08) show it as adjusted in Mizan.
- **A document item never crosses zero** (owner, 2026-10-28; invariant 9):
  - **Clearing too much.** A movement that would clear more than is open is refused (`RELEASE_EXCEEDS_BALANCE`). An overpayment or an advance from a client is posted by the accountant to a liability: contract liabilities under IFRS 15.106, or another payable. It never becomes a credit item on a receivable account. Debit and credit balances of different clients are never offset (IAS 1.32).
  - **Hub events.** A Hub payment that exceeds the open amount is held `NEEDS_DECISION` (S05).
  - **Reversing an opening.** A reversal of an entry that opened an item still carrying other movements is refused (`OPEN_ITEM_HAS_SETTLEMENTS`). A Hub void of such an invoice is held with that reason. It is retried by itself once the payments' voids have posted (S05).
- **Residuals of entries with carried lines** (amends ADR 0012 "Manual entries are new measurements"):
  - An entry with a carried line (a settlement, a write-off, an offset) posts each ledger's residual, rounding included, as a realised exchange difference. It goes to the gain or the loss role account by its sign (IAS 21.28; ADR 0007 "Exchange residuals").
  - Only an entry in one currency whose lines are all new measurements treats its residual as conversion rounding.
- **Write-off** (owner, 2026-10-28): the item is cleared at its carrying amount. The expense line is a new measurement at each ledger's policy rate on the write-off date, and the residual is a realised exchange difference: the item is remeasured to spot, then derecognised (IAS 21.23, 21.28).
- **Voiding a movement on a running item** (ADR 0007 "Voiding a movement on a running balance", made exact):
  - The exact reversal is posted.
  - In the same transaction, an exchange-difference entry under its own posting request brings the item to the carrying amount it would have if the void were a new movement on the balance:
    - cleared at the average when it runs against the balance;
    - split at zero when it crosses, with the excess measured at the void date's policy rates.
  - That entry's difference is realised (IAS 21.28).

## Consequences
- `clearOpenItem()` in `packages/ledger` reads the item's current carrying amount and open amount instead of the original amounts. Its properties change from "the cleared sum equals the cumulative share of the original" to "every item whose open amount reaches zero is zero in every ledger, through any order of settlements and voids".
- The posting function maintains the items' balances in the posting transaction as `ledger-state` (ADR 0012), written only by the trigger on movements. The integrity check proves that each control account's balance equals the sum of its items, in every ledger.
- Mizan and Hub can differ on an item only through a manual movement. That movement is flagged, so the reconciliation (S08) can show it instead of reporting a gap.
- S05 implements the Hub rules (payments, ad funds) on these mechanics, S06 the contract assets per milestone, S07 the revaluation per item, and S10 the opening items.
