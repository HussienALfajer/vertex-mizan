import { describe, expect, it } from 'vitest';
import { attachmentTypeOf } from './file-store.js';

describe('attachmentTypeOf', () => {
  it('reads PDF, PNG, JPEG and WebP from their first bytes (S03 rule 17)', () => {
    expect(attachmentTypeOf(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(
      attachmentTypeOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])),
    ).toBe('image/png');
    expect(attachmentTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(attachmentTypeOf(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe(
      'image/webp',
    );
  });

  it('refuses anything else, whatever it is called', () => {
    for (const text of ['<html><script>', 'GIF89a', 'PK\u0003\u0004', '', '%PD', 'RIFF....WAVE']) {
      expect(attachmentTypeOf(Buffer.from(text, 'latin1'))).toBeNull();
    }
  });
});
