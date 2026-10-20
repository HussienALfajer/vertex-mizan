# 0009 — Brand and design system: the Vertex identity, accounting components, company branding on printed books

Status: Accepted · Date: 2026-10-20 (owner)

## Context
The owner wants one visual identity across the Vertex systems. Vertex Hub holds the reference identity (`D:\vertex-hub\brand\identity.md`) and a design system on shadcn/ui and Base UI (Hub ADR 0004). Vertex Food copied it with its own product word (Food ADR 0018). ADR 0002 names `packages/ui` and `packages/tokens` but no decision said what Mizan's identity is or which components an accounting system needs that Hub does not have. An accounting interface lives in dense tables of numbers, keyboard entry and printed legal books, inside a right-to-left Arabic interface where numbers run left to right.

## Decision

### Identity
- **The Vertex identity, unchanged** (owner, 2026-10-20): the colors, tonal and status scales, typography (Noto Kufi Arabic and Montserrat, self-hosted), the 60° motif, the 4 px grid and the light and dark themes of `D:\vertex-hub\brand\identity.md`.
- **Copy and adapt.** The identity is copied into `brand/identity.md`. Changes to the shared identity are made in Vertex Hub first, in a task the owner authorises, then copied here.
- **Logo:** the Vertex Hub logo with the product word **MIZAN** in place of MEDIA, in the same typeface and tracking, as Food and Shifa did. Spacing is adjusted for the five-letter word, and the owner sees the result before it is used.
  - **Variants:** mark, logo, favicon.
  - **Names:** "Vertex Mizan" and Arabic "فيرتكس ميزان".

### Components
- **Base:** Vertex Hub's `packages/ui` components, copied and adapted. `packages/tokens` is the single source of design values, checked by token tests.
- **Accounting components,** built in Phase 0 or with their first spec:

  | Component | Purpose |
  |---|---|
  | **Amount** | Shows one amount with its currency. It uses Latin, tabular digits and thousands separators, keeps the currency's exponent, and is aligned for columns. It is **isolated left-to-right inside the Arabic interface**, so the sign never moves. |
  | **Amount input** | Typed in major units and stored as minor units through the money module; no float at any step |
  | **Entry grid** | Debit and credit lines of a journal entry. Keyboard-first: Enter and Tab move between cells, and new lines are added from the keyboard. It shows the running difference in each ledger until the entry balances. |
  | **Account picker** | Search by code or Arabic or English name in the chart tree; blocked and header accounts cannot be chosen |
  | **Dimension picker** | The dimensions an account requires, with search |
  | **Ledger switch** | Book ledger (SYP) or parallel ledger (USD) on every report |
  | **Period badge** | Open, closed or reopened, wherever a date can be chosen |
  | **Report table** | Dense rows, subtotals, comparative columns, drill-down from any figure to its entries, export to Excel and PDF |
  | **Print layouts** | A4, Arabic: the journal book with sequential page numbers, the statements and the account statement. Each carries the company header and the print footer. |
- **Negative amounts** (owner, 2026-10-20): **a minus sign and the negative (red) color everywhere**: screens, printed books and statements, and Excel exports. Entry grids show debit and credit columns without signs. Because the sign is always present, nothing depends on color alone, and black-and-white prints stay correct.

### Company branding on printed output
- Printed books, statements and reports carry the **company's** name, logo and registration number in the header. They are the company's books, presented to the tax authority and the court.
- A small "Powered by Vertex Mizan" line sits in the footer, with the print date and page *n* of *m*.
- SYP amounts are labelled "الليرة السورية الجديدة" (ADR 0007).

### UI rules
These are the rules of `AGENTS.md`:
- Arabic-first RTL with logical CSS;
- every text through i18n;
- Latin digits;
- design-system components and tokens only;
- responsive from 360 px.

Dense accounting screens (the entry grid, report tables) are designed for desktop first and stay usable on a tablet. On a phone they may scroll sideways inside their own table, never the page.

## Consequences
- Phase 0 gets its own brand and design-system item:
  - `brand/` with the MIZAN logo for the owner's approval;
  - `packages/tokens` and `packages/ui` copied from Vertex Hub;
  - the Amount and Amount input components;
  - the RTL web shell;
  - light and dark RTL screenshots at phone, tablet and desktop widths.

  The remaining accounting components arrive with their first spec (S02 account picker, S03 entry grid, S09 report table and print layouts).
- The isolation of numbers from the RTL text, and the sign, are tested once in the Amount component; every screen reuses it.
