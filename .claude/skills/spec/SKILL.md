---
name: spec
description: Interview the owner about a feature group from docs/ROADMAP.md and write its spec to docs/specs/, including its accounting treatment and the scenarios it needs. First step of the feature cycle, before any plan or code.
argument-hint: <spec id, e.g. S03>
disable-model-invocation: true
effort: high
---

Write the spec for **$ARGUMENTS**.

## 1. Read (only this)
- The spec's line in `docs/ROADMAP.md` (its features), then each feature's section of the current phase scope (`docs/product/phase-1-scope.md`): find the heading with a search and read that section only. For anything that posts to the ledger, also read the scope's §4 (policies) and §6 (treatment of Hub events).
- `docs/open-questions.md`, and the ADRs the features touch (`docs/decisions/README.md` lists them):
  - anything with company data reads 0003;
  - money reads 0007;
  - the ledger reads 0005;
  - the Hub API reads 0006.
- Specs it depends on in `docs/specs/`, existing scenarios in `docs/scenarios/`, the relevant schema and contracts when they exist, and `docs/glossary.md`.
- For Hub-facing features, the Hub side of the contract in `D:\vertex-hub` (read only), through the `explorer` subagent.
- The template: `docs/specs/_template.md`.

## 2. Interview the owner
- In Arabic, with the question tool, at most 4 questions per round. Each question has concrete options and your recommendation first, with the standard it rests on (for example IAS 21.23).
- Ask only what changes the result:
  - accounting treatment and accounts;
  - rounding;
  - which rate;
  - period effects;
  - who can do what;
  - required fields;
  - what the accountant sees;
  - API behaviour and error codes;
  - edge cases.

  Don't ask what the scope, an ADR or the code already answers.
- **Never decide an accounting or business question yourself.** Syrian legal or tax facts carry their label; an UNVERIFIED one needs the owner's written decision before the spec relies on it.
- Open questions that block this spec are asked here; record the answers. Never fill one in yourself.
- Stop when every template section can be written without guessing.

## 3. Write
- `docs/specs/<id>-<kebab-name>.md` in English, following the template. Mark anything still undecided under "Open questions".
- List under "Scenarios" every accounting rule the spec introduces or changes. Each becomes a `/posting-rule` before its code.
- New terms go to `docs/glossary.md`. Answered open questions move to Resolved in `docs/open-questions.md` with the date. A decision that shapes the system also gets an ADR.
- Mark the spec `[~]` in `docs/ROADMAP.md`.

## 4. Hand over
- Summarise the spec for the owner in Arabic, in a few lines:
  - what it does;
  - the main rules;
  - the entries it posts, with one example in numbers;
  - what stays open.
- Revise until the owner approves, then set `Status: Approved`.
- In the same turn, open the spec's PR on branch `docs/<id>-spec` following "Finishing a task" in `AGENTS.md`.
- The next session starts with `/posting-rule` for each listed scenario, then `/feature-slice <id>`.
