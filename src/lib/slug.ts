/**
 * URL slugs for Arabic listing names.
 *
 * Arabic characters are perfectly legal in a URL path (they get percent-encoded
 * on the wire and most browsers display them decoded), and an Arabic slug is
 * far better for SEO in this market than a transliteration: /listings/استراحة-الرمال-الذهبية
 * matches what people actually search for.
 *
 * We keep Arabic letters and digits, drop punctuation and diacritics, and
 * collapse whitespace to hyphens.
 */

// Arabic diacritics (tashkeel) carry no search value and break exact matching.
const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;

export function slugify(input: string): string {
  const base = input
    .trim()
    .replace(TASHKEEL, "")
    // Normalise the alef variants and ya/hamza so "إستراحة" and "استراحة" agree.
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    // Keep Arabic block, ASCII alphanumerics, spaces and hyphens.
    .replace(/[^ء-غف-يa-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return base || "listing";
}

/**
 * Make a slug unique against slugs already in use, appending -2, -3, …
 * `taken` is normally the result of a `findMany({ select: { slug: true } })`.
 */
export function uniqueSlug(desired: string, taken: readonly string[]): string {
  const base = slugify(desired);
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
