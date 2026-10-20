# Market research: accounting software in Syria and the region

- **Date:** 2026-10-20
- **Purpose:** ground the product decisions for Vertex Mizan (ADR 0001, phase scopes) in facts about the Syrian market, its competitors, and its legal, tax and currency rules.
- **Method:** desk research (web search, vendor sites, official Syrian sources, public app bundles, trademark aggregators, domain registrar API). No interviews yet. Every price is the one shown on the cited page on the date seen; prices change.
- **Not legal or tax advice.** Rules below must be confirmed with a Syrian tax adviser and lawyer before they become product requirements.

## Confidence labels

Every fact that a requirement may depend on carries one of these labels:

| Label | Meaning |
|---|---|
| **CONFIRMED** | Read on an official source (Central Bank of Syria, SANA, the law text, the vendor's own pricing or documentation page). |
| **REPORTED** | Reputable news or a secondary legal source; not read in the official text. |
| **UNVERIFIED** | Single weak source, a search snippet, inference, or memory. Do not build on it without checking. |

Under the project rules, any Syrian legal or tax detail that is not CONFIRMED is treated as unconfirmed ("غير مؤكد").

---

## 1. Executive summary

1. **The Syrian market runs on old desktop software.** Al-Ameen (founded in Syria in 1992) is the default skill accountants are hired for; Al-Bayan, Al-Idari, Sahli Soft and dozens of local programs follow. They are Windows/LAN products sold as one-time licences through dealers, with SYP and a manually typed USD rate. Users call Al-Ameen "outdated" but stay because everyone knows it.
2. **A modern Syrian challenger already exists: Wakeed (وكيد), wakeed.app.** It is cloud plus offline, multi-company, Arabic/English/Turkish, with an exchange-rate bulletin feed for Syria, a Syrian tax-invoice template, cheques, installments, POS, AI OCR and even a "Connect Claude" connector. It is the closest competitor to the Vertex Mizan concept. Al-Bayan ($20–40/month, cloud with offline sync) is the second.
3. **Regional cloud leaders (Daftra, Qoyod, Wafeq, Rewaa, Edara) are built for Saudi ZATCA and Egyptian ETA,** bill in SAR/USD by card, and do not target Syria. Daftra is the only one confirmed to accept Syrian sign-ups.
4. **International products are weak fits:** QuickBooks is blocked in Syria; Business Central is not offered in Syria and has no Arabic; Xero has no Arabic; Zoho is partly usable and has Arabic but charges per organisation with no consolidation; Odoo and ERPNext are usable only self-hosted in practice, with known Arabic print/RTL issues and no Syrian partner network.
5. **The currency changed.** Since 2026-01-01 the legal currency is the **new Syrian pound** (100 old = 1 new, ISO code still SYP). Old notes stopped being legal tender on 2026-07-31. Documents must state the new currency explicitly. No competitor we examined documents native support for the redenomination. **CONFIRMED.**
6. **Dual currency is daily reality:** official Central Bank rate 122.00 SYP/USD on 2026-10-19 versus a parallel rate around 138. Dollar dealing is still formally restricted by Decrees 5 and 6 of 2024 but not enforced. Books should be in SYP with USD as a shadow/reporting currency and stored dated rates.
7. **The tax system is in transition.** Income Tax Law 24/2003 still applies; no VAT; a consumption spending fee applies to some sectors. New income-tax and sales-tax laws are drafts expected to apply from early 2027. Tax rules must be versioned, dated configuration.
8. **The tax authority approves accounting programs** and requires some taxpayer groups to link invoices electronically with QR codes. Being on that approved list is very likely a buying requirement for retail and distribution customers (phase 3). **REPORTED; current rules for 2026 UNVERIFIED.**
9. **Name:** "Vertex Mizan" as a whole is distinctive and its domains are free, but "Mizan/ميزان" alone is crowded in accounting: a Saudi cloud accounting SaaS called Mezan (ميزان), an accounting app "المِيزان" with 50K+ downloads, and reportedly a program called "الميزان" on the Syrian tax authority's approved list. Overall naming risk: **medium**; always use the full name.

---

## 2. How Syrian businesses keep their books

- **Desktop/LAN software + a local accountant + Excel** is the dominant setup. Job ads ask for "mastery of accounting programs and advanced Excel"; installation, backup and restore are done by dealers or freelancers. (Job boards, Mostaql projects.) **REPORTED.**
- **Payment for software:** historically one-time perpetual licences, roughly $200 single-user and $700+ for network editions (SEO listicles, unreliable). New entrants sell subscriptions: Al-Bayan $20/$40 per month billed every 6 months; Wakeed's new subscriptions are "pending review, activated after approval", which suggests manual or cash payment. **UNVERIFIED (licence prices), CONFIRMED (Al-Bayan prices).**
- **Trust in the cloud is low.** A Damascus University study of tourism companies found most do not use cloud accounting, mainly from fear of outside access to their financial data. **REPORTED.**
- **Infrastructure:** fixed broadband averaged 4.6 Mbit/s in May 2024 (179th of 181); the grid cannot meet demand and shops rely on diesel generators. Products that serve Syria (Al-Bayan, Wakeed) all advertise offline work and later sync. **REPORTED.**
- **Larger firms and banks** historically used Transtek Compass ERP (founded in Damascus 2000, now Beirut; an estimated 80% of the Syrian ERP market in 2008 when sanctions kept Oracle/SAP out). NGOs often use QuickBooks. **REPORTED, dated.**
- **Mobile-phone shops (IMEI + installments):** no Syrian vertical product was found. Generic tools track serials (Daftra, Edara, Odoo, ERPNext) or installments (Daftra, Wakeed, DEXEF) but none combines IMEI tracking, installment schedules and SYP/USD. **UNVERIFIED (absence of evidence).**

---

## 3. Competitors

### 3.1 Syrian and Syria-used products

#### Al-Ameen (الأمين) — alameensoft.com

| | |
|---|---|
| Vendor | Al-Ameen Soft, founded 1992 in Syria as "SyrianSoft"; now operates from Cairo and the UAE (alameensoft FZE), with KSA/UAE/Egypt sites. Syria listed among agent countries. |
| Deployment | Known in Syria as Windows desktop/LAN (SQL Server per older sources); the vendor now also sells a cloud edition and mobile dashboard apps. |
| Features | GL, sales, purchases, treasury, **cheques**, multi-warehouse inventory with price levels, manufacturing/MRP, POS, HR, CRM, e-commerce connectors, vertical editions (restaurants, hotels, hospitals, gold, car rental). Multi-currency since Al-Ameen 97. |
| Price | No public price (quote form). A competitor (Daftra, 2025-10-21) lists 249/349 SAR per month in KSA. Syrian listicles say $300–700 one-time. **UNVERIFIED.** |
| Strengths | 30 years of brand; the skill Syrian accountants already have; deep feature set; reportedly on the tax authority's approved list. |
| Weaknesses | Seen as dated and desktop-centric; needs local IT for install and backup; the company's centre has moved out of Syria. |
| Complaints | Reddit r/Syria: "almost everyone uses Al-Ameen, but it is outdated"; users want better metrics and reports. **REPORTED (snippet).** |

#### Wakeed (وكيد للحلول المالية والإدارية) — wakeed.app

The name the user remembered as "وكيد" is confirmed: **Wakeed**, by Rikaz Software Development (rikaz.tech; addresses in Gaziantep, Turkey and Muscat, Oman). Syrian origin is inferred from Syrian accounting vocabulary and a built-in Syrian tax template, not stated. Web visibility is very low (no reviews, almost no search results); evidence comes from the public web app bundle (last modified 2026-10-17).

| | |
|---|---|
| Deployment | Flutter app on web, Android, iOS and the Windows store; Laravel backend; offline mode with local SQLite cache and sync. |
| Features | **Multi-company** ("subscriptions" a user can switch between), branches with their own warehouses, cash boxes, cost centres and taxes; base vs account currency; **exchange-rate bulletin**, exchange-difference vouchers, a "Wakeed–Syria currency integration" and a "smart auditor" that compares invoice rates with the official bulletin; **Syria tax settings with export/post to the tax authority and QR**, Jordan and ZATCA integrations; cheques; **installment agreements**; POS with scales and barcode; e-store, manufacturing, HR, projects, CRM; AI OCR to create invoices; a "Connect Claude" (MCP-style) connector. |
| Not found | IMEI/serial tracking. SYP is not in the built-in currency list; Syria rates come through the integration. |
| Price | No public price ("inquire about plans"); subscriptions activated manually. |
| Assessment | **The closest direct competitor.** Modern, Syria-aware, multi-company, AI-forward. Weak brand presence today. |

#### Al-Bayan (البيان للمحاسبة والمستودعات) — bayansoft.com

| | |
|---|---|
| Vendor | Al-Bayan Software, early 1990s, listed in Homs; Facebook page "البيان للمحاسبة و المستودعات – دمشق"; Omani phone number on pricing page. |
| Deployment | Cloud, local, or synchronised branches that keep working during outages and sync later; mobile sales app with GPS/offline, manager, stock-count, price-checker and restaurant apps. |
| Features | Accounting and warehouses, multi-branch, POS, automatic currency-difference entries, report builder (claims 158,000 report types), loyalty and WhatsApp/Telegram/SMS messaging, many vertical editions. Shows a Syrian tax authority logo. |
| Price | **$20/month Basic, $40/month Full**, billed every 6 months; custom quote. **CONFIRMED (bayansoft.com/subscriptions, 2026-10-20).** |
| Strengths | Offline-first sync suits Syria; cheap, published USD price; many verticals. |
| Weaknesses | Dated brand; unclear company size; exchange-rate handling not documented. |

#### Other Syrian and Syria-used programs

| Product | What is known | Confidence |
|---|---|---|
| Al-Idari (الإداري) | Named in Damascus job ads and accountant CVs next to Al-Ameen | REPORTED |
| Sahli Soft (سهلي سوفت) | Simple offline POS for small shops; reportedly on the tax list | REPORTED |
| Al-Rasheed Soft (الرشيد) | Iraqi origin, used in Syria; restaurant edition reportedly on the tax list | REPORTED |
| Al-Shamel, Al-Massa, Omega, Al-Khazen.net, Leaders Soft, Sham Soft, Phoenix, Al-Furqan, Idari Soft, Optima-soft, Xinfinity, "الميزان" | Names seen in search snippets of the tax authority's approved-programs pages (site unreachable on 2026-10-20) | UNVERIFIED |
| Afaq Soft, Hadara Soft, Rama, Nour, Union Soft, Rawabi, Alpha Soft, "المحاسب السوري", Bazar | SEO listicle entries; one-time prices $100–800 | UNVERIFIED |
| Transtek Compass ERP | Enterprise ERP, Damascus 2000 → Beirut; dominant in large Syrian firms around 2008 | REPORTED (dated) |
| Mozon Tech "MACC" | Vendor blog describing a Syria-focused product, no details | UNVERIFIED |

### 3.2 Regional cloud products

| Product | Vendor / market | Deployment | Starting price (seen 2026-10-20) | Notable | Syria |
|---|---|---|---|---|---|
| **Daftra (دفترة)** | Eyzam/IZAM, likely Egypt; KSA, Egypt, Jordan, UAE, Gulf; claims 45,000+ companies | Cloud, mobile, **offline desktop POS** | **$20/mo** annual ($30 monthly) Basic; $41.25 Advanced; $50 Comprehensive; each plan 1 user; branch $41–52/mo; user $7–9/mo | Widest module set: installments, POS, HR/payroll, manufacturing, serial/lot/expiry, fixed assets; ZATCA, ETA, JoFotara. FX: per-entry rate, **no rate table, no revaluation**. Branches, but no legal-entity consolidation. | **Syria in sign-up list; no sanctions clause.** SYP support UNVERIFIED. |
| **Qoyod (قيود)** | Saudi, founded 2016; KSA and Jordan; ~35,000 companies (claim) | Cloud, mobile | 138 SAR/mo incl. VAT Basic; 207 Pro; 379.5 Advanced | ZATCA Phase 2, JoFotara; on paper the best FX design (dated rate history, realised and period-end revaluation, IAS 21 claim); cost centres only on Advanced. **One subscription per legal entity**, consolidation is a separate product. | UNVERIFIED; built around Saudi/Jordan tax. |
| **Wafeq (وافِق)** | Dubai FZ-LLC, VC-funded ($3M seed, $7.5M Series A); GCC and Egypt | Cloud | 99–119 SAR/mo Starter; 119–149 Plus; 199–249 Premium (KSA); 69 AED UAE | Cleanest accountant core: report-level FX revaluation, **audit trail**, lock dates, multi-organisation login, modern OAuth REST API; ZATCA, UAE ASP. Weak operations: no POS, no installments. | **Export-control clause**; Gulf-only billing currencies. Hardest of the three for Syria. |
| **Rewaa (رواء)** | Saudi, 2018, $27M Series A; 23,000+ merchants | Cloud + POS apps | 247–708 SAR/mo, 1–2 year terms | Retail POS first; accounting is an add-on with cost centres and one-click close; no visible multi-currency or serials. | KSA only. |
| **Edara (إدارة)** | Edrak Software, Egypt; Egypt and KSA | Cloud | $29 + $5/user/mo Basic; multi-currency from $49 + $9/user | Serial numbers, RMA, FIFO/LIFO/average, API on top tier ($1 per 1,000 calls over 100k); ETA and ZATCA. | No evidence. |
| **SMACC (سماك)** | Saudi | Cloud, desktop, mobile | $143.75/mo (VAT incl.) | Multi-currency, multi-branch, fixed assets, payroll. | No evidence. |
| **Foodics** | Saudi restaurant POS; Foodics Accounting since 2023 | Cloud | ~AED 199/mo (third-party, UNVERIFIED) | POS ecosystem with Wafeq, Xero, Qaema, Microtec connectors. | Not available (UNVERIFIED). |
| Onyx Pro / Motakamel (Ultimate Solutions) | Egypt/KSA, 1993 | Desktop/ERP | Quote | 25 modules, four languages. "Al-Mutakamel" in Syrian lists may be this product. | UNVERIFIED |

### 3.3 International products

| Product | Price (seen 2026-10-20) | Strong points | Weak points for us | Syria |
|---|---|---|---|---|
| **Odoo** (Belgium) | One App Free €0; Standard €14.90; Custom €27.90 per user/month (EUR promo); renewals capped at +7%/yr | Broad suite; ZATCA, ETA, JoFotara modules in free Community code; lock dates and hard lock in Community; large MENA partner base (Egypt 209, KSA 198) | Real accounting (financial reports, assets, consolidation, automatic rates, payroll) is Enterprise-only; multi-company and API need the Custom plan online; Arabic quality uneven; costly implementations; Trustpilot 3.1 | Syria in trial dropdown; **no Syrian partner**; payment UNVERIFIED; self-hosted Community always possible; reportedly on Syrian tax list |
| **ERPNext / Frappe** (India, GPL) | Self-host free; Frappe Cloud from $5/mo per site, not per user | Free multi-company, accounting dimensions, dated rates with automatic feed, **exchange-rate revaluation posted as entries**, period closing, serial/batch, fixed assets | Thin MENA partner network (none in Syria/Lebanon); Arabic print/RTL bugs; upgrades break customisations; consolidation without eliminations | Syrian customer case study (Sankari Holding); Damascus implementer ClefinCode |
| **Zoho Books** (India) | Free (≤200k SAR revenue); Standard 60 SAR/AED annual … Ultimate 660 | Real Arabic UI; ZATCA Phase 2; UAE accredited ASP; dated rates with automatic feed; transaction locking; REST API on all plans | **Separate subscription per organisation, no cross-org view or consolidation**; serials and warehouses only on Elite; payroll, POS separate apps | "Usable, but not all of it" (Unblock Syria, 2026-09-15) |
| **QuickBooks Online** (US) | $38–340/mo list | Ecosystem; SYP in currency list | No Arabic; no ZATCA/UAE e-invoicing; multi-entity is a separate product | **Blocked** (Unblock Syria, 2026-09-15) |
| **Xero** (NZ) | $27–97/mo (US) | Clean UX, unlimited users, hourly FX, month-end revaluation | No Arabic, no ZATCA, no MENA edition; multi-currency only on top tier | Terms forbid sanctioned countries and allow blocking by payment country; status UNVERIFIED |
| **Dynamics 365 Business Central** (US) | $80 Essentials / $110 Premium per user/month | Dimensions, FX adjustment with preview, consolidation and intercompany included | **Arabic not a supported language**; e-invoicing via partners; expensive | **Not offered in Syria** (Microsoft availability list, 2026-09) |
| **Sage** (UK) | Partner quote in MENA | Intacct consolidation (UAE launch 2025-10); Gulf partner network | Arabic and ZATCA via partners; no SMB cloud product in MENA | UNVERIFIED |

### 3.4 Comparison on the features that matter for Vertex Mizan

Legend: ✓ documented · ~ partial or plan-limited · ✗ not found · ? unverified.

| Capability | Al-Ameen | Wakeed | Al-Bayan | Daftra | Qoyod | Wafeq | Zoho | Odoo | ERPNext |
|---|---|---|---|---|---|---|---|---|---|
| Arabic-first UI | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ~ | ~ |
| Cloud + offline | ~ | ✓ | ✓ | ~ (POS) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Dated rate table | ? | ✓ | ? | ✗ | ✓ | ~ | ✓ | ✓ | ✓ |
| FX revaluation | ? | ? | ~ | ✗ | ✓ (claim) | ~ (report) | ~ (manual) | ~ (Ent.) | ✓ |
| Syrian new-pound redenomination | ? | ? | ? | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Dimensions / cost centres | ~ | ✓ | ? | ✓ | ~ | ✓ | ~ | ✓ | ✓ |
| Multi-company under one login | ? | ✓ | ? | ~ (branches) | ✗ | ✓ | ✗ | ~ | ✓ |
| Consolidation | ? | ? | ? | ✗ | ✗ | ? | ✗ | ~ (Ent.) | ~ |
| Lock dates / period close | ? | ? | ? | ✓ | ? | ✓ | ✓ | ✓ | ✓ |
| Audit trail | ? | ? | ? | ? | ~ | ✓ | ~ | ~ | ~ |
| Public API | ✗ | ~ (MCP) | ✗ | ✓ | ~ | ✓ | ✓ | ~ | ✓ |
| Serial / IMEI | ? | ✗ | ? | ✓ (serial) | ? | ? | ~ | ✓ | ✓ |
| Installments | ? | ✓ | ? | ✓ | ✗ | ✗ | ✗ | ~ | ~ |
| Syrian tax / QR invoices | ✓ (list) | ✓ | ✓ (logo) | ✗ | ✗ | ✗ | ✗ | ✓ (list) | ✗ |
| Entry price | quote | quote | $20/mo | $20/mo | 120 SAR | 99 SAR | free | €0–14.90 | $5 / free |

Two observations from the table:

- **Nobody publicly guarantees ledger integrity.** None of the products documents database-enforced invariants (every entry balanced, posted entries immutable and reversed rather than edited, closed periods closed, append-only audit log). Most allow editing posted documents. This is an opportunity for a product that sells trust.
- **Nobody combines** a correct dual-currency model, the redenomination, Syrian tax readiness, real multi-company with consolidation, and an integration API built for other systems.

---

## 4. Legal and tax environment

Syria's government changed in December 2024. Pre-2024 laws remain in force unless replaced; each rule below states its date.

### 4.1 Bookkeeping

| Rule | Source | Status |
|---|---|---|
| Every taxpayer keeps regular, complete accounting records (Income Tax Law 24/2003, art. 6). | WIPO Lex text | CONFIRMED |
| Annual return includes trading account, P&L, balance sheet and depreciation schedule (art. 14 a/b). | same | CONFIRMED |
| **Electronic books are accepted**: computer-produced records are accepted for taxpayers who keep accounts electronically (art. 14 c). | same | CONFIRMED |
| **Retention: 10 years** for books and documents (art. 124). | same | CONFIRMED |
| Employers keep a chronological employee register with no blanks, insertions or deletions (art. 75). | same | CONFIRMED |
| Commercial Code (Law 33/2007) requires merchants to keep a journal and an inventory book, traditionally numbered and initialled. | syria.law | REPORTED (articles not read) |
| Books in Arabic and in Syrian pounds. | — | UNVERIFIED |

### 4.2 Income tax

- **In force:** Law 24/2003 as amended. Real-profit taxpayers (companies, banks, importers/exporters, wholesalers, assigned taxpayers) versus **lump-sum (الدخل المقطوع)** taxpayers (crafts and professions). Fiscal year is the calendar year; companies file by 30 June, other real-profit taxpayers by 30 April. **CONFIRMED (2003 text).**
- **Rates** were amended by Decree 51/2006; reported range 10–28% for business income and about 22% for companies, plus a local-administration surcharge. **REPORTED / UNVERIFIED.**
- **Reform:** draft income-tax and sales-tax laws (published September 2025) replace the schedular system and abolish lump-sum committees. On 2026-08-10 the Finance Minister said implementation is expected in **early 2027**. **REPORTED (draft).**
- **Tax amnesty:** Decree 275/2025 waived interest and penalties for 2024 and earlier if paid before 2026-03-31. **REPORTED.**

### 4.3 Indirect taxes and withholding

- **No VAT.** Draft sales tax: 5% general, up to 15% on luxuries. **REPORTED.**
- **Consumption spending fee (رسم الإنفاق الاستهلاكي):** Decree 11/2015, amended by Law 15/2024; added on the invoice; e.g. tourist restaurants 5%, 4–5 star hotels 10%. Expected to give way to the sales tax after 2026. **REPORTED.**
- **Stamp duty:** Decree 44/2005, proportional rates about 0.4–0.7%. **REPORTED.**
- **Salary tax:** progressive brackets under Decree 30/2023 (5%–15%, in old pounds). Decree 67/2026 set a minimum wage of 12,560 new pounds/month as the exempt minimum. Dividing the old brackets by 100 puts the top bracket below the new exemption, so the 2026 bracket table **must be confirmed** with the tax authority. **REPORTED, inconsistent.**
- **Non-resident withholding** (art. 61 b): 5% of contract value or 10% of service fees, royalties and rentals, plus salary-tax withholding; remit within 15 days; the Syrian payer is jointly liable. **CONFIRMED (2003 text).**

### 4.4 Approved accounting programs and electronic invoice linkage

- The General Commission for Taxes and Fees publishes **"approved accounting programs" (البرامج المحاسبية المعتمدة)** — about 50 programs in 2022. They issue invoices with a QR code and post them to the tax database when online (no permanent connection needed). **REPORTED (2022–2023 news and site snippets).**
- Decisions obliged groups of taxpayers to use the **electronic invoice linkage (الربط الإلكتروني)**: wholesalers, importers and exporters (QR on every invoice), tourist establishments of two stars and above, pharmaceutical warehouses (must use an approved program), auditors, delivery companies, radiology centres. Alternatives: pre-printed QR labels, PDF invoices in the approved format, or a free Android app from the authority. **REPORTED.**
- The authority's site (syriantax.gov.sy) failed with HTTP 500 and certificate errors on 2026-10-20, so the 2026 list, the approval procedure and the technical specification are **UNVERIFIED**. The draft reform names electronic invoicing as a core tool. Obtaining the specification and approval procedure is a prerequisite for phase 3 (sales).

### 4.5 Accounting standards and audit

- IFRS is required for listed companies, banks and entities supervised by the Syrian Commission on Financial Markets and Securities; **IFRS for SMEs is not adopted; no national standards.** Authority: the Association of Syrian Certified Accountants. **CONFIRMED (IFRS Foundation profile, last updated 2016).**
- Joint-stock companies and LLCs must appoint licensed auditors (Companies Law 29/2011, Law 33/2009 on the profession). **REPORTED / UNVERIFIED.**
- **Hyperinflation (IAS 29):** Syria has appeared on hyperinflation watch lists; whether it is on the 2026 list was not verified. Matters only for IFRS reporters. **UNVERIFIED.**

### 4.6 Payroll and social insurance

- Employer about 17% and employee 7% of wages to the General Establishment for Social Insurance (Decree 92/1959 as amended by Law 78/2001). Split and ceilings **UNVERIFIED**. Out of phase-1 scope, but relevant because Hub sends payroll events.

### 4.7 Electronic transactions and data

- Electronic Transactions Law 3/2014 and E-Signature Law 4/2009. **REPORTED.**
- No general personal-data-protection or data-localisation law found; no rule found that forbids storing accounting data outside Syria. Tax law only requires that computer records be produced on request. **UNVERIFIED (absence of evidence).**

---

## 5. Currency: the new Syrian pound and dual SYP/USD dealing

### 5.1 Redenomination (CONFIRMED: Decree 293/2025, Central Bank Decision 705/H)

| Item | Rule |
|---|---|
| Ratio | **100 old pounds = 1 new pound**; 1 pound = 100 qirsh (قرش). ISO code remains **SYP**. |
| Start | **2026-01-01.** Bank and e-wallet balances were converted that day. |
| Exchange window | Extended several times; Decision 372/H ended it on **2026-07-30**. Old notes are not legal tender from **2026-07-31**; redeemable only at the Central Bank in Damascus for 5 years. Extension to 2026-08-20 for Raqqa, Deir ez-Zor and Hasakah (REPORTED). |
| Documents | After the exchange starts, every document with a financial obligation is written **only in new pounds** and states **"الليرة السورية الجديدة"** explicitly. During the window, prices were shown in both. Documents signed before are settled at old-pound value unless agreed otherwise. Undated documents without a stated currency are rejected. |
| Restating books | **No published rule.** The natural treatment is to restate opening balances at 2026-01-01 by dividing by 100, with no gain or loss — an inference to confirm with a Syrian auditor. |

Implications for any ledger: history before 2026-01-01 is in old pounds under the same ISO code; amounts, rates and reports that cross the date need an explicit conversion; documents must carry the currency label.

### 5.2 Exchange rates

- Central Bank Decision 230 (2025-03-23) **unified the exchange-rate bulletins** into one official bulletin, published several times a week (6, 12, 14, 16, 19 October 2026). On **2026-10-19 the official rate was 122.00 SYP/USD**. **CONFIRMED (cb.gov.sy).**
- Bulletin 193 (2026-10-15): buy 121.50 / sell 122.50; parallel market about 137.5 / 138.5. **REPORTED.**
- Licensed exchange institutions must use the Central Bank bulletin (Decision 705, art. 12). **CONFIRMED.**

### 5.3 Dealing in dollars

- Decrees **5 and 6 of 2024** (Assad era) still ban pricing and payment in foreign currency without government approval; they are still published on the Central Bank site and no repeal was found. **CONFIRMED (published) / REPORTED (no repeal).**
- In practice: prosecutions halted (March 2025), banks may pay remittances and sell FX, withdrawals from new deposits are allowed in any currency (Circular 1831, May 2025), and public salaries moved back from USD to SYP in 2026. Dollar pricing is widespread. **REPORTED.**
- **Practical model observed in the market:** SYP (new) as the legal book currency, USD as a shadow currency for pricing, contracts and management reporting, with both an official and a market rate in use.

---

## 6. Payments, sanctions and SaaS access

- **US:** sanctions regulations revoked (EO 14312, effective 2025-07-01; regulations removed 2025-08); export-control licence exception for most commercial software (2025-09); **Caesar Act repealed 2025-12-18**; state-sponsor-of-terrorism designation rescinded (notified 2026-07, published 2026-08). Syria remains in EAR Country Group E:1. **REPORTED.**
- **EU:** economic sanctions lifted 2025-05-20; Cooperation Agreement restored 2026-05-11. **REPORTED.**
- **Vendors still block by choice:** 474 of 986 tracked services were fully blocked as of 2026-08-22 (Unblock Syria). **PayPal and Stripe remain unavailable in Syria** (2026-09). QuickBooks and Microsoft online services are blocked. **REPORTED.**
- **Local payment rails:** Central Bank Decision 259 (2026-05-04) lets banks and e-payment companies work with global networks; a national electronic payment and transfer system was adopted in August–September 2026 (Decisions 1124 and 616). Wallets in use include Sham Cash, Syriatel Cash and MTN Cash; transfer offices remain common. **CONFIRMED (decision titles) / REPORTED (wallets).**
- **Implication:** a Syrian SaaS cannot rely on card processors for subscription billing; plan for bank transfer, local wallets and cash through agents. Hosting abroad is lawful but must be explained to customers who distrust the cloud.

---

## 7. Name and domain

### 7.1 Conflicts

| Name | Field | Market | Risk |
|---|---|---|---|
| **Mezan (ميزان)**, Mezan Technologies, mezan.sa | Cloud accounting, ERP, POS, ZATCA | Saudi Arabia, since 2021 | **High** in KSA/GCC: same Arabic word, same category |
| **"المِيزان"** app (DOZO APPS) | Accounting for money-transfer offices, 50K+ Android downloads | Saudi developer | Medium–high |
| **"الميزان"** on the Syrian tax authority's approved-programs list | Accounting program | Syria | **Unknown, potentially high in Syria.** Seen only in a search snippet; could not open the list. Must be checked. |
| Mizan Accounting (services), Mizan Odoo partner (Jubail), mizan-ct (Libya), Al Mezan For Accounting (Istanbul), Mizan integrated financial system (Iran) | Accounting services/ERP | Various | Medium locally |
| Turkish marks ("mizan" = trial balance in Turkish): mizanla, mizan vergi denetim, mizan yazılım | Classes 35/42 | Türkiye | Medium in Türkiye |
| Meezan Bank, Al Meezan Investments | Banking, funds | Pakistan | Low (other field) |
| MIZAN (Zhejiang MiZhan) | Worldwide class 9 filings | Many incl. Morocco | Low–medium |
| **Vertex, Inc.** (NASDAQ: VERX) | Tax-compliance software integrating with ERPs; VERTEX marks in classes 9/42 (international registrations 1921935, 1924562, 1944054) | US/global | Medium outside Syria; Syrian designation UNVERIFIED |

Conclusions (not legal advice):

- "Mizan" alone is descriptive for accounting (trial balance) and crowded; it will likely be refused or disclaimed as a stand-alone mark.
- **"Vertex Mizan / فيرتكس ميزان" as one unit is reasonably distinctive.** Overall risk **medium**: low–medium in Syria (subject to the "الميزان" check), medium–high in KSA/GCC, medium internationally because of Vertex, Inc.
- Recommendations: always use the full name (logo, store titles, domains, handles); file "VERTEX MIZAN" and "فيرتكس ميزان" in Syria in classes 9, 42 and 35 through a local IP agent; protect the "VERTEX" house mark in Syria; commission a SAIP/UAE search before any GCC launch; keep a fallback name ready.

### 7.2 Domains (Hostinger availability API, 2026-10-20)

| Domain | Available |
|---|---|
| mizan.com, .app, .io, .net, .co, .ai | No |
| mizanapp.com, mizanapp.io, getmizan.com, getmizan.app, mizanerp.com | No |
| **vertexmizan.com, .app, .io, .net, .co** | **Yes** |
| mizanapp.app, mizanerp.app | Yes |

Sister products use subdomains of vertexmedia.pro (hub., digital.), so `mizan.vertexmedia.pro` is also available as an interim address. A product sold to other companies is better served by its own domain (vertexmizan.com).

---

## 8. Gaps and differentiation opportunities

Ranked by how directly they follow from the evidence above. These are opportunities, not decisions; each needs a product decision in ADR 0001 or a phase scope.

1. **A ledger you can trust, guaranteed by the database.** Balanced entries, posted entries immutable and corrected only by reversal, closed periods enforced, append-only audit log, 10-year retention. No competitor documents this. It answers the market's distrust of cloud accounting and matches the tax law's acceptance of electronic books.
2. **Correct dual currency for Syria.** Book currency SYP (new), shadow/reporting currency USD; every amount stored with its currency and the rate actually used; dated rate table holding both the Central Bank bulletin rate and a market rate; revaluation; reports in either currency. Competitors have per-entry rates without history (Daftra), manual rates (Qoyod), or no Syria-specific source (everyone except Wakeed).
3. **Native redenomination support.** Old-pound history, the 2026-01-01 conversion, the "الليرة السورية الجديدة" label on documents, and comparisons across the date. No competitor documents it.
4. **Real multi-company under one login, with consolidation.** Zoho, Qoyod and QuickBooks charge per organisation with no cross-company view; Daftra has branches only. This serves groups (Vertex itself) and **accounting offices that keep books for many clients** — the people who choose the software in Syria.
5. **Integration-first API.** A versioned API with idempotency keys and period-lock enforcement, built so operational systems (Hub, Food, Shifa, third parties) post to the ledger. Local products have no public API; regional ones have APIs for apps, not ledger-grade posting contracts.
6. **Profitability by dimension for service businesses.** Client, project, department and service dimensions on every line, with pass-through purchases kept outside project margin. Syrian products focus on retail and warehouses; agencies and service firms are under-served.
7. **Tax rules as dated, versioned configuration.** Lump-sum vs real-profit taxpayers today, sales tax and abolition of lump-sum assessment expected in 2027, spending fee, salary tax. Being ready on day one of the 2027 reform is a sales moment.
8. **Tax-authority approval and QR invoice linkage** (phase 3, when Mizan issues invoices). Likely a requirement for retail and distribution buyers; Wakeed, Al-Ameen and Al-Bayan already claim it.
9. **Phone shops: IMEI tracking + installments + SYP/USD** (phase 3). No Syrian vertical product found.
10. **Works in Syrian conditions.** Light pages for slow links, tolerance for interrupted connections, full data export and backups customers can hold, and a clear answer on where data lives. Al-Bayan and Wakeed set the bar with offline sync; Vertex Mizan must at least not lose work on a dropped connection. Full offline mode is a decision for later phases.
11. **Local billing.** Bank transfer, Sham Cash/Syriatel Cash, agents; prices in USD with SYP payment; benchmark $20–50 per month per company (Al-Bayan, Daftra).
12. **Migration from incumbents.** Import of charts of accounts, opening balances and history from Al-Ameen and Excel lowers the switching cost from the market leader.

### Threats

- **Wakeed** is already modern, Syria-aware, multi-company and AI-forward; if it builds a brand, it occupies the same position.
- **Al-Ameen's** installed base and the accountants trained on it.
- **Daftra** is open to Syria, cheap and broad.
- **Self-hosted Odoo/ERPNext** through local implementers for larger firms.
- **Name:** "الميزان" on the Syrian approved list (if confirmed) and Mezan in KSA.

---

## 9. Open items to verify

| # | Item | How |
|---|---|---|
| 1 | The tax authority's approved-programs list: is "الميزان" on it, who owns it, and the approval procedure and technical specification for QR/linkage | syriantax.gov.sy when reachable, or a visit/call to the General Commission for Taxes and Fees |
| 2 | Accounting treatment of the redenomination in company books (opening-balance restatement, comparatives) | Syrian certified auditor; Association of Syrian Certified Accountants guidance |
| 3 | Current company income-tax rates and the 2026 salary-tax bracket table in new pounds | Tax authority / tax adviser |
| 4 | Status of Decrees 5 and 6 of 2024 on foreign-currency dealing | Lawyer |
| 5 | Commercial Code articles on books (certification, language) | Law text |
| 6 | Social-insurance split and ceilings | General Establishment for Social Insurance |
| 7 | Whether Syria is on the 2026 IAS 29 hyperinflation list | CAQ IPTF / Big-4 publications |
| 8 | Any personal-data or data-localisation law | Lawyer |
| 9 | Trademark searches: Syrian DCIP, WIPO Madrid Monitor for Vertex, Inc. designations, SAIP and UAE before GCC | IP agent |
| 10 | Wakeed and Al-Bayan pricing, user base and real Syrian adoption | Demo requests, accountant interviews |
| 11 | How Syrian accountants and businesses actually want to pay and which features make them switch | Interviews with 5–10 accountants and accounting offices |
| 12 | Whether books kept in USD (functional currency) with an SYP view are accepted, and which SYP translation the tax return needs (added 2026-10-20, Vertex Media chose USD books) | Syrian certified auditor / tax adviser |

---

## Sources

All accessed 2026-10-20 unless noted.

**Syrian official**
- Central Bank of Syria (rates, bulletins): https://cb.gov.sy/
- Central Bank decisions list (705/H, 222, 215, 372/H, 259, 1124, 616, 230): https://cb.gov.sy/index.php?page=list&ex=2&dir=laws&lang=1&lt=3&service=5&act=576
- Central Bank circulars (1831/2025): https://cb.gov.sy/index.php?page=list&ex=2&dir=laws&lang=1&lt=4&service=5&act=575
- Central Bank publication of Decree 5/2024: https://cb.gov.sy/index.php?cat_id=1908&dir=items&ex=2&lang=1&page=show&ser=3
- SANA, Decree 293/2025: https://sana.sy/presidency/2364708/ and https://sana.sy/en/presidency/2286703/
- SANA, salary-tax exemption 2025: https://sana.sy/economy/2257453/
- SANA archive, tourist-establishment invoice linkage: https://archive.sana.sy/%D9%87%D9%8A%D8%A6%D8%A9-%D8%A7%D9%84%D8%B6%D8%B1%D8%A7%D8%A6%D8%A8-%D9%88%D8%A7%D9%84%D8%B1%D8%B3%D9%88%D9%85-%D8%AA%D8%B0%D9%83%D8%B1-%D8%A8%D9%85%D9%87%D9%84%D8%A9-%D8%A7%D9%84%D8%B1%D8%A8%D8%B7
- Tax authority (unreachable on 2026-10-20; snippets only): https://www.syriantax.gov.sy/?page=category&category_id=159 , https://syriantax.gov.sy/?category_id=72&id=669&lang=ar&page=show_det , https://www.syriantax.gov.sy/?page=show_det&category_id=72&id=668&lang=ar
- Income Tax Law 24/2003: https://www.wipo.int/wipolex/en/text/581066
- WIPO Lex Syria profile: https://www.wipo.int/wipolex/en/members/profile/SY
- IFRS Foundation, Syria: https://www.ifrs.org/use-around-the-world/use-of-ifrs-standards-by-jurisdiction/view-jurisdiction/syria/

**Syrian news and legal summaries**
- syria.law legislation: https://www.syria.law/index.php/legislation/
- Enab Baladi: https://english.enabbaladi.net/archives/2026/07/syrian-central-bank-ends-debate-old-pound-invalid-after-july/ ; https://english.enabbaladi.net/archives/2026/04/government-ends-dollar-salary-payments-in-syria/ ; https://www.enabbaladi.net/769219/ ; https://www.enabbaladi.net/595572/ ; https://www.enabbaladi.net/356489/
- Al Arabiya (2026-07-27): https://www.alarabiya.net/aswaq/economy/2026/07/27/
- Al Jazeera: https://www.aljazeera.net/news/2026/8/5/ ; https://www.aljazeera.net/ebusiness/2025/11/26/syrian-pound-stable ; https://www.aljazeera.net/ebusiness/2025/12/1/decline-exchange-syrian-pound
- banker.news (bulletin 193): https://www.banker.news/156347
- Syrian Days (spending fee, 2026-07-01): https://syriandays.com/index.php?id=80044&page=show_det
- Verify-Sy (2026-10-11): https://www.verify-sy.com/ar/factcheck/syria-new-tax-law-izaz
- Karam Shaar, tax reform: https://karamshaar.com/syria-in-figures/syria-tax-reform-2025/
- Majalla: https://en.majalla.com/node/327501/business-economy/syria%E2%80%99s-new-draft-tax-law-capital-over-social-equity
- Noon Post: https://www.noonpost.com/348652/
- Al-Mashhad Online, invoice linkage: http://almashhadonline.com/article/6308c4c1c65c5 ; http://almashhadonline.net/article/6393233c085dc
- Syrians for Truth and Justice, Decrees 5 and 6/2024: https://stj-sy.org/en/syria-two-new-decrees-to-regulate-use-of-foreign-currencies-and-money-exchange-the-accused-is-guilty-until-proven-innocent/
- Damascus University study on cloud accounting: https://journal.damascusuniversity.edu.sy/index.php/ecoj/article/view/14018/3267
- Wikipedia (Syrian pound, sanctions, Caesar Act, internet, energy, Transtek): https://en.wikipedia.org/wiki/Syrian_pound ; https://en.wikipedia.org/wiki/International_sanctions_against_Syria ; https://en.wikipedia.org/wiki/Caesar_Syria_Civilian_Protection_Act ; https://en.wikipedia.org/wiki/Internet_in_Syria ; https://en.wikipedia.org/wiki/Energy_in_Syria ; https://en.wikipedia.org/wiki/Transtek

**Sanctions and SaaS access**
- US Treasury GL 25: https://home.treasury.gov/news/press-releases/sb0148
- White House EO: https://www.whitehouse.gov/presidential-actions/2025/06/providing-for-the-revocation-of-syria-sanctions/
- Unblock Syria: https://unblocksyria.com/en/articles/syria-sst-removal-what-it-changes ; https://unblocksyria.com/en/services/zoho ; https://unblocksyria.com/en/services/quickbooks ; https://unblocksyria.com/en/services/paypal ; https://unblocksyria.com/en/services/stripe ; https://unblocksyria.com/en/services/microsoft-azure
- EFF (2025-06): https://www.eff.org/deeplinks/2025/06/new-digital-dawn-syrian-tech-users
- Nixon Peabody (2025-07): https://www.nixonpeabody.com/-/media/files/alerts/2025/07/us_export_controls_and_sanctions_regulations_regarding_syria.pdf
- Microsoft Q&A on Syria: https://learn.microsoft.com/en-us/answers/questions/2337483/hello-is-there-any-chances-of-microsoft-being-avai

**Syrian and Syria-used products**
- Al-Ameen: https://alameensoft.com/ ; https://alameensoft.com/sa/ ; https://finalscout.com/company/alameensoft ; https://apps.apple.com/us/app/-/id1669222018
- Wakeed: https://wakeed.app/ ; https://pos.wakeed.app ; https://rikaz.tech
- Al-Bayan: https://bayansoft.com ; https://bayansoft.com/subscriptions ; https://www.facebook.com/bayanacc/ ; https://coresignal.com/discover/accounting/syria/
- Listicles (low reliability): https://invest.albanknote.com/accounting-software-syria ; https://projectsegy.com/accounting-software-syria/
- Reddit r/Syria (snippet): https://www.reddit.com/r/Syria/comments/1cpm2ts/pos_systems_in_syria/
- Mostaql projects: https://mostaql.com/project/507732 ; https://mostaql.com/project/1257162
- Mozon Tech: https://mozon-tech.com/?p=20877 ; https://mozon-tech.com/?p=18318
- DEXEF installments: https://dexef.com/apps/installment-accounts-software

**Regional products**
- Daftra: https://www.daftra.com/plans ; https://www.daftra.com/features/ ; https://www.daftra.com/register ; https://www.daftra.com/terms-conditions-ar ; https://docs.daftra.com/en/?p=31696 ; https://docs.daftra.com/en/?p=5088 ; https://docs.daftra.com/en/tutorial/branches-management/ ; https://docs.daftra.com/en/?p=4506 ; https://www.daftra.com/en/hub/accounting-software-prices
- Qoyod: https://www.qoyod.com/en/knowledge-base/qoyod-plans-and-pricing-subscription-tiers-features-add-ons/ ; https://www.qoyod.com/en/knowledge-base/available-and-unavailable-features-in-the-basic-pro-and-adva/ ; https://www.qoyod.com/accounting-software/core-accounting-for-accountants/multi-currency-handling/ ; https://www.qoyod.com/en/terms-and-conditions/
- Wafeq: https://www.wafeq.com/en-sa/pricing ; https://www.wafeq.com/en-ae/pricing ; https://www.wafeq.com/en/terms-of-service ; https://www.wafeq.com/en/developers ; https://www.wafeq.com/en/wafeq-help/manual-journals/revaluation-of-foreign-currency-accounts-understanding-exchange-rate-gain-or-loss ; https://www.wafeq.com/en/wafeq-help/locking-transactions/how-to-prevent-changes-to-your-books
- Rewaa: https://rewaa.com/pricing ; https://rewaa.com/solutions/accounting/
- Edara: https://getedara.com/pricing.ar.html
- SMACC: https://smacc.com/sa/ar/pricing
- Foodics: https://help.foodics.com/hc/en-us/articles/9526937173020-Foodics-Plans-Pricing-and-How-to-Subscribe

**International products**
- Odoo: https://www.odoo.com/pricing ; https://www.odoo.com/documentation/19.0/legal/terms/enterprise.html ; https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started/multi_currency.html ; https://www.odoo.com/partners/country/syria-203 ; https://github.com/odoo/odoo/tree/19.0/addons ; https://www.trustpilot.com/review/odoo.com
- ERPNext / Frappe: https://frappe.io/erpnext/pricing ; https://frappe.io/cloud/pricing ; https://docs.frappe.io/erpnext/user/manual/en/exchange-rate-revaluation ; https://frappe.io/partners/regions ; https://frappe.io/stories/Sankari%20Holding
- Zoho Books: https://www.zoho.com/sa/books/pricing/ ; https://www.zoho.com/sa/books/pricing/pricing-comparison.html ; https://www.zoho.com/us/books/kb/general/view-org-info-in-one-place.html ; https://www.zoho.com/us/books/help/settings/currencies.html
- QuickBooks: https://quickbooks.intuit.com/pricing/
- Xero: https://www.xero.com/us/pricing-plans/ ; https://www.xero.com/legal/terms/
- Business Central: https://www.microsoft.com/en-us/dynamics-365/products/business-central/pricing ; https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/compliance/apptest-countries-and-translations
- Sage: https://www.zawya.com/en/economy/global/sage-intacct-launches-best-in-class-cloud-finance-software-for-mid-sized-businesses-in-the-uae-llgw7pwg

**Name and trademarks**
- Mezan (KSA): https://mezan.sa
- المِيزان app: https://play.google.com/store/apps/details?id=com.dozoapps.flutter.gold.accounting.app
- TMview searches: https://www.tmdn.org/tmview/
- Vertex, Inc. international registration: https://www.tmdn.org/tmview/#/tmview/detail/WO500000001944054
- Syria in the Madrid system: https://wipo.int/edocs/madrdocs/en/2020/madrid_2020_44.pdf
