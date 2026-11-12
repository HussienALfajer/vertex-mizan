import type { Browser } from 'playwright-core';

export interface PrintOptions {
  /**
   * The footer of every page, "صفحة {page} من {pages}", the printer filling both numbers; null
   * for a document that numbers its own pages (the journal book, rule 27).
   */
  readonly pageNumbers: string | null;
}

/** How long one document may take to load and print (S09: a year's journal book ≤ 10 minutes). */
export const PRINT_TIMEOUT_MS = 10 * 60_000;

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The page footer Chromium fills: its template's own spans for the numbers. */
export function footerTemplate(pageNumbers: string): string {
  const text = escapeHtml(pageNumbers)
    .replace('{page}', '<span class="pageNumber"></span>')
    .replace('{pages}', '<span class="totalPages"></span>');
  return `<div style="font-size:8pt;width:100%;text-align:center;direction:rtl;font-family:sans-serif">${text}</div>`;
}

/**
 * A whole HTML document (fonts inlined) printed on A4 as its CSS sets it, in a context of its own
 * with JavaScript off and every request refused, so the document reaches nothing beyond itself.
 */
export async function printPdf(
  browser: Browser,
  html: string,
  options: PrintOptions,
): Promise<Buffer> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(PRINT_TIMEOUT_MS);
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: options.pageNumbers !== null,
      headerTemplate: '<span></span>',
      footerTemplate:
        options.pageNumbers === null ? '<span></span>' : footerTemplate(options.pageNumbers),
    });
  } finally {
    await context.close();
  }
}
