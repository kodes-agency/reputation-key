// Colour arithmetic for tests that read design tokens out of `src/styles.css`:
// parse a token block, resolve `var()` references, convert OKLCH to sRGB, and
// measure WCAG 2.x contrast. No dependencies. Test-only: nothing in the app
// imports it (the app has no reason to read its own stylesheet).

/** Linear-light sRGB, each channel 0..1. */
export type LinearRgb = readonly [number, number, number]

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/
const VAR_REF = /^var\(\s*(--[\w-]+)\s*\)$/

/** The declarations of the first rule whose selector is exactly `selector`. */
export function readTokenBlock(
  css: string,
  selector: string,
): ReadonlyMap<string, string> {
  const open = css.search(new RegExp(`(^|\\n)${escapeRegExp(selector)}\\s*\\{`))
  if (open === -1) throw new Error(`No "${selector}" block in the stylesheet`)
  const start = css.indexOf('{', open) + 1
  let depth = 1
  let end = start
  while (depth > 0 && end < css.length) {
    const char = css[end]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    end += 1
  }
  const body = css.slice(start, end - 1).replace(/\/\*[\s\S]*?\*\//g, '')
  const tokens = new Map<string, string>()
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1]!, match[2]!.trim())
  }
  return tokens
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A token's colour, following `var(--other)` references. `base` supplies the
 * tokens a block leaves to the other one (`.dark` only overrides, so a token it
 * does not declare resolves from `:root`).
 */
export function resolveColour(
  name: string,
  tokens: ReadonlyMap<string, string>,
  base: ReadonlyMap<string, string> = new Map(),
): LinearRgb {
  const value = tokens.get(name) ?? base.get(name)
  if (value === undefined) throw new Error(`Token ${name} is not declared`)
  const reference = VAR_REF.exec(value)
  if (reference) return resolveColour(reference[1]!, tokens, base)
  return parseOklch(value)
}

function parseOklch(value: string): LinearRgb {
  const match = OKLCH.exec(value)
  if (!match) throw new Error(`Not an oklch() colour: ${value}`)
  return oklchToLinearRgb(Number(match[1]), Number(match[2]), Number(match[3]))
}

/** OKLCH to linear-light sRGB (Björn Ottosson's matrices), clipped to gamut. */
function oklchToLinearRgb(lightness: number, chroma: number, hue: number): LinearRgb {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (channel: number) => Math.min(1, Math.max(0, channel))
  return [
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const encode = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
const decode = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

/**
 * `foreground` at `alpha` over `backdrop`. Browsers blend gamma-encoded sRGB, so
 * the mix is done there and brought back to linear light.
 */
export function composite(
  foreground: LinearRgb,
  backdrop: LinearRgb,
  alpha: number,
): LinearRgb {
  const mixed = foreground.map((channel, index) =>
    decode(encode(channel) * alpha + encode(backdrop[index]!) * (1 - alpha)),
  )
  return [mixed[0]!, mixed[1]!, mixed[2]!]
}

/** WCAG 2.x relative luminance. */
function relativeLuminance([red, green, blue]: LinearRgb): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** WCAG 2.x contrast ratio, 1..21, in either argument order. */
export function contrastRatio(first: LinearRgb, second: LinearRgb): number {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
