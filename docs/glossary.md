# Glossary

One name per concept. Code, contracts and tables use the English term; the Arabic term is what users see. Add a row when a spec introduces a new concept.

| Arabic (UI) | English (code) | Meaning |
|---|---|---|
| الشركة | company | A legal entity with its own books; the tenant (`company_id`) |
| العضوية | membership | A person's role in one company |
| الدعوة | invitation | An emailed, single-use link that adds a person to a company with a role |
| الدور | role | What a membership may do: owner, accountant, approver, viewer, auditor |
| الصلاحية | permission | One action key in the permission map (`members.manage`); roles hold permissions |
| المالك / المحاسب / المعتمِد / القارئ / المدقق | owner / accountant / approver / viewer / auditor | The five roles of phase 1 (phase 1 scope §3) |
| صلاحية الفترات | period permission | The owner's grant to one accountant to close and reopen periods (`canClosePeriods`) |
| المصادقة الثنائية / رمز احتياطي | two-factor authentication / backup code | The authenticator-app code required at sign-in for every role / a single-use code for a lost authenticator |
| الجلسة / الشركة النشطة | session / active company | A signed-in browser / the company every request of that session runs in |
| سجل التدقيق | audit log | Append-only record of who did what, when and from where, with before and after values |
| إعدادات الدفاتر | ledger settings | Book and parallel currency, each ledger's rate policy and the fiscal year start; locked at the first posted entry |
| مذكرة السياسة | policy note | The company's written IAS 21.9–12 basis for its book currency |
| أرشفة | archive | Making a company or membership read-only or inactive without deleting it |
| دليل الحسابات | chart of accounts | The company's tree of accounts |
| حساب رئيسي | header account | A grouping account; never posted to |
| حساب فرعي / حساب ترحيل | postable account | An account lines are posted to |
| طبيعة الحساب | normal balance | Debit or credit |
| فئة الحساب | account class | Asset, liability, equity, revenue, expense |
| بند القائمة | statement line | Where an account appears in the income statement or balance sheet |
| رمز الحساب | account code | The account's number: 1, 2, 3 or 6 digits by level, each starting with its parent's code (ADR 0011) |
| حساب موقوف | blocked account | An account that refuses new postings and stays in reports |
| دور الحساب | account role | The company's account for a system purpose: conversion rounding, exchange gains and losses, retained earnings |
| قالب دليل الحسابات | chart template | A versioned starting chart of accounts (service agency, general) applied at company creation or to an empty chart |
| فئة IFRS 18 | IFRS 18 category | The income-statement category of a statement line: operating, investing, financing, income taxes |
| مخصص الخسائر الائتمانية المتوقعة | allowance for expected credit losses | A credit-balance account against receivables and contract assets for the losses expected on them (IFRS 9.5.5.15) |
| خسائر انخفاض القيمة | impairment losses | The expense of that allowance, a separate income-statement line (IAS 1.82(ba)) |
| مبالغ مستردة مستحقة للعملاء | refund liability | What the company expects to pay back to a client, such as a cancelled project's refund (IFRS 15.55) |
| الأصول غير الملموسة / الإطفاء | intangible assets / amortisation | Software and websites the company owns, and their cost spread over their useful life |
| القروض | borrowings | Loans and bank overdrafts the company owes |
| جاري الشركاء | partners' current accounts | Partners' withdrawable balances in a company with legal personality: a monetary liability, not equity (IAS 32.11, 32.16) |
| الاحتياطي القانوني | legal reserve | Profit set aside in equity as company law requires |
| حساب مراقبة | control account | An account whose balance is the sum of its open items (receivables, payables, workers' balances) |
| بند مفتوح | open item | One document's outstanding balance in a control account (an invoice, a counterparty's running balance) |
| المبلغ الدفتري | carrying amount | An item's amount in a ledger: what it was measured at, less what was cleared before; month-end revaluations reverse and are not part of it (ADR 0007) |
| قياس جديد | new measurement | A line converted at its ledger's policy rate on the entry date: revenue, a new receivable, cash received, an expense |
| مبلغ محمول | carried amount | A line that releases, clears, settles or reverses a balance at that balance's own amounts; never converted again |
| رصيد جارٍ | running balance | An item kept per counterparty, cleared at its average carrying amount; it may cross zero (ADR 0013) |
| نوع البند / بند مستند | item kind / document item | A control account's kind of open item: one per document (an invoice), opened once and cleared toward zero; or a running balance per counterparty (ADR 0013) |
| حركة البند | item movement | The one movement of an item each line on a control account makes, with that line's three amounts: an opening, an addition, a clearing or a void's exchange difference |
| تسوية / تسوية جزئية | settlement / partial settlement | A movement that clears an open item at its carrying amount, in proportion to what remains open; the last clears everything left (ADR 0013) |
| أعمار الذمم | receivables ageing | Open receivable items by days past their due date, in six buckets: not yet due, 1–30, 31–60, 61–90, 91–180, over 180 |
| تاريخ الاستحقاق / أيام التأخير | due date / days past due | When an item is due (its document date when none is set) / the report date minus the due date in force on it |
| كشف حساب عميل | client statement | A client's items and movements on the control accounts, with opening, running and closing balances |
| شطب دين | write-off | Clearing an uncollectible item at its carrying amount to an expense measured on the write-off date (IFRS 9.5.4.4) |
| معدّل في ميزان | adjusted in Mizan | A manual movement on an item from the opening balances, shown on the item |
| حساب نقدي / غير نقدي | monetary / non-monetary account | Whether foreign-currency balances are revalued (IAS 21) |
| بُعد تحليلي | dimension | An analysis tag on a line; the built-in types are client, contract (a project or a retainer), department and service (ADR 0011) |
| نوع البعد | dimension type | A kind of dimension: the built-in client, contract, department and service, or a custom one |
| قيمة البعد | dimension value | One client, contract, department or service |
| العقد | contract | A project or a retainer, as one dimension with its kind and client; contract positions are netted per contract (IFRS 15.105) |
| مشروع / عقد دوري | project / retainer | The two kinds of a contract value (`contract_kind`): work delivered once, or a service billed in cycles |
| قيد يومية | journal entry | A dated set of balanced lines |
| سطر القيد | journal line | One account, its dimensions and its amounts |
| مدين / دائن | debit / credit | Positive / negative line amount |
| ترحيل | posting | Writing an entry to the ledger; the only way is the posting function |
| مسودة | draft | An entry being prepared; not in the ledger |
| قيد عكسي / عكس | reversal / reverse | A new entry that negates a posted one exactly |
| قيد إعادة تصنيف | reclassification | Moves an amount between accounts or dimensions |
| رقم القيد | entry number | Gapless per company and fiscal year, given at posting |
| تاريخ القيد / تاريخ الترحيل | accounting date / posting time | The date an entry belongs to / when it was posted (`entry_date`, `posted_at`) |
| سلسلة السلامة | integrity chain | Each posted entry's hash includes the previous entry's hash |
| الدفتر / دفتر الأستاذ | ledger / general ledger | All posted entries; per-account view |
| دفتر اليومية | journal book | Posted entries printed by accounting date then number, in Arabic, with numbered pages |
| ميزان المراجعة | trial balance | Balances of all accounts; debits equal credits |
| كشف حساب | account statement | One account's lines and running balance |
| قائمة الدخل | income statement | Revenue and expenses for a period |
| الميزانية العمومية / قائمة المركز المالي | balance sheet | Assets, liabilities and equity at a date |
| فترة المقارنة | comparative period | The second column of a report: by default the previous period of the same length, or for the balance sheet the end of the previous fiscal year (S09 rule 5) |
| ربح (خسارة) السنة الحالية | year's result | Computed in the balance sheet's equity: revenue less expenses from the fiscal year's start to the date, until the year-end close (ADR 0018) |
| أعيد تبويب للعرض | reclassified for presentation | An amount a statement shows on another line than its account's, such as a counterparty's debit on a payables account shown in receivables; the account is unchanged (IAS 1.32) |
| هامش المساهمة | contribution margin | Revenue less direct costs of a client, contract, department or service, with no overhead allocated |
| غير موزع | unassigned | The part of a profitability total whose lines carry no value of the chosen dimension |
| قسم الخدمة | service department | The department a service belongs to, dated, set on the service (S09 rule 32) |
| ما قبله | brought forward | The journal book's totals of the year's earlier pages, at the foot of each page |
| الطبعة الرسمية / سجل الطبعات | official print / print register | A journal book printed for closed months, registered with its pages and hashes; superseded when one of its months is reopened |
| السنة المالية | fiscal year | The calendar year by default |
| الفترة | period | A month of the fiscal year: open, closed or reopened (ADR 0016) |
| إقفال الفترة / إعادة فتحها | close / reopen a period | Stop / allow postings dated inside it |
| قائمة التحقق قبل الإقفال | pre-close checklist | Conditions a period must meet before it closes |
| فترة معاد فتحها | reopened period | A closed month opened again with a reason; it takes postings as an open one |
| سعر الإقفال | closing rate | A ledger's policy rate in force on a month's last day, used by the revaluation (IAS 21.23) |
| إعادة تقييم حالية / قديمة | current / stale revaluation | Whether recomputing a month's revaluation gives no difference (ADR 0016) |
| قيد تسوية لإعادة التقييم | adjusting revaluation | The differences a stale revaluation still needs, posted on the same month end with its own reversal |
| عملة الدفاتر | book currency | The currency of the statutory books (SYP by default and for Vertex Media) |
| العملة الموازية | parallel currency | The currency of the optional full parallel ledger (USD for Vertex Media) |
| الدفتر الموازي | parallel ledger | A complete ledger in the parallel currency, with its own exchange differences and revaluation |
| مبلغ الدفاتر / المبلغ الموازي | book amount / parallel amount | A line's amount in the book ledger / in the parallel ledger |
| سياسة الأسعار | rate policy | Which rate type each ledger uses (bulletin for the statutory books, market for the parallel ledger) |
| سطر فرق صرف | exchange-difference line | A line carrying an amount in one ledger only, for a realised or unrealised difference |
| عملة العرض | presentation currency | A currency statements are translated into for presentation (IAS 21.39); never a stored ledger |
| مبلغ المعاملة | transaction amount | A line's amount in its own currency |
| سعر الصرف | exchange rate | Quote-currency units per 1 base-currency unit, stored as quoted |
| سعر السوق / سعر النشرة | market rate / bulletin rate | The rate the company deals at / the Central Bank of Syria bulletin rate |
| زوج العملات | rate pair | Two currencies with the orientation every rate between them uses (base and quote) |
| تقويم النشرة / يوم عدم نشر | publication calendar / day off | The weekly days and holidays without a bulletin; a working day needs its own bulletin (ADR 0011) |
| تصحيح السعر | rate correction | A newer rate row with a reason that supersedes one of the same date; posted entries never change |
| يقبل سعر العملية | accepts the transaction's rate | A market-rate ledger that takes the rate an entry was dealt at instead of the day's rate (`acceptsTransactionRate`, ADR 0007) |
| الليرة السورية الجديدة | new Syrian pound | `SYP` since 2026-01-01 (100 old = 1 new) |
| فرق صرف محقق | realised exchange difference | Gain or loss when a foreign-currency item is settled (IAS 21.28) |
| فرق صرف غير محقق / إعادة التقييم | unrealised exchange difference / revaluation | Month-end remeasurement of monetary foreign-currency balances (IAS 21.23) |
| سطر التقريب | rounding line | A line to the conversion-rounding account that balances conversion rounding |
| التوزيع | allocation | Splitting an amount into parts that sum exactly (cumulative rounding) |
| إيراد مؤجل / التزامات عقود | deferred revenue / contract liabilities | Amounts invoiced before the goods or services are delivered (IFRS 15.106) |
| أصل عقد | contract asset | Revenue earned for work done and not yet invoiced (IFRS 15.107) |
| قاعدة الترحيل | posting rule | How a kind of operation becomes entry lines, implemented only after its scenario is approved (`/posting-rule`) |
| الأرصدة الافتتاحية | opening balances | Balances on the first day of the books |
| تاريخ بدء الدفاتر | books start | The first day of a company's books in Mizan, the first day of a month; earlier months are closed (S10) |
| قيد الأرصدة الافتتاحية | opening entry | The one entry, source `opening`, dated on the books start, that posts the opening balances (S10) |
| الرقم الموازن | balancing figure | The retained-earnings line that balances the opening entry in each ledger (S10) |
| مبلغ منقول | stated amount | A book or parallel amount taken from the old records, with no conversion; only on the opening entry (`stated` line, ADR 0019) |
| نتيجة السنة قبل بدء الدفاتر | result of the year before the books start | The fiscal year's profit or loss before the books start, one figure on `312002`, added to the year's result (S10) |
| كتاب السيناريوهات | scenario book | Solved examples of every accounting rule, run as tests |
| شكل العملات | currency shape | A scenario's book and parallel currencies (`syp`, `syp-usd`, `usd-syp`, `third`) |
| أرصدة الفترات | period balances | Totals per period, account, dimensions and currency, kept by the posting function |
| بيان القيد / المرجع | entry description / reference | The required Arabic statement of an entry, printed in the journal book / an optional document number |
| سعر الصفقة | dealt rate | The rate a manual entry was actually dealt at; used only by a market ledger that accepts a transaction's rate (ADR 0012) |
| إرسال للاعتماد / اعتماد / رفض / سحب | submit / approve / reject / withdraw | The approval steps of a manual entry when the company switches approval on; the approver is never the preparer |
| معاينة الترحيل | posting preview | The lines as they would post, in both ledgers, with rounding and difference lines, before posting |
| طلب الترحيل | posting request | The idempotency record every posting starts with: its client and key (a draft id), so a resend posts nothing new |
| مجموعة الأبعاد | dimension set | One combination of dimension values that lines and period balances share |
| رأس السلسلة | chain head | The company's last posted entry hash and entry count |
| فحص السلامة | integrity check | Recomputing the chain, numbers, balances and period balances, and comparing them with the anchors |
| تصدير بيانات الشركة | company export | The owner's full ZIP copy of a company's data, attachments and chain head |
| مرساة السلسلة | chain anchor | The daily chain head emailed to the owner, outside the server |
| بصمة القيد | entry hash | The SHA-256 of an entry with the previous entry's hash; shown by its first 12 characters, copied whole |
| شرح السطر | line memo | An optional note on one line of an entry, beside the entry's description |
| مجاميع القيد | entry totals | Debits, credits and the difference of each transaction currency while an entry is typed |
| سند | voucher | A receipt or payment document that produces an entry (phase 2) |
| شيك / شيك مؤجل | cheque / post-dated cheque | A cheque, or one dated in the future (phase 2 or later) |
| أوراق قبض / أوراق دفع | notes receivable / notes payable | Cheques and bills held or issued until due (phase 2 or later) |
| مركز كلفة | cost centre | A dimension used to analyse costs |
| الفرع | branch | A location of a company (later) |
