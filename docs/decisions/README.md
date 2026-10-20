# Decision records

Short records of decisions that shape the system. Each has a status: **Accepted**, **Superseded by NNNN**, or **Proposed**. To change a decision, add a new record that supersedes the old one; don't rewrite history.

| # | Decision | Status |
|---|---|---|
| [0001](0001-vertex-mizan-product.md) | Vertex Mizan: a multi-company accounting product with a permanent core, optional modules and an integration layer | Accepted |
| [0002](0002-stack-and-repository.md) | Stack and repository: Vertex Hub's stack, one monorepo, a pure ledger package | Accepted (versions amended by 0008) |
| [0003](0003-tenancy-and-access.md) | Tenancy and access: companies isolated by forced row-level security, people with memberships, API clients per company | Accepted (attachments amended by 0008) |
| [0004](0004-money-and-currencies.md) | Money and currencies: integer minor units, quoted rates, three amounts on every line | Superseded by 0007 |
| [0005](0005-ledger-invariants.md) | Ledger invariants: guaranteed by the database, written by one posting function, proven by a hash chain and the scenario book | Accepted (amended by 0008; currencies in 0007) |
| [0006](0006-hub-posting-api-contract.md) | The posting API contract with Vertex Hub: versioned events, exactly once, closed periods, daily reconciliation | Accepted (amended by 0008) |
| [0007](0007-book-and-parallel-currency-ledgers.md) | Money and currencies: a book currency and a parallel currency ledger, a rate policy per ledger | Accepted |
| [0008](0008-foundation-audit-amendments.md) | Amendments after the foundation audit: journal order, hardened guards, period balances, scenario runner, API holds and tax lines | Accepted |
