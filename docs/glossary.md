# Glossary

One name per concept. Code, contracts and tables use the English term; the Arabic term is what users see. Add a row when a spec introduces a new concept.

| Arabic (UI) | English (code) | Meaning |
|---|---|---|
| الشركة | company | A legal entity with its own books; the tenant (`company_id`) |
| العضوية | membership | A person's role in one company |
| عميل الربط | API client | A machine identity of a connected system in one company, with scoped keys |
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
| حساب مراقبة | control account | An account whose balance is the sum of its open items (receivables, client ad funds) |
| بند مفتوح | open item | One document's outstanding balance in a control account (an invoice, a client's ad funds) |
| المبلغ الدفتري | carrying amount | An item's amount in a ledger: what it was measured at, less what was cleared before; month-end revaluations reverse and are not part of it (ADR 0007) |
| قياس جديد | new measurement | A line converted at its ledger's policy rate on the entry date: revenue, a new receivable, cash received, an expense |
| مبلغ محمول | carried amount | A line that releases, clears, settles or reverses a balance at that balance's own amounts; never converted again |
| رصيد جارٍ | running balance | An item kept per counterparty (client ad funds), cleared at its average carrying amount; it may cross zero |
| نوع البند / بند مستند | item kind / document item | A control account's kind of open item: one per document (an invoice, a milestone's contract asset), opened once and cleared toward zero; or a running balance per client (ADR 0013) |
| حركة البند | item movement | The one movement of an item each line on a control account makes, with that line's three amounts: an opening, an addition, a clearing or a void's exchange difference |
| تسوية / تسوية جزئية | settlement / partial settlement | A movement that clears an open item at its carrying amount, in proportion to what remains open; the last clears everything left (ADR 0013) |
| أعمار الذمم | receivables ageing | Open receivable items by days past their due date, in six buckets: not yet due, 1–30, 31–60, 61–90, 91–180, over 180 |
| تاريخ الاستحقاق / أيام التأخير | due date / days past due | When an item is due (its document date when none is set) / the report date minus the due date in force on it |
| كشف حساب عميل | client statement | A client's items and movements on the control accounts, with opening, running and closing balances |
| شطب دين | write-off | Clearing an uncollectible item at its carrying amount to an expense measured on the write-off date (IFRS 9.5.4.4) |
| مقاصة مع الأمانات | offset against client funds | Clearing a client's receivable from the client's ad funds held, on the client's instruction |
| معدّل في ميزان | adjusted in Mizan | A manual movement on an item from Hub or opening balances, shown on the item and in the reconciliation |
| حساب نقدي / غير نقدي | monetary / non-monetary account | Whether foreign-currency balances are revalued (IAS 21) |
| بُعد تحليلي | dimension | An analysis tag on a line; the built-in types are client, contract (a project or a retainer), department and service (ADR 0011) |
| نوع البعد | dimension type | A kind of dimension: the built-in client, contract, department and service, or a custom one |
| قيمة البعد | dimension value | One client, contract, department or service |
| العقد | contract | A project or a retainer, as one dimension with its kind and client; contract positions are netted per contract (IFRS 15.105) |
| مشروع / عقد دوري | project / retainer | The two kinds of a contract value (`contract_kind`): work delivered once, or a service billed in cycles |
| الربط بـ Hub | Hub link | A dimension value's Hub ID; Hub's events find the value by it, never by name |
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
| أعيد تبويب للعرض | reclassified for presentation | An amount a statement shows on another line than its account's, such as a client's debit on client ad funds shown in receivables; the account is unchanged (IAS 1.32) |
| هامش المساهمة | contribution margin | Revenue less direct costs of a client, contract, department or service, with no overhead allocated |
| غير موزع | unassigned | The part of a profitability total whose lines carry no value of the chosen dimension |
| قسم الخدمة | service department | The department a service belongs to, dated, from Hub or set for a manual service (S09 rule 32) |
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
| يقبل سعر العملية | accepts the transaction's rate | A market-rate ledger that takes the rate a connected system dealt at instead of the day's rate (`acceptsTransactionRate`, ADR 0007) |
| الليرة السورية الجديدة | new Syrian pound | `SYP` since 2026-01-01 (100 old = 1 new) |
| فرق صرف محقق | realised exchange difference | Gain or loss when a foreign-currency item is settled (IAS 21.28) |
| فرق صرف غير محقق / إعادة التقييم | unrealised exchange difference / revaluation | Month-end remeasurement of monetary foreign-currency balances (IAS 21.23) |
| سطر التقريب | rounding line | A line to the conversion-rounding account that balances conversion rounding |
| التوزيع | allocation | Splitting an amount into parts that sum exactly (cumulative rounding) |
| إيراد مؤجل / التزامات عقود | deferred revenue / contract liabilities | Amounts invoiced before the service is delivered (IFRS 15) |
| أصل عقد | contract asset | Revenue earned for work done and not yet invoiced (IFRS 15.107) |
| جدول الاعتراف بالإيراد | recognition schedule | How a deferred amount is released to revenue over time |
| تحرير الإيراد | revenue release | The entry moving deferred revenue to revenue |
| العربون | project deposit | The invoice drafted at quote acceptance, before work starts: the first milestone's installment, recognised with that milestone (ADR 0015) |
| حركة جدول الاعتراف | recognition movement | One change to what a schedule still has to recognise: deferred, elapsed, released, credited, reclassified, reversed, remainder released or refunded (ADR 0015) |
| موزع على المدة / عند إنجاز المرحلة | over time / at a point in time | The two recognition patterns: evenly over a service period's days, or on a milestone's done date (IFRS 15.35, 15.38) |
| الجزء المنقضي | elapsed part | The days of a service period in months that ended before its invoice was issued; recognised through a contract asset (A5) |
| فترة خدمة مغلقة | service period closed | A late invoice whose elapsed part falls in a closed month (`SERVICE_PERIOD_CLOSED`) |
| إعادة إصدار | re-issue | An invoice for a cycle or milestone whose earlier invoice was voided; it recognises what the void took back on its own date |
| المتبقي في مشروع ملغى | cancelled project remainder | What a cancelled project still holds in contract liabilities, split by the accountant between revenue and a refund payable |
| الدورة | retainer cycle | A retainer's billing period, anchored on its start date (Hub) |
| أمانات إعلانات العملاء | client ad funds held | Client money held for ad spend; a liability |
| ذمم منصات الإعلان | ad platforms payable | What is owed to ad platforms for client spend |
| مصاريف بانتظار مصدر الدفع | project expenses awaiting payment source | Clearing account for Hub expenses with no payment source |
| حدث | event | A business event sent by a connected system (`invoice.issued`) |
| مفتاح منع التكرار | idempotency key | The event ID that makes a resend post nothing new |
| صندوق الوارد / حدث معلّق | event inbox / held event | Received events; one that could not post yet, with its reason |
| سبب التعليق / تفصيل التعليق | hold reason / hold detail | Why an event is held (`NO_MAPPING`, `RATE_MISSING`, …), and what exactly it waits for (`slot_unmapped:project_cost`, `tax_lines`, …) |
| قاعدة الترحيل | posting rule | How an event type becomes entry lines; accounts mapped by the accountant |
| ربط الحسابات / خانة الربط | posting-rule mapping / mapping slot | The account a posting rule reads for one purpose (`receivable`, `payment_method.cash` in SYP, …), maintained by the owner and the accountant |
| مفتاح الربط | API key | A secret that authenticates an API client; shown once, stored as a hash, at most two active per client |
| حدث مسجّل | recorded event | An event that changed data (a due date, a rate, a name) and posted no entry |
| بانتظار حدث سابق | waiting for an earlier event | Held because an earlier event on the same item is held; posts after it in Hub's order |
| مفتاح البند | item key | What orders a connected system's events: the invoice, the client's ad funds, or the document |
| حُلّ بقيد يدوي | resolved by a manual entry | A held event the accountant handled with a linked manual entry; it never posts itself |
| إسقاط الحدث | dismiss an event | The owner's decision that a held event never posts, with a reason |
| الترحيل في أول فترة مفتوحة | post in the next open period | Posting an event held for a closed period on the first day of the first open period after it |
| هامش فرق السداد | payment tolerance | The gap, in the invoice's currency, between Hub's applied amount and the amount at Hub's rate that posts as an exchange difference; beyond it the event is held |
| المطابقة اليومية | daily reconciliation | Comparing a connected system's daily counts and totals with what Mizan posted |
| تقرير المطابقة | reconciliation report | A connected system's list of the events of one accounting date, with their counts and totals; the latest one of a date counts |
| فرق المطابقة | reconciliation gap | An event missing on one side, or differing in date, type or amount, between a connected system's report and Mizan |
| تاريخ بدء المطابقة | reconciliation start date | The first accounting date a connected system's reports must cover |
| الأرصدة الافتتاحية | opening balances | Balances on the first day of the books |
| مصدر المستند | document source | Which system issues a document type for a company |
| كتاب السيناريوهات | scenario book | Solved examples of every accounting rule, run as tests |
| شكل العملات | currency shape | A scenario's book and parallel currencies (`syp`, `syp-usd`, `usd-syp`, `third`) |
| أرصدة الفترات | period balances | Totals per period, account, dimensions and currency, kept by the posting function |
| بيان القيد / المرجع | entry description / reference | The required Arabic statement of an entry, printed in the journal book / an optional document number |
| سعر الصفقة | dealt rate | The rate a manual entry was actually dealt at; used only by a market ledger that accepts a transaction's rate (ADR 0012) |
| إرسال للاعتماد / اعتماد / رفض / سحب | submit / approve / reject / withdraw | The approval steps of a manual entry when the company switches approval on; the approver is never the preparer |
| معاينة الترحيل | posting preview | The lines as they would post, in both ledgers, with rounding and difference lines, before posting |
| طلب الترحيل | posting request | The idempotency record every posting starts with: client and key (a draft id, an event id) |
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
