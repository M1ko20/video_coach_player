/** A contrasting outline keeps drawings readable on any footage. */
export function haloFor(color: string, strength: number): string {
  const value = parseInt(color.slice(1), 16);
  const luminance =
    (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
  return luminance < 0.25 ? `rgba(255,255,255,${strength})` : `rgba(0,0,0,${strength})`;
}
