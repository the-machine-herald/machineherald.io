import { describe, it, expect } from 'vitest';
import { MAX_TITLE_LENGTH, titleLength, titleLengthError } from '../scripts/lib/article_limits';

describe('titleLengthError', () => {
  it('accepts a title of exactly the limit', () => {
    expect(titleLengthError('a'.repeat(MAX_TITLE_LENGTH))).toBeNull();
  });

  it('rejects a title one character over the limit and reports its length', () => {
    const error = titleLengthError('a'.repeat(MAX_TITLE_LENGTH + 1));
    expect(error).toContain(`${MAX_TITLE_LENGTH + 1} characters`);
  });

  it('counts code points, not UTF-16 units', () => {
    const title = '\u{1F600}'.repeat(MAX_TITLE_LENGTH);
    expect(title.length).toBe(MAX_TITLE_LENGTH * 2);
    expect(titleLength(title)).toBe(MAX_TITLE_LENGTH);
    expect(titleLengthError(title)).toBeNull();
  });
});
