---
name: posting-rule
description: Add or change an accounting rule (a posting rule for an event, revenue recognition, revaluation, settlement, rounding or allocation). Order — write the scenario with its expected entries, get the owner's approval of the numbers, implement in packages/ledger, add property tests, run the accountant-reviewer. Use before any code that decides what the books contain.
argument-hint: <rule, e.g. "payment.recorded in another currency">
effort: high
---

Rule: **$ARGUMENTS**. Rules: ADR 0007 (money, book and parallel ledgers), ADR 0005 and ADR 0008 (ledger invariants, scenario book), the policies and event treatment in the current phase scope (§4, §6), and `docs/scenarios/README.md` (format).

## 1. Understand
- Read the scope's treatment of this rule, the spec that needs it, any existing scenario for it, and the glossary.
- State the rule in one sentence with its basis:
  - the standard paragraph (IFRS 15, IAS 21…);
  - the company policy from the scope;
  - any Syrian rule, with its label.
- If the treatment is not decided, or rests on an UNVERIFIED Syrian rule without an owner decision, stop and ask the owner in Arabic with options and your recommendation. Never decide it yourself.

## 2. Write the scenario (no code)
- Create or edit `docs/scenarios/<area>/<rule>.md` following `docs/scenarios/README.md`:
  - the explanation and the basis;
  - a YAML block with the setup (the currency shape, the book and parallel currencies, the rate policy, template accounts, rates);
  - the events or manual entries;
  - the **expected entries line by line**: account code, dimensions, transaction currency and amount, book and parallel amounts, rounding and exchange-difference lines;
  - the expected balances or report figures.
- Compute every expected amount by hand with the money module's rules: half away from zero, cumulative allocation. Write the arithmetic beside each non-obvious figure.
- Cover every currency shape the rule can occur in (`syp`, `syp-usd`, `usd-syp`, `third`; `docs/scenarios/README.md`), and the variants the rule has, each as its own case:
  - same currency and cross currency;
  - partial and full settlement;
  - reversal or void;
  - change after posting;
  - month boundaries;
  - a closed period;
  - zero and negative amounts where they can occur.

## 3. Owner approval of the numbers
- Show the owner each case in Arabic as a small table of debit and credit lines with amounts, and the reasoning in one or two lines.
- **Stop and wait for approval.** Changes to an existing expected value need explicit approval and are named in the PR. This approval is the one the PR needs: the PR quotes it and merges automatically ("Finishing a task" in `AGENTS.md`).
- An approved case keeps `Status: Proposed` until the executors its steps need exist (the runner fails an `Approved` case it cannot run); its PR and `docs/ROADMAP.md` record the owner's approval and date (`docs/scenarios/README.md`, "Status").

## 4. Implement
- Put the rule in `packages/ledger` as pure functions (no I/O), and register it where its event or job is dispatched.
- The posting function in `packages/db` stays the only writer.
- When this PR brings the executors a case's steps need, switch the case to `Status: Approved (owner, <the approval's date>)` in the same PR.
- Run the scenario through the runner: `pnpm verify docs/scenarios/<area>/<scenario>.md` runs the scenario book. It must pass without editing the expected values, and its summary must count the case as run, not skipped: a skipped case proves nothing. If the code disagrees with the approved numbers, the code is wrong unless the owner approves a change.

## 5. Property tests
Add fast-check properties for the rule, and run their files with `pnpm verify <files>`:
- the entries it builds balance in both currencies;
- its reversal nets to zero;
- its allocations sum exactly;
- it never posts into a closed period;
- replaying its input posts nothing new.

## 6. Review and finish
- Check and review at the same time: `pnpm verify --e2e-all` through the `checker`, the `accountant-reviewer` with the scenario paths, and the `reviewer` (every PR that changes code, `CLAUDE.md`). Edit nothing while they run.
- Fix every blocking finding and every failure together, run `pnpm verify --e2e-all` once more and the one re-review `CLAUDE.md` allows, then finish the PR in the same turn, without asking: "Finishing a task" in `AGENTS.md`. A fix that changes an approved expected value, account or treatment goes back to step 3 for a new approval first. A scenario-only PR (no code yet) runs the same steps: CI runs the scenario book on it.
