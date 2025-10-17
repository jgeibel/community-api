export function createSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .trim();
}

export function buildStableId(parts: Array<string | null | undefined>, fallback: string): string {
  const sanitized = parts
    .map(part => (part ?? '').toString().trim())
    .filter(part => part.length > 0);

  if (sanitized.length === 0) {
    return fallback;
  }

  const slugged = sanitized.map(createSlug).filter(Boolean);
  if (slugged.length === 0) {
    return fallback;
  }

  return slugged.join('__').slice(0, 200);
}
