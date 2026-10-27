import { randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';

// Test files run in parallel, each with its own module state: each starts at a random point.
let nextAddress = randomInt(1, 2 ** 24 - 100_000);

/** A private IPv4 address per browser, so the per-IP limits of one test never reach another. */
function newAddress(): string {
  const n = nextAddress++;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

type Method = 'get' | 'post' | 'patch' | 'put';

/**
 * A browser for the API tests: it keeps its cookies (the `__Host-` session cookie is `Secure`, so
 * supertest's own cookie jar would not send it over plain HTTP), sends its own client address
 * through `X-Forwarded-For` (trusted from loopback), and puts the company it shows in
 * `X-Mizan-Company` on writes, as the web app does (S01 rule 22).
 */
export class Browser {
  private readonly cookies = new Map<string, string>();
  /** The company the page shows; sent with every write. */
  companyId: string | null = null;

  constructor(
    private readonly app: INestApplication,
    readonly address = newAddress(),
  ) {}

  get(
    path: string,
    query?: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return this.send('get', path, undefined, query, headers);
  }

  post(path: string, body?: object, headers: Record<string, string> = {}): Promise<Response> {
    return this.send('post', path, body, undefined, headers);
  }

  patch(path: string, body?: object, headers: Record<string, string> = {}): Promise<Response> {
    return this.send('patch', path, body, undefined, headers);
  }

  put(path: string, body?: object, headers: Record<string, string> = {}): Promise<Response> {
    return this.send('put', path, body, undefined, headers);
  }

  /** A GET whose answer is a file: its body as a `Buffer`, whatever its type. */
  download(path: string, query?: Record<string, string>): Promise<Response> {
    return this.send('get', path, undefined, query, {}, true);
  }

  /** The value of a cookie this browser holds. */
  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  forgetCookies(): void {
    this.cookies.clear();
  }

  private async send(
    method: Method,
    path: string,
    body?: object,
    query?: Record<string, string>,
    headers: Record<string, string> = {},
    binary = false,
  ): Promise<Response> {
    let call = request(this.app.getHttpServer())
      [method](path)
      .set('x-forwarded-for', this.address)
      .set('user-agent', 'Mizan test browser');
    if (this.cookies.size > 0) {
      call = call.set(
        'cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    if (method !== 'get' && this.companyId) call = call.set('x-mizan-company', this.companyId);
    for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
    if (query) call = call.query(query);
    if (binary) {
      call = call.buffer(true).parse((answer, done) => {
        const chunks: Buffer[] = [];
        answer.on('data', (chunk: Buffer) => chunks.push(chunk));
        answer.on('end', () => done(null, Buffer.concat(chunks)));
      });
    }
    const response = await (body === undefined ? call : call.send(body));
    this.keep(response);
    return response;
  }

  private keep(response: Response): void {
    const set = response.headers['set-cookie'] as unknown as string[] | undefined;
    for (const line of set ?? []) {
      const [pair = '', ...attributes] = line.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0$/i.test(attribute));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}
