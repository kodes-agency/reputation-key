// A stand-in for a property photo, for stories only: a dusk sky over a
// colonnade and a tree, drawn as an SVG so a story needs no network and no
// binary file. 1600 x 1000, like the fixture hero in the snapshot tests.

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#35402f"/><stop offset="0.55" stop-color="#8a6a3c"/><stop offset="1" stop-color="#d7a86a"/>
</linearGradient>
<linearGradient id="pool" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#c79a62"/><stop offset="1" stop-color="#3b3a30"/>
</linearGradient>
</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
<g fill="#1d2418" opacity="0.92">
<circle cx="1180" cy="230" r="230"/><circle cx="1380" cy="330" r="190"/><circle cx="980" cy="330" r="170"/>
<rect x="1150" y="380" width="40" height="320"/>
</g>
<g fill="#b59a72" opacity="0.9">
<rect x="120" y="140" width="90" height="620"/><rect x="380" y="140" width="90" height="620"/>
<rect x="640" y="140" width="90" height="620"/><rect x="100" y="110" width="660" height="50"/>
</g>
<rect y="700" width="1600" height="300" fill="url(#pool)"/>
</svg>`

export const STORY_HERO_PHOTO = {
  url: `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`,
  width: 1600,
  height: 1000,
  focalX: 0.5,
  focalY: 0.42,
} as const
