# Foundation audit — October 2026

- **Date:** 2026-10-20 · **Audited:** `main` at `5195b10` (every file in the repository; nothing outside `D:\vertex-mizan` was opened) · **Auditor:** Claude Fable 5.1, acting as an IFRS/Syrian-practice accountant, a ledger-systems architect and an AI-assisted-development reviewer
- **Method:** adversarial review of every document; the worked example recomputed; Syrian legal, tax and currency facts re-verified on the web (official sources preferred; labels CONFIRMED / REPORTED / UNVERIFIED as in `docs/research/market-syria.md`); stack versions and PostgreSQL behaviour checked against official documentation. Facts are separated from opinion; opinion is marked as such.
- **Not legal, tax or audit advice.** Anything labelled REPORTED or UNVERIFIED must be confirmed by a Syrian certified auditor or lawyer before it becomes a requirement.

## 1. Verdict

The foundation is unusually disciplined for a project with no code: the ledger invariants are to be enforced by the database, isolation is forced row-level security with composite keys, money is integer minor units with quoted rates, corrections are reversals, every accounting rule starts as an owner-approved worked example, and the Claude Code setup has real guards. Most of it would survive a professional vendor's review. Two decisions would not, and they sit at the centre of the accounting model: **the "second currency" is defined as a historical amount that is never revalued yet must balance on every entry**, which is arithmetically impossible for a USD invoice settled at a different SYP rate and cannot produce an SYP balance sheet; and **the statutory SYP view that the Syrian tax return and the Commercial Code's journal depend on is left undefined** behind an UNVERIFIED legal question, while company 1 keeps its books in USD. Until ADR 0004 says what the third amount on a line *is* (a parallel statutory ledger with its own exchange differences, or a report-time translation under IAS 21.39), the scenario book, the chart template and the posting function cannot be specified correctly, so this must be settled before S02. Beyond that, the majors are a missing backup and disaster-recovery decision for a ledger that must survive ten years, an owner-approval gate that exists in prose but not in enforcement, a journal numbering rule that conflicts with the Commercial Code's chronological journal, revenue timing tied to invoicing, and a phase order that reaches the first Syrian sale through the heaviest vertical. The market research is good desk work and its core facts hold on re-verification, with two legal facts now readable in the law text and one draft-law requirement that changes the tax timeline. The Claude Code setup is professional and close to sufficient; its gaps are enforcement, not design.

## 2. Scorecard

| Area | Score | One line |
|---|---|---|
| Market research | 4 / 5 | Thorough, labelled, mostly re-verified; no field validation, and two legal facts now stronger than the document says (Commercial Code books in Arabic; the draft tax law requires approved software). |
| Product decisions and phases | 3 / 5 | Right layers and tenancy; phase 1 is shaped by one customer, Syrian essentials (cheques, branches, tax lines, fixed assets, migration) have no phase, and the first sale is reached through the hardest vertical. |
| Accounting policies and treatments | 2 / 5 | IAS 21.28 / 21.23 and IFRS 15 patterns are sound in isolation; the second-currency model is contradictory and the statutory SYP view undefined, which makes the books wrong for the tax return. |
| Technical decisions (ADR 0002–0006) | 4 / 5 | Database-enforced invariants, forced RLS, exact money, idempotent API: stronger than most vendors; missing backups/DR, trigger hardening details, chronological numbering, balances at scale. |
| Claude Code setup | 4 / 5 | Professional, under the context budget, with real hooks and two reviewers; the owner-approval gate and the scenario book are not protected by anything a session cannot bypass. |
| Internal consistency | 3 / 5 | Stale status lines, event names that differ between analysis and contract, a revaluation phase stated two ways, and a research recommendation (SYP books) that the decision contradicts without closing the loop. |

## 3. Findings

Severity: **Blocker** (the books could be wrong, legal exposure, data loss, isolation breach) · **Major** · **Minor** · **Suggestion**.

