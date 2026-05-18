// Strip prompt-injection-smuggling Unicode classes from agent-visible
// email text. Preserves all other Unicode (Finnish, emoji, CJK, accents).
//
// Classes stripped:
//   - Zero-width: U+200B/C/D, U+2060, U+FEFF (invisible, token-splitting)
//   - Bidi controls (full \p{Bidi_Control}): U+061C, U+200E/F, U+202A-E, U+2066-9
//   - Variation selectors: U+FE00-F, U+E0100-1EF (GoodFire-style smuggling)
//   - Tag block: U+E0000-7F (invisible ASCII mirror, tag-block smuggling)
//
// The regex source uses only \u{...} escapes -- never embed literal
// invisible characters in security-critical source. Note: U+200E and
// U+200F are bidi marks that happen to live next to the zero-width
// block, so the range \u{200B}-\u{200F} covers ZWSP/ZWNJ/ZWJ + LRM/RLM
// in one span.
const DANGEROUS = /[\u{061C}\u{200B}-\u{200F}\u{2060}\u{FEFF}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FE00}-\u{FE0F}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

export function sanitizeText(s: string): string;
export function sanitizeText(s: undefined): undefined;
export function sanitizeText(s: string | undefined): string | undefined;
export function sanitizeText(s: string | undefined): string | undefined {
    if (s == null) return s;
    return s.replace(DANGEROUS, "");
}
