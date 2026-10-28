import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The files of attachments and exports under `MIZAN_FILES_DIR`, laid out as `apps/api`'s
 * `FileStore` keeps them: one folder per company, each file named by its storage key
 * (`<company_id>/<id>`), owner-only permissions.
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
   * Writes a stream whole or not at all: to a temporary name first, then renamed, so a crash or a
   * retry never leaves half a file under its key; a failed write removes its temporary file.
   */
  async write(companyId: string, id: string, source: Readable): Promise<void> {
    const path = this.pathOf(companyId, id);
    await mkdir(join(this.config.filesDir, companyId), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.partial`;
    try {
      await pipeline(source, createWriteStream(temporary, { mode: 0o600, flags: 'wx' }));
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  /** A file's size, or null when it is not on disk. */
  async size(companyId: string, id: string): Promise<number | null> {
    try {
      return (await stat(this.pathOf(companyId, id))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** A file as a stream, read as it is consumed. */
  open(companyId: string, id: string): ReadStream {
    return createReadStream(this.pathOf(companyId, id));
  }

  /** Deletes a file; one already gone is no error, so a second run does nothing. */
  async remove(companyId: string, id: string): Promise<void> {
    await rm(this.pathOf(companyId, id), { force: true });
  }
}

@Global()
@Module({ providers: [FileStore], exports: [FileStore] })
export class FilesModule {}
