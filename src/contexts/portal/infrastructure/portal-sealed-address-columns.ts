// The two `portal_tokens` columns that hold a code's sealed address (ADR 0064).
//
// A code keeps a sealed address only while it is active: the table's CHECK
// `portal_tokens_sealed_address_active_only` refuses any other state. Every
// statement that moves a token out of `active` (a replacement, a stop, a Portal
// delete) writes this value in the same UPDATE, from here, so the rule has one
// spelling.

export const NO_SEALED_ADDRESS = Object.freeze({
  encryptedRawToken: null,
  addressEncryptionKeyVersion: null,
})
