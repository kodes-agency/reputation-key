import type {
  GuestCopyKeyV2,
  GuestCopyValues,
  GuestPluralForms,
  GuestPortalCopyV2,
} from './language-packs/guest-copy-v2'

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g

/** The distinct placeholder names in a template, in order of first use. */
export function templatePlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))]
}

/**
 * Fills the `{placeholder}` slots of a pack text. A missing value throws: a
 * guest must never see a raw `{name}` in place of the property's name.
 */
export function fillGuestTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(PLACEHOLDER, (_slot, name: string) => {
    const value = values[name]
    if (value === undefined) {
      throw new Error(`Missing value for guest copy placeholder {${name}}`)
    }
    return String(value)
  })
}

/** Picks the plural form the locale's rules give for `count` and fills `{count}`. */
export function formatGuestPlural(
  forms: GuestPluralForms,
  count: number,
  localeTag: string,
): string {
  const category = new Intl.PluralRules(localeTag).select(count)
  return fillGuestTemplate(forms[category] ?? forms.other, { count })
}

type CopyArguments<K extends GuestCopyKeyV2> = keyof GuestCopyValues<K> extends never
  ? []
  : [values: GuestCopyValues<K>]

/** One text of a pack, with its placeholders filled in and type-checked per key. */
export function guestCopyText<K extends GuestCopyKeyV2>(
  pack: GuestPortalCopyV2,
  key: K,
  ...args: CopyArguments<K>
): string {
  const [values] = args
  return fillGuestTemplate(pack.copy[key], values ?? {})
}
