const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeHtmlEntities(value: string): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  let result = value.replace(/&#(\d+);/g, (_, code) => {
    const num = Number.parseInt(code, 10);
    if (Number.isNaN(num)) return _;
    try {
      return String.fromCodePoint(num);
    } catch {
      return _;
    }
  });

  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const num = Number.parseInt(hex, 16);
    if (Number.isNaN(num)) return _;
    try {
      return String.fromCodePoint(num);
    } catch {
      return _;
    }
  });

  result = result.replace(/&([a-zA-Z]+);/g, (_, name: string) => {
    const lower = name.toLowerCase();
    if (NAMED_ENTITIES[lower]) {
      return NAMED_ENTITIES[lower];
    }
    return _;
  });

  return result;
}

export function stripHtml(value: string): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  let working = value;

  working = working.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr|\/td|\/th)\b[^>]*>/gi, '\n');
  working = working.replace(/<(p|div|li|h[1-6]|section|article|tr|td|th)\b[^>]*>/gi, '\n');
  working = working.replace(/<br\s*\/?>/gi, '\n');

  working = working.replace(/<[^>]+>/g, '');

  working = decodeHtmlEntities(working);
  working = working.replace(/\r\n/g, '\n');
  working = working.replace(/\n{3,}/g, '\n\n');
  working = working.replace(/[ \t]+\n/g, '\n');
  working = working.replace(/\n[ \t]+/g, '\n');
  working = working.replace(/[ \t]{2,}/g, ' ');

  return working.trim();
}
