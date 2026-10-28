import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { AttachmentContentType } from '@vertex-mizan/contracts';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/** The first bytes of each attachment type (S03 rule 17): the type is read from them, never the name. */
const SIGNATURES: readonly { type: AttachmentContentType; matches: (head: Buffer) => boolean }[] = [
  {
    type: 'application/pdf',
    matches: (head) => head.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    type: 'image/png',
    matches: (head) =>
      head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: 'image/jpeg',
    matches: (head) => head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  },
  {
    type: 'image/webp',
    matches: (head) =>
      head.subarray(0, 4).toString('latin1') === 'RIFF' &&
      head.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** The attachment type of a file by its first bytes, or null for any other file. */
export function attachmentTypeOf(file: Buffer): AttachmentContentType | null {
  return SIGNATURES.find((signature) => signature.matches(file))?.type ?? null;
}

/**
 * The files of attachments and exports on the server's disk (S03, ADR 0008 "Attachments"): under
 * `MIZAN_FILES_DIR`, one folder per company, each file named by its storage key
 * (`<company_id>/<id>`), never by a name a person gave. Served only through the API, inside the
 * company context, by id.
 */
@Injectable()
export class FileStore {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  private pathOf(companyId: string, id: string): string {
    // Both are UUIDs from the database: no separator or dot can reach the path.
    if (!UUID.test(companyId) || !UUID.test(id)) throw new TypeError('A storage key of two UUIDs');
    return join(this.config.filesDir, companyId, id);
  }

  /**
   * Writes a file whole or not at all: to a temporary name first, then renamed, so a crash never
   * leaves half a file under its key. Owner-only permissions.
   */
  async write(companyId: string, id: string, file: Buffer): Promise<void> {
    const path = this.pathOf(companyId, id);
    await mkdir(join(this.config.filesDir, companyId), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.partial`;
    await writeFile(temporary, file, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  }

  read(companyId: string, id: string): Promise<Buffer> {
    return readFile(this.pathOf(companyId, id));
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Global()
@Module({ providers: [FileStore], exports: [FileStore] })
export class FilesModule {}
