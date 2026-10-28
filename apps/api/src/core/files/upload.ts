import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  PayloadTooLargeException,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { ATTACHMENT_MAX_BYTES } from '@vertex-mizan/contracts';
import type { Observable } from 'rxjs';
import { CodedException } from '../errors/coded-exception.js';

/** A file as the upload hands it to the handler: in memory, with the name the person gave. */
export interface UploadedAttachment {
  readonly originalname: string;
  readonly buffer: Buffer;
  readonly size: number;
}

/**
 * Reads one file of at most 10 MB from the `file` field of a multipart body, in memory (S03 rule
 * 17), with UTF-8 file names; a larger file is `ATTACHMENT_TOO_LARGE`. It runs after the access
 * guard, so nobody uploads before their access is checked.
 */
class AttachmentInterceptor extends FileInterceptor('file', {
  limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 0 },
  defParamCharset: 'utf8',
}) {
  override async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new CodedException('ATTACHMENT_TOO_LARGE', 'An attachment over 10 MB');
      }
      throw error;
    }
  }
}

/** The upload of one attachment, documented as a multipart body with its `file`. */
export function AttachmentUpload() {
  return applyDecorators(
    UseInterceptors(AttachmentInterceptor),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file'],
        properties: { file: { type: 'string', format: 'binary' } },
      },
    }),
  );
}

/** The name a person gave a file, kept for display only: no path, no control characters. */
export function fileNameOf(upload: UploadedAttachment): string {
  const name = (upload.originalname.split(/[/\\]/).pop() ?? '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return [...(name === '' ? 'attachment' : name)].slice(0, 255).join('');
}
