const PLACEHOLDER = /\{([a-zA-Z]+)\}/g

/** The distinct placeholder names in a template, in order of first use. */
export function templatePlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))]
}
