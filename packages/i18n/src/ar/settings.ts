/**
 * The settings page (S13 screen 10, ADR 0024 §7): the company's display name and logo, printed on
 * every page and PDF, and the person's password.
 */
export const settings = {
  title: 'الإعدادات',
  description: 'اسم الشركة وشعارها كما يظهران في البرنامج وفي التقارير المطبوعة، وكلمة مرورك.',
  branding: {
    title: 'هوية الشركة',
    description: 'يظهر الاسم والشعار في صفحة الدخول، وأعلى كل صفحة، وعلى كل تقرير PDF.',
    displayName: 'اسم الشركة',
    displayNameHint: 'كما تريد أن يُطبع على التقارير.',
    displayNameTooLong: 'الاسم 200 حرف على الأكثر.',
    save: 'احفظ الاسم',
    saved: 'حُفظ اسم الشركة.',
    logo: 'الشعار',
    logoHint: 'صورة PNG أو JPEG، حجمها 1 ميغابايت على الأكثر. الشعار العريض على خلفية شفافة أوضح.',
    noLogo: 'لم يُرفع شعار بعد: تظهر أيقونة عامة مكانه.',
    upload: 'ارفع شعارًا',
    replace: 'استبدل الشعار',
    uploaded: 'رُفع الشعار.',
    logoType: 'يُقبل الشعار بصيغة PNG أو JPEG فقط.',
    logoTooLarge: 'حجم الشعار أكبر من 1 ميغابايت.',
    readOnly: 'لا تملك صلاحية تعديل هوية الشركة.',
  },
  password: {
    title: 'كلمة المرور',
    description: 'ينهي التغيير كل جلساتك، وتسجّل الدخول بعده بكلمة المرور الجديدة.',
    submit: 'غيّر كلمة المرور',
  },
};
