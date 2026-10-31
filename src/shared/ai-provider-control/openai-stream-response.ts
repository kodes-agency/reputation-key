import type { OpenAiStreamClient, OpenAiTerminalResponse } from './openai-connector'
import type { z } from 'zod/v4'
import { parseAiProviderJsonBytes } from '#/shared/ai-internal-transport-contract'
import type { PreparedAiInvocation } from './prepared-invocation'

/** The SDK decodes SSE; only the terminal response supplies billed usage and final output. */
export async function readOpenAiReplyStream(
  client: OpenAiStreamClient,
  invocation: Pick<PreparedAiInvocation, 'sdkRequest'>,
  schema: z.ZodTypeAny,
  signal: AbortSignal,
  onText?: (text: string) => void,
) {
  const stream = await client.responses.create(
    {
      ...invocation.sdkRequest,
      stream: true,
      input: invocation.sdkRequest.input.map((message) => ({ ...message })),
      tools: [],
    },
    { signal },
  )
  let terminal: OpenAiTerminalResponse | null = null
  let text = ''
  let malformed = false
  try {
    for await (const event of stream) {
      if (terminal) {
        malformed = true
        continue
      }
      if (event.type === 'response.output_text.delta') {
        text += event.delta
        if (Buffer.byteLength(text, 'utf8') > 16_384)
          throw new Error('Reply stream exceeded bound')
        onText?.(event.delta)
      }
      if (
        event.type === 'response.completed' ||
        event.type === 'response.incomplete' ||
        event.type === 'response.failed'
      )
        terminal = event.response
    }
  } catch (error) {
    if (!terminal) throw error
    malformed = true
  }
  if (!terminal) throw new Error('Reply stream has no terminal response')
  return {
    ...terminal,
    output_parsed: malformed ? null : parseTerminalReply(terminal, text, schema),
  }
}

function parseTerminalReply(
  response: OpenAiTerminalResponse,
  text: string,
  schema: z.ZodTypeAny,
): unknown {
  if (response.status !== 'completed') return null
  let bytes: Buffer | null = null
  try {
    const parts = response.output.flatMap((item) =>
      item.type === 'message' ? item.content : [],
    )
    if (parts.length !== 1 || parts[0]?.type !== 'output_text' || parts[0].text !== text)
      return null
    bytes = Buffer.from(text, 'utf8')
    return parseAiProviderJsonBytes(bytes, 16_384, schema)
  } catch {
    return null
  } finally {
    bytes?.fill(0)
  }
}
