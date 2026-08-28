import { createHmac } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class OrganizationExportRetrievalSecretDeriver {
  static create(secret: string): OrganizationExportRetrievalSecretDeriver {
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('Organization Export token secret must contain at least 32 bytes')
    }
    return new OrganizationExportRetrievalSecretDeriver(Buffer.from(secret, 'utf8'))
  }

  private constructor(private readonly secret: Buffer) {}

  derive(input: { requestId: string; operationId: string }): Uint8Array {
    if (!UUID.test(input.requestId) || !UUID.test(input.operationId)) {
      throw new Error('Organization Export retrieval identity must be UUID-bound')
    }
    return createHmac('sha256', this.secret)
      .update('repkey:organization-export-retrieval-secret:v1\0', 'utf8')
      .update(input.requestId.toLowerCase(), 'utf8')
      .update('\0', 'utf8')
      .update(input.operationId.toLowerCase(), 'utf8')
      .digest()
  }
}
