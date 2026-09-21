/** Short, collision-resistant ids for client-side entities (line items, etc.). */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normalises text for search and matching: lowercase, no diacritics, and
 * Latin/Cyrillic homoglyphs folded together so typing "skopje" finds "Скопје"
 * and vice versa. Macedonian users routinely type company names either way.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'g', е: 'e', ж: 'z', з: 'z', ѕ: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'l', м: 'm', н: 'n', њ: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', ќ: 'k', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'd',
  ш: 's',
};

export function normalizeForSearch(value: string | null | undefined): string {
  if (!value) return '';
  const lower = value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of lower) out += CYRILLIC_TO_LATIN[ch] ?? ch;
  return out.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** True when every whitespace-separated term in `query` appears in `haystack`. */
export function matchesSearch(haystack: string, query: string): boolean {
  const terms = normalizeForSearch(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const target = normalizeForSearch(haystack);
  return terms.every((term) => target.includes(term));
}
