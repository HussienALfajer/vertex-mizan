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
| قالب الدليل | chart template | A versioned starting chart of accounts (service agency, general) applied at company creation or to an empty chart |
| قالب دليل الحسابات | chart template | A ready chart applied to a new company: service agency or general |
| فئة IFRS 18 | IFRS 18 category | The income-statement category of a statement line: operating, investing, financing, income taxes |
| حساب مراقبة | control account | An account whose balance is the sum of its open items (receivables, client ad funds) |
| بند مفتوح | open item | One document's outstanding balance in a control account (an invoice, a client's ad funds) |
| المبلغ الدفتري | carrying amount | An item's amount in a ledger: what it was measured at, less what was cleared before; month-end revaluations reverse and are not part of it (ADR 0007) |
| قياس جديد | new measurement | A line converted at its ledger's policy rate on the entry date: revenue, a new receivable, cash received, an expense |
| مبلغ محمول | carried amount | A line that releases, clears, settles or reverses a balance at that balance's own amounts; never converted again |
| رصيد جارٍ | running balance | An item kept per counterparty (client ad funds), cleared at its average carrying amount; it may cross zero |
| حساب نقدي / غير نقدي | monetary / non-monetary account | Whether foreign-currency balances are revalued (IAS 21) |
| بُعد تحليلي | dimension | An analysis tag on a line: client, project, department, service |
| نوع البعد | dimension type | A kind of dimension: the built-in client, contract, department and service, or a custom one |
| قيمة البعد | dimension value | One client, contract, department or service |
| العقد | contract | A project or a retainer, as one dimension with its kind and client; contract positions are netted per contract (IFRS 15.105) |
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
| السنة المالية | fiscal year | The calendar year by default |
| الفترة | period | A month of the fiscal year: open or closed |
| إقفال الفترة / إعادة فتحها | close / reopen a period | Stop / allow postings dated inside it |
| قائمة التحقق قبل الإقفال | pre-close checklist | Conditions a period must meet before it closes |
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
| العربون | project deposit | The invoice drafted at quote acceptance, before work starts |
| الدورة | retainer cycle | A retainer's billing period, anchored on its start date (Hub) |
| أمانات إعلانات العملاء | client ad funds held | Client money held for ad spend; a liability |
| ذمم منصات الإعلان | ad platforms payable | What is owed to ad platforms for client spend |
| مصاريف بانتظار مصدر الدفع | project expenses awaiting payment source | Clearing account for Hub expenses with no payment source |
| حدث | event | A business event sent by a connected system (`invoice.issued`) |
| مفتاح منع التكرار | idempotency key | The event ID that makes a resend post nothing new |
| صندوق الوارد / حدث معلّق | event inbox / held event | Received events; one that could not post yet, with its reason |
| قاعدة الترحيل | posting rule | How an event type becomes entry lines; accounts mapped by the accountant |
| المطابقة اليومية | daily reconciliation | Comparing a connected system's daily counts and totals with what Mizan posted |
| الأرصدة الافتتاحية | opening balances | Balances on the first day of the books |
| مصدر المستند | document source | Which system issues a document type for a company |
| كتاب السيناريوهات | scenario book | Solved examples of every accounting rule, run as tests |
| شكل العملات | currency shape | A scenario's book and parallel currencies (`syp`, `syp-usd`, `usd-syp`, `third`) |
| أرصدة الفترات | period balances | Totals per period, account, dimensions and currency, kept by the posting function |
| مرساة السلسلة | chain anchor | The daily chain head emailed to the owner, outside the server |
| سند | voucher | A receipt or payment document that produces an entry (phase 2) |
| شيك / شيك مؤجل | cheque / post-dated cheque | A cheque, or one dated in the future (phase 2 or later) |
| أوراق قبض / أوراق دفع | notes receivable / notes payable | Cheques and bills held or issued until due (phase 2 or later) |
| مركز كلفة | cost centre | A dimension used to analyse costs |
| الفرع | branch | A location of a company (later) |
