export type AiSubjectHmacPort = Readonly<{
  sign(subject: string): Readonly<{ keyVersion: string; digest: string }>
}>
