import { Global, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { describeForLog } from '@vertex-mizan/db';
import { type Browser, chromium } from 'playwright-core';
import { type PrintOptions, printPdf } from './pdf.js';

export type { PrintOptions } from './pdf.js';

/** Injection token for the printer of PDFs (S09 rule 36): Chromium, or a stand-in in tests. */
export const PDF_PRINTER = Symbol('PDF_PRINTER');

export interface PdfPrinter {
  /** A whole HTML document (fonts inlined, nothing fetched) printed on A4 as its CSS sets it. */
  print(html: string, options: PrintOptions): Promise<Buffer>;
}

/** Renders at once per worker instance (S09 "Abuse and failure cases"). */
const CONCURRENT_RENDERS = 2;

/**
 * Chromium through `playwright-core` (ADR 0002), the version the E2E suite pins: launched on the
 * first print and kept, two renders at a time (`printPdf()`). Closed on shutdown.
 */
@Injectable()
export class ChromiumPrinter implements PdfPrinter, OnApplicationShutdown {
  private readonly logger = new Logger('PdfPrinter');
  private browser: Promise<Browser> | null = null;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  async print(html: string, options: PrintOptions): Promise<Buffer> {
    await this.slot();
    try {
      return await printPdf(await this.launch(), html, options);
    } finally {
      // The slot passes straight to the next waiting render, or frees.
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    }
  }

  private async slot(): Promise<void> {
    if (this.running < CONCURRENT_RENDERS) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium.launch({ headless: true }).catch((error: unknown) => {
        this.browser = null;
        this.logger.error(`Chromium did not start: ${describeForLog(error)}`);
        throw error;
      });
    }
    return this.browser;
  }

  async onApplicationShutdown(): Promise<void> {
    const browser = await this.browser?.catch(() => null);
    await browser?.close();
  }
}

/** The printer for the worker (global): Chromium, replaced by a stand-in in the job tests. */
@Global()
@Module({
  providers: [{ provide: PDF_PRINTER, useClass: ChromiumPrinter }],
  exports: [PDF_PRINTER],
})
export class PrintModule {}
