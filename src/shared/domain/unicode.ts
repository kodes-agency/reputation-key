/** PostgreSQL `char_length` semantics: count Unicode code points, not UTF-16 units. */
export const unicodeCodePointLength = (value: string): number => Array.from(value).length
