/**
 * The emails Mizan sends (S01; `apps/worker`'s `email.send`). A `{name}` is filled by the worker
 * with the email's data: never a real name or company in this file.
 */
export const email = {
  invitation: {
    subject: 'دعوة للانضمام إلى {companyName} في ميزان',
    body: 'دُعيت للانضمام إلى {companyName} في ميزان بدور {role}{inviter}.\n\nلقبول الدعوة افتح هذا الرابط:\n{link}\n\nالرابط صالح لمرة واحدة حتى {expiresAt} (توقيت دمشق). إن لم تكن تنتظر هذه الدعوة فتجاهل هذه الرسالة.',
    inviter: ' من {inviterName}',
  },
  passwordReset: {
    subject: 'إعادة تعيين كلمة المرور في ميزان',
    body: 'طُلبت إعادة تعيين كلمة المرور لحسابك في ميزان.\n\nلتعيين كلمة مرور جديدة افتح هذا الرابط:\n{link}\n\nالرابط صالح لمرة واحدة حتى {expiresAt} (توقيت دمشق). ستحتاج بعدها إلى رمز المصادقة الثنائية كالمعتاد. إن لم تطلب ذلك فتجاهل هذه الرسالة.',
  },
  twoFactorReset: {
    subject: 'أُعيد ضبط المصادقة الثنائية لحسابك في ميزان',
    byOwner:
      'أعاد مالك {companyName} ضبط المصادقة الثنائية لحسابك في ميزان، وأُنهيت جلساتك كلها.\n\nعند تسجيل دخولك التالي ستسجّل تطبيق المصادقة من جديد وتحفظ رموزًا احتياطية جديدة. إن لم تطلب ذلك فتواصل مع مالك الشركة فورًا.',
    byVertex:
      'أعادت Vertex ضبط المصادقة الثنائية لحسابك في ميزان بناءً على طلبك، وأُنهيت جلساتك كلها.\n\nعند تسجيل دخولك التالي ستسجّل تطبيق المصادقة من جديد وتحفظ رموزًا احتياطية جديدة. إن لم تطلب ذلك فتواصل مع Vertex فورًا.',
  },
  dailyAnchor: {
    subject: 'رأس سلسلة القيود ليوم {anchoredOn} في ميزان',
    body: 'هذا رأس سلسلة القيود لكل شركة تملكها في ميزان كما كان في نهاية يوم {anchoredOn} (توقيت دمشق).\n\n{anchors}\n\nاحفظ هذه الرسالة خارج ميزان. لفحص سلامة الدفاتر لاحقًا الصق التاريخ وعدد القيود والبصمة في صفحة فحص السلامة: إن لم تطابق السلسلة فقد تغيّر شيء بعد هذا اليوم. تصلك هذه الرسالة كل يوم، فإن غابت يومًا فتواصل مع Vertex.',
    anchor: '{companyName}\nالتاريخ: {anchoredOn}\nعدد القيود: {entryCount}\nالبصمة: {headHash}',
  },
  exportReady: {
    subject: 'تصدير بيانات {companyName} جاهز في ميزان',
    body: 'أصبح التصدير الكامل لبيانات {companyName} جاهزًا للتنزيل.\n\nنزّله من صفحة التصدير بعد تسجيل دخولك:\n{link}\n\nيبقى الملف متاحًا حتى {expiresAt} (توقيت دمشق)، ثم يُحذف. إن لم تطلب هذا التصدير فتواصل مع Vertex فورًا.',
  },
  heldDigest: {
    subject: 'ما يحتاج إلى متابعة من Hub في {companyName}',
    // S08 rule 16: sent when any section has content; each section only when it has.
    body: 'ملخص صباح {day} (توقيت دمشق) لشركة {companyName}.{opening}{held}{unclosed}{reconciliation}\n\nتصلك هذه الرسالة في كل يوم فيه ما يحتاج إلى متابعة.',
    heldSection:
      'في صندوق الوارد أحداث من Hub معلّقة لم تُرحَّل بعد.\n\nعُلّق منذ الملخص السابق: {newlyHeld}\n\nالمعلّق كله بحسب السبب:\n{lines}\n\nراجعها وعالجها من صندوق الوارد:\n{link}',
    line: '- {reason}: {count}',
    // S07: the ended months not closed, each with its failing checklist items.
    unclosedTitle: 'أشهر منتهية غير مقفلة:',
    unclosedLine: '- {period}: بنود فاشلة في قائمة التحقق قبل الإقفال: {count}',
    // S08 rule 16: the days not clean, the latest first, each with its gaps.
    reconciliationTitle: 'أيام المطابقة غير النظيفة:',
    reconciliationMissing: '- {date}: لم يصل تقرير Hub',
    reconciliationDifferences: '- {date}: فيه فروق: {count}',
    afterClose: ' (بعد الإقفال)',
    // S10 "Jobs": from the day Hub's snapshot arrives until the opening posts.
    opening:
      'الأرصدة الافتتاحية لم تُرحَّل بعد: أحداث Hub تنتظر ترحيلها قبل أن تُقبل.\n\nأكملها من صفحة الأرصدة الافتتاحية:\n{link}',
    reconciliationLink: 'راجعها من صفحة المطابقة اليومية:\n{link}',
    reasons: {
      PERIOD_CLOSED: 'الفترة مقفلة',
      SERVICE_PERIOD_CLOSED: 'فترة الخدمة مقفلة',
      UNKNOWN_REFERENCE: 'المستند المرجعي لم يصل بعد',
      NO_MAPPING: 'لا يوجد ربط بحساب',
      RATE_MISSING: 'سعر الصرف غير مسجّل',
      NEEDS_DECISION: 'بحاجة إلى قرار المحاسب',
      OPEN_ITEM_HAS_SETTLEMENTS: 'على البند تسويات قائمة',
      WAITING_FOR_EARLIER_EVENT: 'بانتظار حدث سابق',
    },
  },
  signature: '— ميزان من Vertex',
} as const;
