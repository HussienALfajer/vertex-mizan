import { Global, Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/** One email as the outbox sends it: plain Arabic text, right to left in every client. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** Sends one email; throws when the server refuses it, so the outbox tries again later. */
export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

/** Injection token for the transport; the tests put a capturing one in its place. */
export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

/** The server's SMTP account (ADR 0008), through nodemailer. */
export function smtpTransport(config: Config): EmailTransport {
  const transport = createTransport(config.smtpUrl);
  return {
    async send(email) {
      await transport.sendMail({ from: config.emailFrom, ...email });
    },
  };
}

@Global()
@Module({
  providers: [{ provide: EMAIL_TRANSPORT, inject: [CONFIG], useFactory: smtpTransport }],
  exports: [EMAIL_TRANSPORT],
})
export class EmailModule {}
