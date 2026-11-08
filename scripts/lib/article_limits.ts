export const MAX_TITLE_LENGTH = 150;

export function titleLength(title: string): number {
  return Array.from(title).length;
}

export function titleLengthError(title: string): string | null {
  const length = titleLength(title);
  if (length > MAX_TITLE_LENGTH) {
    return `Title is ${length} characters; the limit is ${MAX_TITLE_LENGTH} (the title is signed and cannot be shortened after publication)`;
  }
  return null;
}
