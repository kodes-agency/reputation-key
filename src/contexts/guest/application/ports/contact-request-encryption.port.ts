import type {
  ContactRequestContact,
  ContactRequestScope,
} from '../../domain/contact-request'

export type ContactRequestEncryptionContext = ContactRequestScope &
  Readonly<{ contactRequestId: string; responseId: string }>

export type SealedContactRequestValue = Readonly<{
  keyId: string
  ciphertext: string
}>

export type ContactRequestEncryptionPort = Readonly<{
  seal(
    contact: ContactRequestContact,
    context: ContactRequestEncryptionContext,
  ): SealedContactRequestValue
  open(
    sealed: SealedContactRequestValue,
    context: ContactRequestEncryptionContext,
  ): ContactRequestContact
}>
