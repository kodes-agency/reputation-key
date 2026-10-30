export const BUILTIN_REPLY_VOICE_LANGUAGE_GROUPS = [
  'en-Latn',
  'es-Latn',
  'bg-Cyrl',
] as const

export type BuiltinReplyVoiceLanguageGroup =
  (typeof BUILTIN_REPLY_VOICE_LANGUAGE_GROUPS)[number]

export function isBuiltinReplyVoiceLanguageGroup(
  value: string,
): value is BuiltinReplyVoiceLanguageGroup {
  return (BUILTIN_REPLY_VOICE_LANGUAGE_GROUPS as readonly string[]).includes(value)
}
