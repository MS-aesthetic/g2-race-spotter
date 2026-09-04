/**
 * The only module in the glasses app allowed to contain non-ASCII characters
 * (spec 030 R6). The HUD itself is ASCII-only since 030 AC-9 was dropped: the
 * text fallback uses `^ o v` and `# -`. What remains is the status strip's
 * separator and ellipsis, which the firmware has not been observed rendering.
 *
 * `useAsciiFallback()` flips every glyph to its ASCII stand-in in one call, so
 * a hardware session that finds `·` or `…` dropped is a one-line fix.
 */

interface Glyph {
  readonly unicode: string;
  readonly ascii: string;
}

const GLYPHS = {
  separator: { unicode: '·', ascii: '|' },
  ellipsis: { unicode: '…', ascii: '...' },
} as const satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof GLYPHS;

let asciiOnly = false;

/** Switches every glyph to its ASCII fallback (or back). */
export function useAsciiFallback(enabled: boolean): void {
  asciiOnly = enabled;
}

export function glyph(name: GlyphName): string {
  const entry = GLYPHS[name];
  return asciiOnly ? entry.ascii : entry.unicode;
}
