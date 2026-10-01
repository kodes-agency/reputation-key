// A stand-in for a property logo, for stories only: a wordmark drawn as an SVG
// so a story needs no network and no binary file. 240 x 64.

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64" viewBox="0 0 240 64">
<rect x="1" y="1" width="62" height="62" rx="31" fill="none" stroke="#ead6a8" stroke-width="2"/>
<path d="M18 46 L32 16 L46 46" fill="none" stroke="#ead6a8" stroke-width="3" stroke-linejoin="round"/>
<text x="78" y="43" font-family="Georgia, serif" font-size="30" letter-spacing="6" fill="#fff">AVELA</text>
</svg>`

export const STORY_LOGO = {
  url: `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`,
  width: 240,
  height: 64,
} as const
