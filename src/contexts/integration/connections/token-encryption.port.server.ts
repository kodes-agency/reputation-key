// Integration context — token encryption port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Encryption boundary for OAuth tokens stored in database.

export type TokenEncryptionPort = Readonly<{
  encrypt: (plaintext: string) => string
  decrypt: (ciphertext: string) => string
}>
