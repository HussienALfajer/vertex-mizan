/** The interface language (ADR 0009): Arabic first, right to left. */
export const defaultLanguage = 'ar';

export const textDirection = 'rtl';

/**
 * The locale for `Intl` formatting of dates and counts: Syrian Arabic (`ar-SY`), for the month names
 * read in Syria (أيلول، تشرين الأول; `brand/identity.md`), with Latin digits (`-u-nu-latn`), never
 * Arabic-Indic digits (AGENTS.md). Amounts are never formatted with `Intl`: the money module
 * formats them (`formatMinor`, ADR 0010).
 */
export const formatLocale = 'ar-SY-u-nu-latn';

/** Times are shown in Syria's time zone. */
export const displayTimeZone = 'Asia/Damascus';
