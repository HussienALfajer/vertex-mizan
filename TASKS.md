# TASKS

## In progress: S13 adjustments from the owner's testing (`fix/s13-testing-adjustments`)

The owner asked (2026-11-20) to collect every change first and run the checks, the reviewers and the PR once the testing is done; they said so on 2026-11-20.

- [x] Movement and material-cost filters: the dates on the same line as the other filters (`DateRangeField`'s `labelHidden`), "من تاريخ" / "إلى تاريخ"
- [x] Thousands separators while typing, in every figure field (`groupTypedDecimal()`, `ungroupTypedDecimal()`, `useTypedDecimal`; `AmountInput`, `RateInput`, the movement dialog's quantity and unit price)
- [x] Sidebar: larger links, the design-system link removed from the navigation and the palette
- [x] Tests: `groupTypedDecimal()` with a property test, `AmountInput` and `RateInput` grouping, `DateRangeField`'s `labelHidden`; `packages/ui/CLAUDE.md` and `docs/ROADMAP.md`
- [ ] `pnpm verify --e2e-all`, the reviewer and the accountant-reviewer (the money module's text helpers), then the PR

## Carried over

- [ ] Follow-up (reviewer, not blocking, ADR 0020 deployment): the migrations still run as `vertexmizan`, which can read the owner URL from the migration's environment during a deploy; a dedicated migration user, or connection logging on `mizan_owner`, closes it
- [ ] Owner: replace the two B2 application keys and the mailbox password shown during the setup (the server still used them at 14:32 UTC on 2026-11-13): new values in `/etc/mizan/backup.env` and the password in `shared/.env`, provisioning run again, then the old keys deleted in B2