| # | Severity | Finding | Where |
|---|---|---|---|
| B1 | Blocker | The second-currency balancing invariant is impossible for foreign-currency items settled at a different rate; the posting function would refuse ordinary USD invoices paid in USD | ADR 0004:31–37, 46; ADR 0005:18; `docs/scenarios/README.md:89–90` |
| B2 | Blocker | The statutory SYP view is undefined: historical, never-revalued SYP amounts cannot produce an SYP balance sheet or tax return; company 1's USD books rest on an UNVERIFIED legal premise | `phase-1-scope.md:41, 52`; ADR 0004:46; `market-syria.md:166, 320` |
| M1 | Major | No backup, point-in-time recovery, off-site copy, restore drill or RPO/RTO decision for a ledger that must be kept ten years on one shared VPS | ADR 0002:38; ADR 0005:52–54; `open-questions.md:10` |
| M2 | Major | The owner-approval gate before auto-merge is prose only: nothing refuses `gh pr merge --auto` on a protected path, and GitHub requires no owner review | AGENTS.md:116–117; `.claude/settings.json:58`; `workflow.md:30–38` |
| M3 | Major | Expected values in the scenario book are unprotected, the runner's contract is loose, and every scenario assumes USD functional / SYP second, so the core is tested only in company 1's shape | ADR 0005:74–77; `scenarios/README.md:33–36`; `posting-rule/SKILL.md:35–37` |
| M4 | Major | Gapless numbers given in posting order conflict with the Commercial Code's chronological journal when entries are back-dated inside an open period | ADR 0005:23, 38; `phase-1-scope.md:96, 152`; Law 33/2007 art. 17 |
| M5 | Major | Revenue is recognised only through invoices: no contract asset, late-issued cycles release prior-month revenue in the issue month, milestone revenue is dated at issue rather than at completion | `phase-1-scope.md:168–179`; IFRS 15.31, 15.35(a), 15.107 |
| M6 | Major | The rate behind the SYP amounts and the month-end revaluation is Hub's market rate; the statutory view likely needs the official bulletin, and the IAS 21.26 / 8A exchangeability analysis was not made | ADR 0004:27, 42; `phase-1-scope.md:46` |
| M7 | Major | Tax arrives earlier than the phases assume: the Ministry of Finance is preparing the new system for the start of 2027, and the draft requires an approved accounting program and electronic linkage | `phase-1-scope.md:50, 227`; `vision-and-phases.md:66`; SANA 2026-10-11 |
| M8 | Major | The phase order reaches the first Syrian sale through the heaviest vertical (IMEI, installments, tax QR) while accounting offices, the buyers named in the vision, could be served after phase 2; cheques and notes have no phase | `vision-and-phases.md:16–20, 56–68`; ADR 0001:31–37 |
| M9 | Major | ADR 0005's guards need four details to hold: `ENABLE ALWAYS` triggers, no runtime use of the owner role, one lock order for close and post, and an external anchor for the hash chain before "proves nothing was altered" is claimed | ADR 0005:19, 21, 34–35, 43–46; `phase-1-scope.md:159` |
| M10 | Major | Balances are computed from lines only; at accounting-office and POS volumes the trial balance and statements become full scans, and the fix touches the single posting function | ADR 0005:48–50 |
| M11 | Major | Two legal facts are stronger than the research states and change requirements: the Commercial Code's book rules are now readable (Arabic, chronological, court-certified, ten years, electronic by ministry instruction), and the draft tax law mandates approved software | `market-syria.md:165–166, 185–187` |
| m1 | Minor | ISO 4217: no amendment for Syria found; `SYP` stands (REPORTED, not CONFIRMED on ISO's register); keep the currency table ready for a code change | ADR 0004:12, 49 |
| m2 | Minor | Research dates and names: old-note end given as 2026-07-31 while sources say the window closed 2026-07-30 and the final phase began 2026-08-02; Hub event names differ between the analysis and the contract | `market-syria.md:214`; `phase-1-analysis.md:27–35` vs ADR 0006:54–65 |
| m3 | Minor | Stale status lines: vision and scope say "awaiting the owner's approval" while the roadmap and ADR 0001 say approved | `vision-and-phases.md:3`; `phase-1-scope.md:3`; `ROADMAP.md:9` |
| m4 | Minor | The analysis still lists month-end revaluation and unrealised differences as phase 2 in two places that its own header supersedes | `phase-1-analysis.md:66, 114` |
| m5 | Minor | `409 PERIOD_CLOSED` has a side effect (the event is stored as held), unlike every other 4xx in the table | ADR 0006:41 |
| m6 | Minor | No rule for a third currency (TRY, EUR): which pair converts to functional, how the second amount is derived, and when it equals the transaction amount | ADR 0004:18–27, 31–35 |
| m7 | Minor | The git guard misses `git commit -a` / `-am`, `git add ./`, `git add :/` and `--no-verify` | `.claude/hooks/git-guard.mjs:44, 29` |
| m8 | Minor | Reviewer subagents hold unrestricted Bash and are limited by prose only; the `effort` frontmatter on agents and skills is not a documented field in every Claude Code version | `.claude/agents/reviewer.md:4–6`; `accountant-reviewer.md:4–6` |
| m9 | Minor | `/btw` is named as the channel for side questions but is not a skill in this repository | CLAUDE.md:53; `workflow.md:86` |
| m10 | Minor | `TASKS.md` is git-ignored while the method says knowledge lives in files; a lost machine loses the checklist | `.gitignore:54`; `workflow.md:12` |
| m11 | Minor | Glossary gaps: cheque, post-dated cheque, notes receivable/payable, cost centre, branch, voucher, contract asset, presentation currency, posting date | `docs/glossary.md` |
| m12 | Minor | Spec template lacks sections for volume and performance, printing and legal books, migration and compatibility, and Arabic strings | `docs/specs/_template.md` |
| m13 | Minor | Version drift at the scaffold: Node 24 leaves Active LTS on 2026-10-20, TypeScript 7 and PostgreSQL 18 are stable, Drizzle 1.0 (RC) changes the migration layout that the deny rules and the drift check assume | ADR 0002:9, 26; `.claude/settings.json:101–102` |
| m14 | Minor | Opening balances on 2026-10-01 but Hub history from 2026-10-19: the path for 1–18 October transactions is undefined | `phase-1-scope.md:43`; ADR 0006:86 |
| m15 | Minor | Attachments (F05) have no isolation, storage or size rule in ADR 0003 | `phase-1-scope.md:98`; ADR 0003 |
| m16 | Minor | "Credit lines reduce the same schedule" and service reclassification "on the schedule" can change parts already released, contradicting "a later recomputation never changes parts already posted" | `phase-1-scope.md:172, 181`; ADR 0004:38 |
| m17 | Minor | IAS 29 is not addressed: three-year cumulative inflation to end-2025 is about 214% by the World Bank's figures, Syria is on watch lists; irrelevant to USD-functional non-IFRS reporters, relevant to any SYP-functional IFRS reporter the product may serve | `market-syria.md:193` |
| S1 | Suggestion | A security ADR: threat model, key handling, session policy, encryption at rest, log retention, data residency statement (the server is in Germany) | — |
| S2 | Suggestion | A per-company revenue-deferral policy switch; the general template defaults to invoice basis, which is what Syrian SMEs and their tax offices expect | `phase-1-scope.md:44` |
| S3 | Suggestion | Record the IAS 21.9–12 functional-currency basis as a stored policy note per company | `phase-1-scope.md:41` |
| S4 | Suggestion | Amounts in words (تفقيط) in `packages/i18n` from phase 2 (vouchers, cheques, receipts) | — |
| S5 | Suggestion | A CI check that fails on guard-weakening SQL in migrations (`DISABLE TRIGGER`, `DROP POLICY`, `NO FORCE ROW LEVEL SECURITY`, `UPDATE`/`DELETE` on ledger tables) | `/db-migration` step 6 |
| S6 | Suggestion | Interview five accountants and two offices before the S02 chart template; Syrian chart conventions and voucher habits are not in the research | `market-syria.md:319` |
| S7 | Suggestion | Decide PostgreSQL 18 and Node 26 at the scaffold, or state why not | ADR 0002 |

## 4. Details

### B1 — The second-currency invariant cannot hold (Blocker)

**What.** ADR 0004 requires three amounts on every line and says "every entry balances in the functional currency and in the second currency" (ADR 0004:37; ADR 0005:18), that "the second-currency view of an amount is its historical second-currency amount and is not revalued" (ADR 0004:46), and that any conversion difference larger than half a minor unit per converted line "is an error, never a rounding line" (ADR 0004:37). The scenario example (`docs/scenarios/README.md:63–93`) works only because the invoice and the payment are both denominated in SYP, so the second amount equals the transaction amount on every line and the exchange loss line carries `second: 0`.

**Recomputation.** The example itself is right: 1,220,000 / 122 = 10,000 (USD 100.00); 1,220,000 / 125 = 9,760; loss 240; functional and second both sum to zero. Now take the ordinary case for Vertex Media: a **USD 100 invoice** issued on 2026-11-03 at 122 (second amount 1,220,000) and **paid in USD** on 2026-11-20 at 125. The cash line is USD 100, functional 10,000, second 1,250,000 (the payment's own rate, as the policy requires: "every line also stores its SYP amount at the transaction's rate", `phase-1-scope.md:41`). The receivable credit is USD −100, functional −10,000. Its second amount is either −1,220,000 (the carrying amount, so the open item clears in SYP) or −1,250,000 (so the entry balances). With −1,220,000 the entry is **30,000 SYP out of balance** and the posting function must refuse it, because 30,000 is far beyond the rounding bound. With −1,250,000 the entry balances but the receivable's SYP sub-balance is left at −30,000 after full settlement, so the SYP receivables ledger never agrees with the open items. There is no exchange-difference line in the second currency in the design: the realised-difference line is defined with `second: 0`.

**Why it matters.** Vertex Media invoices mostly in USD, so this is the common path, not an edge case. Either the posting function refuses normal events or the SYP receivables subledger drifts. Both make the SYP view, which is the tax view, wrong.

**Evidence.** ADR 0004:31–37, 46; ADR 0005:18; `docs/scenarios/README.md:85–90`; `docs/product/phase-1-scope.md:41, 184`. Business Central's "Additional Reporting Currency" posts exactly this residual to a dedicated account (Microsoft Learn, "Set up an additional reporting currency"), and SAP's parallel currency types each carry their own differences.

**Smallest fix.** Amend ADR 0004: the posting function may add a **second-currency difference line** (transaction and functional amount zero, second amount ±X) to a designated "translation differences" account whenever settling or revaluing an item leaves the second currency out of balance; the rounding bound applies to conversion rounding only. Add the USD-invoice-paid-in-USD case to the scenario book. This fix only makes sense once B2 is decided, because what the difference line *means* depends on what the second currency is.

### B2 — The statutory SYP view is undefined, and company 1's books rest on an unverified premise (Blocker)

**What.** The scope decides USD as the functional currency and says the SYP view "keeps both possible" until a Syrian auditor answers (`phase-1-scope.md:41, 52`). But the stored SYP amounts are historical and never revalued (ADR 0004:46), so the "trial balance in SYP" (F13, `phase-1-scope.md:150`) carries USD cash received in January at 110 forever at 110, and SYP receivables at their invoice-date rate. That is neither a presentation-currency translation (IAS 21.39: assets and liabilities at the closing rate, income and expenses at transaction-date rates, differences in equity) nor a parallel ledger (where SYP monetary balances are remeasured at each period end with SYP exchange differences). It is a journal-level memorandum. It can print a journal in SYP; it cannot produce an SYP balance sheet, and a tax office that receives one will see cash and receivables at stale rates.

**The legal premise.** Re-verified facts:
- Income Tax Law 24/2003 (CONFIRMED, WIPO Lex text): art. 5(a) business year 1 January–31 December, 5(c) the minister may allow another start; art. 6 regular and complete records; art. 13(a) returns by 30 June (companies) or 30 April; art. 14(a) the return attaches the trading account, P&L, balance sheet and depreciation schedule, 14(c) entries extracted from computer records may be accepted; art. 124 ten-year retention; art. 94 foreign securities listed "in Syrian currency". **The law states no currency or language for the books**; every amount in it is in Syrian pounds.
- Commercial Code 33/2007 (text read on a non-official mirror, so REPORTED): art. 16 the journal and the inventory book are mandatory **and must be kept in Arabic**; art. 17 chronological, no blanks or erasures; art. 18 numbered and certified by the president of the civil court of first instance; art. 19 kept ten years after closing; art. 22 accounts may be kept electronically under the ministry's executive instructions. No article names a currency.
- Decrees 5 and 6 of 2024 forbidding pricing and payment in foreign currency: published on the Central Bank's site, no repeal found in 2025–2026 (CONFIRMED published / UNVERIFIED still enforced). USD invoicing by a private company is therefore formally exposed, whatever the practice.
- Whether a Syrian company may keep its functional books in USD: **UNVERIFIED** in both directions after this audit.

**Why it matters.** The decision affects every number in the scenario book, the chart template (which accounts carry SYP differences), the posting function and the reports. If it changes after S03, posted entries cannot be fixed (they are append-only) and the scenario book is rewritten. For the product, most Syrian customers will be SYP-functional with USD as a management view, and the same question applies in the other direction: a historical USD view of SYP cash is just as wrong for a manager who asks "what is my balance sheet in dollars today".

**Evidence.** `phase-1-scope.md:41, 52, 150`; ADR 0004:33–37, 46; `market-syria.md:29, 166, 283, 320`; `vision-and-phases.md:27`; `open-questions.md:9`.

**Smallest fix.** Decide the meaning of the third amount in a revised ADR 0004 before S02, with two admissible designs:
1. **Parallel statutory ledger (recommended for companies whose functional currency is not SYP):** the second currency is a full book: every line carries its SYP amount at the rate of the day (bulletin or market per company policy), monetary balances are remeasured in SYP at month end with their own unrealised and realised difference accounts, and settlements post the SYP residual of B1. The trial balance, journal and statements in SYP then agree with each other. This is what SAP's parallel currencies and Business Central's additional reporting currency do.
2. **Report-time translation (IAS 21.39) for every company:** store transaction and functional amounts only (plus the rate), and translate at report time: closing rate for the balance sheet, transaction-date rate for income and expenses, the difference in equity. Simpler, generalisable to any presentation currency, but it gives no per-entry SYP journal that a court-certified book or a tax inspector can trace line by line.

Recommendation: keep the three stored amounts and adopt design 1 for the statutory currency, and offer design 2 as a report feature in any currency for management. Put the auditor's answer on USD books before S02 on the critical path, not before the 2027 return; and make SYP the default functional currency of the general template.

### M1 — Backups, recovery and the ten-year promise (Major; becomes a Blocker at first production data)

**What.** The ADRs promise ten-year retention (ADR 0005:53) and never-deleted companies, on "the existing Vertex server beside Hub, behind nginx with PM2" (ADR 0002:38). No document defines RPO/RTO, point-in-time recovery (WAL archiving with pgBackRest or WAL-G), an off-site encrypted copy, a restore drill, or where backups live. Q2 in `open-questions.md:10` notes that Hub keeps backups on the server only.

**Why it matters.** A ledger that loses a month of postings has no legal books for that month; a server that dies loses every customer's books at once. Retention is a promise about *copies*, not about archiving flags.

**Smallest fix.** Write the deployment and backup ADR in Phase 0, before any company data exists: continuous WAL archiving with daily base backups to an off-site bucket outside the server's provider, encryption of backups, a monthly scripted restore into a scratch database with the integrity-chain check run on the restored copy, RPO ≤ 15 minutes and RTO ≤ 4 hours as targets, and a stated data-residency statement for customers (the server is abroad).

### M2 — The owner-approval gate is not enforced (Major)

**What.** `AGENTS.md:116–117` and `workflow.md:30–38` say PRs that change the scope, an ADR, a ledger invariant, the money module, a posting rule or an expected value wait for the owner. But `.claude/settings.json:58` allows `gh pr merge * --auto --merge` unconditionally, no hook inspects the diff, and the repository ruleset only requires CI. One session that forgets the rule, or a compaction that drops it, merges a changed expected value into `main` on green CI. The working method itself says "a wrong accounting rule passes every code test" (`working-method.md:44`).

**Smallest fix.** Two layers, both outside the agent's memory:
1. A `CODEOWNERS` file naming the owner for `docs/decisions/**`, `docs/product/phase-*-scope.md`, `docs/scenarios/**`, `packages/contracts/src/money/**`, `packages/ledger/**`, `packages/db/src/ledger/**` and `packages/db/migrations/**`, plus "require review from code owners" in the `main` ruleset. GitHub then refuses auto-merge without the owner's approval, regardless of what any session does.
2. A `PreToolUse` hook on `gh pr merge` that runs `git diff main...HEAD --name-only`, and exits 2 with a message when a protected path changed and `--auto` is present.

### M3 — The scenario book is the test, but nothing protects it, and it tests one shape (Major)

**What.** Expected values "need the owner's approval" (ADR 0005:77) with no mechanism (see M2). The runner's contract (`scenarios/README.md:46–57`) checks the listed entries and optional balances, but does not say that *no other entries* may be posted, that the audit log received one row per posting, or that a `Proposed` scenario is not a passing test. Every scenario and the schema default assume `functional: USD, second: SYP, template: service-agency` (`scenarios/README.md:34–36`). The property tests cover balance and reversal but no scenario covers an SYP-functional company with no second currency, a third currency, or the general template. The core is thereby tested only in Vertex Media's shape, which is how a general core gets bent to one customer.

**Smallest fix.** CODEOWNERS (M2); the runner treats `Status: Proposed` as skipped and reports it; the runner asserts the exact set of posted entries and the audit rows; and the first scenario PR adds three "shape" cases: SYP-functional with no second currency, USD-functional with SYP second (B1's USD-paid-in-USD case), and a TRY transaction in an SYP-functional company.

### M4 — Gapless posting-order numbers versus the chronological journal (Major)

**What.** Entry numbers are "gapless per company and fiscal year, given at posting" (ADR 0005:23, 38; `phase-1-scope.md:96`), and the journal book is "printable with sequential page numbers" (`phase-1-scope.md:152`). An entry back-dated to 2026-11-05 but posted on 2026-11-28 receives a number higher than entries dated 11-20. The Commercial Code (art. 17, REPORTED) requires the journal "by date, without blanks"; a journal printed in number order is not chronological, and one printed in date order shows numbers out of sequence. Every established system faces this: Odoo numbers by sequence per journal and allows resequencing in open periods; SAP number ranges are gapless in posting order and the legal journal is a date-ordered report.

**Smallest fix.** State in ADR 0005: numbers are gapless in posting order; the entry stores both `entry_date` (accounting date) and `posted_at`; the journal book is printed in `(entry_date, number)` order and the footer explains the rule; and back-dating is allowed only inside open periods (already the case). Alternatively, number at period close by date, which the Syrian "numbered and certified" books tradition fits better but complicates references from Hub. Either is defensible; one must be chosen and written down before S03.

### M5 — Revenue recognition is tied to invoicing (Major)

**What.** Under the scope (`phase-1-scope.md:168–179`):
- Retainer cycles release "evenly over the days of the cycle" from a contract liability created at issue; a "late issue" releases the elapsed days at issue. If the cycle started in a closed month, those days' revenue lands in the issue month: a cut-off error of up to a full cycle, and under IFRS 15.31/35(a) the revenue belongs to the days the service was rendered, as a contract asset or unbilled receivable (IFRS 15.107) when not yet invoiced.
- Milestone invoices are "revenue at issue, since the work is delivered". Hub drafts the invoice when the milestone is done and a person issues it later; if the two dates straddle a month end the revenue is in the wrong month.
- There is no contract asset or unbilled revenue concept anywhere, and no scenario for a period end with work performed and not yet invoiced.

The IFRS 15 patterns themselves (time-elapsed output method, IFRS 15.B18; contract liability for deposits, IFRS 15.106; deposit released in proportion to milestone installments as an allocation by relative amounts) are sound for the facts described. The timing anchor is the problem.

**Smallest fix.** Policy and two rules: (1) retainers are billed in advance, so `cycle_start ≥ issue date − n days` is checked and a late invoice is *held* for the accountant rather than silently recognised at issue; (2) milestone revenue is dated at `milestone.done`, with the invoice line referencing the milestone, and an unbilled-receivable account in the template for the gap; (3) add "contract assets at period end" to phase 2's statements. Write the scenarios for both cut-offs before S06.

### M6 — Which rate feeds the SYP view and the revaluation (Major)

**What.** The second amount of a line uses "the transaction's rate" (`phase-1-scope.md:41`), which for Hub events is Hub's dealing rate (ADR 0004:27, 65), and month-end revaluation uses "the market rate the company deals at" (`phase-1-scope.md:46`), with the bulletin "stored beside it for reference". Facts: the official bulletin was 122.00 around 2026-10-15 to 19 (bulletin 193: buy 121.50 / sell 122.50, REPORTED) and the parallel market about 138 (REPORTED); the Central Bank unified the bulletins by Decision 230/2025 (REPORTED, decision indexed on cb.gov.sy; text not read). IAS 21.26 says that where several rates exist, use the one at which the cash flows could have been settled; the 2023 amendment (IAS 21.8A, 19A, A11–A17, effective 2025) requires an *estimate* when a currency is not exchangeable at the official rate, and professional guidance treats parallel markets as evidence, not as "the" rate. None of this analysis is in the documents. For the statutory SYP ledger (B2), a tax office will more likely expect the official bulletin (UNVERIFIED).

**Smallest fix.** Make the rate type a per-company, per-purpose policy: functional-currency measurement and revaluation at the `market` rate with the IAS 21.26/8A reasoning recorded; the statutory ledger at the `bulletin` rate unless the auditor says otherwise. The rate table already stores both types, so this is a policy field and a scenario, not a model change.

### M7 — Tax arrives before phase 3 (Major)

**What.** The scope says "no tax in phase 1 … the 2027 reform is a draft" and puts tax in phase 3. Re-verified: the two laws are **not enacted** as of 2026-10-20; the Finance Minister said on 2026-08-10 the system is ready for parliament with implementation hoped for the start of 2027, and the Ministry stated on 2026-10-11 that it is preparing to apply the new tax system at the start of next year (CONFIRMED, SANA). The draft sales tax applies to services, and secondary sources report that the draft **requires taxpayers to use an approved accounting program linked electronically to the tax database** (REPORTED). The consumption spending fee remains in force with updated instructions of 2026-07-01 (CONFIRMED, SANA).

**Why it matters.** If the law passes, Vertex Media's invoices in Hub carry sales tax from early 2027, inside phase 1's first closed year, and the ledger needs tax payable accounts, tax lines on `invoice.issued`, and a tax report. The "approved program" status becomes a buying condition for *every* customer, not only retail.

**Smallest fix.** Add optional `taxes[]` (code, base, amount) to invoice lines in the v1 contract now (additive, zero cost), tax payable and consumption-fee accounts to both chart templates, and a tax-summary report placeholder in F13; start the approved-program inquiry with the General Commission for Taxes and Fees in phase 1, not phase 3.

### M8 — Phase order and the first sale (Major; owner's decision)

**What.** Phase 3's first sale is a phone shop: serials (IMEI), installments, inventory, tax invoices with QR, and the tax authority's approval, every one of them hard and some UNVERIFIED. Meanwhile the research names accounting offices as "the people who choose the software in Syria" (`market-syria.md:285`) and the vision lists them second (`vision-and-phases.md:18`). An accounting office needs a fast voucher screen, cheques and notes, printed legal books, fixed assets with the depreciation schedule art. 14 requires, year-end close and the tax forms: nearly all of phases 1 and 2. Cheques and post-dated cheques, the most common Syrian settlement instrument, appear in no phase; neither do branches, partner current accounts, or fixed assets (listed as a module in ADR 0001 but assigned nowhere).

**Smallest fix.** Keep phase 1 as the design-partner phase; add cheques, notes, fixed assets and the Al-Ameen chart/opening-balance import to phase 2; insert a pilot with two accounting offices (GL-only, two or three client companies each) between phases 2 and 3; and sequence phase 3 behind the tax approval procedure rather than ahead of it.

### M9 — Four details without which ADR 0005's guarantees are weaker than claimed (Major)

Verified against PostgreSQL 17 documentation:
1. **`ENABLE ALWAYS`.** A plainly enabled trigger does not fire when `session_replication_role = replica` is set; only `ENABLE ALWAYS` triggers do. The `refuse_change()` and balance triggers must be created `ENABLE ALWAYS`, and the convention test must check it (ADR 0005:19 says "for every role", which does not cover this).
2. **The owner role at runtime.** The table owner can `ALTER TABLE … DISABLE TRIGGER` on user triggers without being superuser. ADR 0003:39 says `mizan_owner` runs migrations; ADR 0005 should add that no application, job or operator session connects as the owner outside a migration, and that the convention test runs as `mizan_app`.
3. **Lock order.** Posting locks the ledger head, then reads the period under a share lock (ADR 0005:34–35). Closing takes an exclusive lock on the period row (ADR 0005:21); if closing also posts (a closing entry, or the audit row through the head), the order is period→head while posting is head→period: a classic deadlock. Fix: closing locks the head first too, and the ADR says so.
4. **The integrity claim.** The scope says the integrity check "proves nothing was altered" (`phase-1-scope.md:159`); ADR 0005:46 admits a superuser can rewrite the chain and defers the external anchor to "a later step". Without an anchor the chain detects accidents, not an insider. Move the daily anchor (the chain head sent to the owner, or published to an append-only external store) into F14, or soften the claim.

Also: the per-company head lock serialises every posting of a company, including the worker's month-end releases and, in phase 3, every POS sale; fine for hundreds a month, worth a note for thousands a day (a per-fiscal-year chain, or batching, keeps the design). And the deferred constraint triggers must be `AFTER … FOR EACH ROW`; a per-entry balance check fires once per line and must be written to check the whole entry idempotently.

### M10 — Balances at scale (Major)

**What.** "Balances and reports are computed from lines on read" with one index (ADR 0005:49); a snapshot "may be added" later. An accounting office with fifty companies, or a shop posting a thousand lines a day, makes a comparative trial balance and a balance sheet with drill-down a scan of years of lines. Adding a period-balance table later changes the single posting function and every report.

**Smallest fix.** Put a `period_balances (company, fiscal period, account, dimension set, currency) → debit, credit per amount type` table in the S03 data model, maintained inside the posting transaction (the posting function is the only writer, so it is deterministic), rebuildable from lines, with a property test that it always equals the lines. This is the standard approach (SAP totals tables, Odoo's read-group on lines plus the period lock).

### M11 — Research facts that moved (Major for requirements, not for the research's quality)

| Fact | Research says | Audit found | Consequence |
|---|---|---|---|
| Commercial Code books | "journal and inventory book … REPORTED (articles not read)" (`market-syria.md:165`) | Arts. 16–22 read (non-official mirror, REPORTED): journal and inventory book **in Arabic**, chronological, numbered and certified by the court, ten years, electronic under ministry instructions | Arabic account names on the printed journal are mandatory, not a preference; M4; an open item on the ministry's instructions for electronic books (art. 22) |
| Books in SYP | UNVERIFIED (`market-syria.md:166`) | Neither law names a currency; Law 24/2003 art. 94 and every figure in SYP; Decrees 5/6 of 2024 unrepealed | Still UNVERIFIED; B2 |
| Tax reform | "drafts … expected early 2027, REPORTED" | Not enacted; Ministry preparing implementation for the start of 2027 (CONFIRMED, SANA 2026-10-11); draft requires approved software and e-linkage (REPORTED) | M7 |
| Consumption fee | Decree 11/2015 amended by Law 15/2024, REPORTED | Executive instructions updated 2026-07-01 (CONFIRMED, SANA) | Keep as a phase 2 tax line |
| Redenomination | 100:1 on 2026-01-01; old notes invalid from 2026-07-31; label "الليرة السورية الجديدة" (CONFIRMED) | 100:1 and the explicit-currency rule REPORTED (Central Bank texts not reachable: certificate error on cb.gov.sy from this environment); window closed 2026-07-30, final phase 2026-08-02; ISO `SYP` unchanged (SIX amendment list shows only Bulgaria for 2026) | m1, m2 |
| Exchange rate | 122.00 on 2026-10-19 (CONFIRMED) | Bulletin 193 of 2026-10-15: 121.50/122.50; parallel ≈ 138 (REPORTED); 10-19 bulletin not reachable | Fine |
| IAS 29 | "watch lists; 2026 UNVERIFIED" | Not on the RCGT list for periods to 30 June 2026, on watch (REPORTED); 2023 127.8%, 2024 58.1%, 2025 forecast −12.7% (World Bank via press) ⇒ about 214% cumulative, above the 100% indicator of IAS 29.3(e) | m17 |
| Salary tax, social insurance, lump-sum share | REPORTED / UNVERIFIED | Still UNVERIFIED; no 2026 bracket table found | No change |

**Missing from the research:** interviews (acknowledged), the Syrian chart-of-accounts conventions accountants expect, the prevalence of post-dated cheques, bank statement formats for reconciliation, Al-Ameen's export formats for migration, and a sizing of the segments (how many real-profit taxpayers, how many offices). Competitor coverage is good; "Wakeed" and "Al-Bayan" are correctly identified as the bar for offline behaviour.

### Minor findings, in brief

- **m1** ISO 4217: the SIX page lists amendment 180 (Bulgaria, 2026-01-01) and nothing for Syria; `SYP` / 760 stands (REPORTED). The currency table in `packages/contracts` already makes a future code change a data change.
- **m2** `market-syria.md:214` dates versus the sources (30 July / 2 August); `phase-1-analysis.md:27–35` uses Hub's current names (`invoice_line.service_changed`, `project_expense.created`, `ad_wallet.deposit`, `ad_campaign_update.*`) while ADR 0006:54–65 defines the contract names (`invoice.line_service_changed`, `project_expense.recorded`, `ad_wallet.deposited`, `ad_spend.recorded`); the ADR should carry the mapping or the analysis a note.
- **m3** `vision-and-phases.md:3` and `phase-1-scope.md:3` still read "proposed, awaiting the owner's approval"; `ROADMAP.md:9` says approved 2026-10-20.
- **m4** `phase-1-analysis.md:66, 114` list revaluation as phase 2; the header (line 3) says the scope wins, but the table should say "superseded".
- **m5** ADR 0006:41: a `409` that stores the event as held breaks the reader's expectation that 4xx stored nothing; return `202 held` with `reason: PERIOD_CLOSED`, or keep `409` and state the side effect in the table.
- **m6** ADR 0004 defines conversion "between two currencies with a quoted rate" but not which rate converts a TRY line into USD functional (direct TRY/USD row, or cross through SYP), nor how the second amount of a TRY line is derived. Rule to write: if the transaction currency equals the second currency, the second amount is the transaction amount; otherwise it is the functional amount converted at the entry's functional→second rate; third currencies need a direct rate row to the functional currency.
- **m7** `git-guard.mjs:44` tests ` -A `, `--all`, ` . `, `-u`; `git commit -a`, `git commit -am`, `git add ./` and `git add :/` pass, and `git commit --no-verify` bypasses git hooks. Extend the regex and deny `--no-verify`.
- **m8** `reviewer.md:4` and `accountant-reviewer.md:4` give unrestricted `Bash` and rely on prose; prefer `Bash(git diff *)`-style restriction where the installed Claude Code version supports it, and verify that `effort:` in agent and skill frontmatter is honoured by the installed version (it is silently ignored where unsupported).
- **m9** `/btw` (CLAUDE.md:53, `workflow.md:86`) is not a skill in `.claude/skills/`; either add one or name the built-in command exactly.
- **m10** `TASKS.md` is ignored (`.gitignore:54`); keep it ignored but say in `workflow.md` that it is local and regenerated from the spec, or commit it per branch.
- **m11** Glossary additions: شيك / cheque, شيك مؤجل / post-dated cheque, أوراق قبض ودفع / notes receivable and payable, مركز كلفة / cost centre (named in `working-method.md:46`, absent from the glossary), فرع / branch, سند / voucher, أصل عقد / contract asset, عملة العرض / presentation currency, تاريخ الترحيل / posting date.
- **m12** Spec template: add "Volume and performance", "Printing and legal books", "Migration and compatibility", "Arabic strings and number formats".
- **m13** Stack facts on 2026-10-20: NestJS 12.0.0 (2026-08-27, Standard Schema support since 12.0, so ADR 0002:11 is right); TypeScript 6.0 (2026-03) is the last JS-based release and 7.0 is stable (2026-07), so `~6.0` is a deliberate pin worth a sentence; Node 24 leaves Active LTS on 2026-10-20 and Node 26 is the next LTS; PostgreSQL 18 (2025-09) is stable and 17 is supported to 2029; Drizzle stable is 0.45 and 1.0 (RC) removes `meta/_journal.json`, which the deny rules (`settings.json:101–102`) and the drift check (`checker.md:22`) assume; Better Auth 1.7 has TOTP and backup codes; pg-boss 12 needs its own schema, consistent with `mizan_queue`.
- **m14** `phase-1-scope.md:43` opens the books on 2026-10-01 with Hub history from 2026-10-19 (`phase-1-analysis.md:17`): 1–18 October invoices and payments are either in Hub (then replay starts earlier) or manual (then F12 must say so).
- **m15** Attachments on entries (`phase-1-scope.md:98`): add to ADR 0003 that files are stored under a company-scoped path, served only through an endpoint that checks the company context, with a size limit and a type allow-list.
- **m16** `phase-1-scope.md:172, 181` versus ADR 0004:38: a credit line for a past cycle, or a reclassification "on the schedule", must not alter released parts; define them as prospective adjustments to the remaining schedule, with a scenario.
- **m17** IAS 29: irrelevant to a USD-functional, non-IFRS company; state in the scope that hyperinflation accounting is out of scope and that an SYP-functional IFRS reporter must assess IAS 29.3 themselves.

### What a professional vendor would choose, honestly

- **PostgreSQL with forced RLS in a pool model, composite company keys, append-only grants and deferred constraint triggers:** this is what the careful vendors do (and better than most, who rely on application filters). Verified: `FORCE ROW LEVEL SECURITY` binds the owner; foreign-key checks bypass RLS, so the composite keys are necessary, not pedantic; superusers and `BYPASSRLS` roles always bypass, which is why M9 matters.
- **Node/NestJS/TypeScript with `BigInt` money:** adequate; Java/.NET shops have richer decimal and reporting libraries, but the pure `packages/ledger` with property tests closes most of the gap. Drizzle is thinner than Flyway/Liquibase for trigger- and policy-heavy migrations; custom SQL migrations are unavoidable and the skill already expects them.
- **One shared VPS with PM2 and nginx:** weaker than a managed PostgreSQL with automated PITR and a replica. Acceptable for phases 1–2 with M1 done; not acceptable for phase 4 without a replica or a managed database. Say so in the deployment ADR.
- **Three amounts per line:** the SAP/Business Central shape, which is the right one; only the semantics (B1, B2) are missing.
- **Hash chain:** Odoo's inalterability feature does the same (SHA-256 per journal, previous hash included, cannot be switched off once posted); the anchor is what Odoo lacks and what would make the claim true.
- **Gapless numbering by locked counter:** standard; the chronological journal (M4) is the part vendors document and this design does not yet.
- **pg-boss instead of Redis-backed queues:** right for one server and one database; it keeps the transactional outbox pattern simple.
- **Better Auth with TOTP:** fine for SMB SaaS; a security ADR (S1) should cover what it does not (session policy, key rotation, audit of exports).
- **Reports on the Node side with PDF through Chromium:** fine; heavy on a shared VPS, so the worker's concurrency must be bounded.

### The Claude Code setup, honestly

Professional: under 200 lines of always-loaded instructions, skills with gates and stop points, a Haiku checker, two Opus reviewers in fresh contexts, hooks that cost no context, confirmation labels, a glossary, and a scenario book as the oracle. Nothing is over-engineered for an accounting system; the four reference repositories and the reviewers' breadth are proportionate. What is missing is **enforcement that survives a session**: CODEOWNERS and a merge hook (M2), scenario protection and shape coverage (M3), the git-guard holes (m7), and restriction of the reviewers' Bash (m8). Two documentation nits (m9, m10). The `explorer` agent may read the reference repositories, which the owner allows; this audit did not use it for that.

## 5. What is sound

- Database-enforced invariants, one posting function, reversal-only corrections, append-only audit in the same transaction (ADR 0005). Right, and rare.
- Forced RLS pool model, company context from session or key, composite foreign keys, no `SECURITY DEFINER`, convention and cross-company tests (ADR 0003). Right.
- Integer minor units, ISO codes, rates stored as quoted and never inverted, one conversion function rounding half away from zero, cumulative-rounding allocation (ADR 0004 amounts and allocation). Right; the example recomputes exactly.
- IAS 21.28 realised differences against the carrying amount; IAS 21.23 month-end revaluation of monetary items with a reversing entry; non-monetary items never revalued (IFRIC 22 behaviour). Right for the functional currency.
- IFRS 15 patterns: contract liability at issue, time-elapsed release for stand-ready retainers (15.B18), deposit released by milestone proportion, void reverses releases, cancelled remainder to a decision list. Right, given M5's timing fix.
- Client ad funds as a liability, never revenue; pass-through outside service profit. Right.
- The posting API: versioned path plus event versions, idempotency by key with canonical payload hash and `409` on conflict, held events with reasons and automatic retry on `UNKNOWN_REFERENCE`, closed-period refusal, daily reconciliation with a per-event listing, stable error codes, additive-only `/v1`. A better contract than any regional product's.
- Fiscal year as a company setting (Law 24/2003 art. 5(c) allows exceptions). Archive, never delete. Arabic-first with Latin digits. The redenomination refusal of pre-2026 SYP amounts.
- The working method: scenarios before code, owner approval of numbers, two reviewers, labels on Syrian facts, context economy.

## 6. Recommended changes, in order

1. **Decide B2 and amend ADR 0004** (second-currency semantics, the difference line of B1, the rate per purpose of M6, the third-currency rule of m6). Before S02. Owner plus a Syrian auditor's written answer on USD books.
2. **Enforce the approval gate:** CODEOWNERS, "require code owner review" on `main`, and the merge hook (M2); extend the git guard (m7). One docs/chore PR, this week.
3. **Write the deployment and backup ADR** in Phase 0 with PITR, off-site encrypted copies, restore drills and RPO/RTO (M1).
4. **Amend ADR 0005:** chronological journal rule and `posted_at` (M4), `ENABLE ALWAYS`, owner-role rule, lock order, anchor in F14 (M9), the period-balance table (M10), runner contract and shape scenarios (M3).
5. **Amend the scope §6** for cut-offs: retainers billed in advance or held, milestone revenue at `milestone.done`, unbilled receivable account (M5); prospective schedule adjustments (m16); the 1–18 October path (m14).
6. **Add tax readiness now:** optional `taxes[]` on invoice lines, tax accounts in both templates, the approved-program inquiry (M7).
7. **Re-plan phases 2–3:** cheques and notes, fixed assets, import from Al-Ameen in phase 2; an accounting-office pilot before phase 3 (M8). Owner's decision.
8. **Update the research** with the Commercial Code articles, the tax-reform status, the dates, and the IAS 29 figures (M11, m1, m2, m17); fix the stale statuses and names (m3, m4, m5).
9. **Housekeeping:** glossary (m11), template (m12), `/btw` (m9), `TASKS.md` note (m10), attachments rule (m15), versions at scaffold (m13, S7), security ADR (S1), interviews before the chart template (S6).

## 7. Questions for the owner

Each with the auditor's recommendation. None was answered during the audit.

1. **What is the third amount on a line?** (B1, B2) A parallel statutory ledger in SYP with its own exchange differences, or a report-time IAS 21.39 translation? Recommendation: the parallel statutory ledger for companies whose functional currency is not SYP, and report-time translation as a management report for everyone.
2. **Does Vertex Media keep USD as its functional currency?** (B2) It needs the auditor's written view on USD books and on Decrees 5/6 before S02, not before the 2027 return. Recommendation: obtain it now; if USD stands, the SYP statutory ledger of question 1 is mandatory; make SYP the default for every other company.
3. **Which rate for the statutory SYP ledger and for revaluation?** (M6) Recommendation: the official bulletin for the statutory ledger, the market rate for functional-currency measurement, both recorded as a company policy with the IAS 21.26/8A reasoning.
4. **When is the backup ADR written?** (M1) Recommendation: in Phase 0, before the first migration runs on the server.
5. **May CODEOWNERS and the required review be added to the `main` ruleset now?** (M2) Recommendation: yes, this week.
6. **Numbering rule for the journal?** (M4) Recommendation: gapless in posting order, journal printed by date then number, `posted_at` stored.
7. **Revenue cut-off policy for late-issued retainers and milestones?** (M5) Recommendation: hold late retainer invoices for the accountant; date milestone revenue at `milestone.done`.
8. **Add `taxes[]` to the v1 contract and tax accounts to the templates now?** (M7) Recommendation: yes; and open the approved-program inquiry in phase 1.
9. **Re-order phases 2–3?** (M8) Recommendation: cheques, notes, fixed assets and Al-Ameen import in phase 2; an accounting-office pilot before the phone-shop vertical.
10. **External anchor of the hash chain in phase 1?** (M9) Recommendation: yes, a daily chain head by email, so the trust claim is true from the first closed month.
11. **How are 1–18 October 2026 transactions brought in?** (m14) Recommendation: replay from Hub if they are there, otherwise manual entries listed in F12.
12. **Hosting location and data-residency statement for customers?** (S1) Recommendation: state it plainly in the deployment ADR and the terms; the research found no localisation law (UNVERIFIED), and customers distrust the cloud.
13. **PostgreSQL 18 and Node 26 at the scaffold?** (S7) Recommendation: PostgreSQL 18 yes (supported to 2030); Node 26 if NestJS 12 and pg-boss support it on the scaffold date, else Node 24 maintenance LTS.

## Sources consulted during this audit

- Income Tax Law 24/2003, full Arabic text: https://www.wipo.int/wipolex/en/text/581066 (arts. 5, 6, 13, 14, 94, 124)
- Commercial Code 33/2007, text on a non-official mirror: https://lawyeregypt.net/?p=17538 (arts. 16–19, 22)
- SANA, Finance Minister 2026-08-10: https://sana.sy/economy/syrian-economy/2550024/ ; Ministry statement 2026-10-11: https://sana.sy/economy/syrian-economy/2603216/ ; draft sales tax: https://sana.sy/economy/2291888/ ; consumption-fee instructions 2026-07-01: https://sana.sy/economy/2515968/
- Syria Report on the draft laws: https://syria-report.com/draft-tax-laws-mark-shift-in-syrias-fiscal-system/ ; Noon Post on the draft's approved-program requirement: https://www.noonpost.com/348652/
- Bulletin 193 and the parallel rate: https://banker.news/156347 ; Central Bank decisions index (Decision 230): https://cb.gov.sy/downloads/files/1757841704.PDF (cb.gov.sy itself returned a certificate error from this environment)
- Redenomination coverage: https://www.aljazeera.net/ebusiness/2025/12/29/ ; https://www.annahar.com/arab-world/arabian-levant/323812/ ; https://www.aljazeera.net/ebusiness/2026/8/2/
- Decrees 5 and 6 of 2024: https://stj-sy.org/wp-content/uploads/2024/05/Syria_Two-New-Decrees-to-Regulate-Use-of-Foreign-Currencies-and-Money-Exchange.pdf
- ISO 4217 amendments (SIX): https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html
- Hyperinflation lists: https://www.rcgt.com/en/insights/expert-advice/ifrs--pays-hyperinflationnistes--mise-a-jour-pour-les-periodes-se-terminant-le-30-juin-2026/ ; https://www.iasplus.com/en/news/2023/12/hyperinflationary-economies
- IAS 21 lack of exchangeability: https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/technical/ifrs-technical-resources/documents/ey-ifrs-devel-220-ias-21-lack-of-exchangeability-september-2023.pdf ; https://kpmg.com/xx/en/our-insights/ifrg/2024/frut-exchange-rates.html ; IAS 29 text: https://www.faronline.se/dokument/ifrs-english/ias/ias0029_eng/ ; IFRS 15 text: https://www.faronline.se/dokument/ifrs-english/ifrs/ifrs0015_eng/
- PostgreSQL 17: https://www.postgresql.org/docs/17/ddl-rowsecurity.html ; https://www.postgresql.org/docs/17/sql-createtrigger.html ; https://www.postgresql.org/docs/17/sql-altertable.html
- Business Central additional reporting currency: https://learn.microsoft.com/en-au/dynamics365/business-central/finance-how-setup-additional-currencies ; SAP currency types: https://learning.sap.com/courses/customizing-core-settings-in-financial-accounting-in-sap-s4hana/managing-currency-types-1 ; Odoo inalterability: https://www.odoo.com/documentation/19.0/fr/applications/finance/accounting/reporting/data_inalterability.html
- Versions: npm registry and GitHub releases for NestJS, TypeScript, Drizzle, Better Auth, pg-boss, Biome, Vitest, fast-check, Playwright, exceljs; https://endoflife.date for Node and PostgreSQL

Paragraph numbers of IAS 21 (other than 8–8A and 19A), IFRS 15, IAS 8 and IAS 1 are cited from the auditor's knowledge of the standards and could not be re-read on ifrs.org from this environment; IAS 29.2–4 and 8 were read in full.
