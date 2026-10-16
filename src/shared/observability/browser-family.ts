// A browser's name, major version and operating system, read from its
// user-agent text for error reports, so a failure seen only in one browser
// stands out. Only these three reach the provider: the full text is a
// fingerprint and stays out (sensitive-field-policy.ts lists `userAgent`).

type Pattern = Readonly<{ name: string; pattern: RegExp }>

// First match wins. Edge, Opera and Samsung Internet also say "Chrome", and
// every Chromium and iOS browser also says "Safari".
const BROWSERS: ReadonlyArray<Pattern> = [
  { name: 'Edge', pattern: /\bEdg(?:e|A|iOS)?\/(\d+)/u },
  { name: 'Opera', pattern: /\bOPR\/(\d+)/u },
  { name: 'Samsung Internet', pattern: /\bSamsungBrowser\/(\d+)/u },
  { name: 'Firefox', pattern: /\b(?:Firefox|FxiOS)\/(\d+)/u },
  { name: 'Chrome', pattern: /\b(?:Chrome|CriOS)\/(\d+)/u },
  { name: 'Safari', pattern: /\bVersion\/(\d+)(?=.*\bSafari\/)/u },
]

// Android and Chrome OS before Linux; iOS before macOS (it says "like Mac OS X").
const SYSTEMS: ReadonlyArray<Pattern> = [
  { name: 'Android', pattern: /\bAndroid\b/u },
  { name: 'Chrome OS', pattern: /\bCrOS\b/u },
  { name: 'iOS', pattern: /\b(?:iPhone|iPad|iPod)\b/u },
  { name: 'Windows', pattern: /\bWindows\b/u },
  { name: 'macOS', pattern: /\bMac OS X\b/u },
  { name: 'Linux', pattern: /\bLinux\b/u },
]

export type BrowserFamily = Readonly<{
  browser?: Readonly<{ name: string; version: string }>
  os?: Readonly<{ name: string }>
}>

function browser(userAgent: string): BrowserFamily['browser'] {
  for (const { name, pattern } of BROWSERS) {
    const version = pattern.exec(userAgent)?.[1]
    if (version) return { name, version }
  }
  return undefined
}

export function browserFamily(userAgent: string): BrowserFamily {
  const found = browser(userAgent)
  const system = SYSTEMS.find(({ pattern }) => pattern.test(userAgent))
  return {
    ...(found ? { browser: found } : {}),
    ...(system ? { os: { name: system.name } } : {}),
  }
}
