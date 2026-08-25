/** Strict RFC 8785 JSON Canonicalization Scheme serializer. */
function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('RFC 8785 strings must contain only Unicode scalar values')
      }
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('RFC 8785 strings must contain only Unicode scalar values')
    }
  }
}

function serializeCanonical(value: unknown, seen: Set<object>): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    assertUnicodeScalarString(value)
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new TypeError('RFC 8785 input is not JSON')
  if (seen.has(value)) throw new TypeError('RFC 8785 input contains a cycle')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError('RFC 8785 arrays must have the exact Array prototype')
      }
      if (Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError('RFC 8785 arrays cannot contain symbol properties')
      }
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
      if (
        lengthDescriptor === undefined ||
        typeof lengthDescriptor.value !== 'number' ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        Object.keys(descriptors).length !== lengthDescriptor.value + 1
      ) {
        throw new TypeError('RFC 8785 arrays must be dense and unextended')
      }
      const length = lengthDescriptor.value
      const members = new Array<string>(length)
      for (let index = 0; index < length; index += 1) {
        const key = String(index)
        const descriptor = descriptors[key]
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !('value' in descriptor) ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.value === undefined
        ) {
          throw new TypeError('RFC 8785 arrays contain an unsafe member')
        }
        members[index] = serializeCanonical(descriptor.value, seen)
      }
      return `[${members.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('RFC 8785 objects must be plain objects')
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError('RFC 8785 objects cannot contain symbol properties')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(descriptors).sort()
    const members: string[] = new Array(keys.length)
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!
      assertUnicodeScalarString(key)
      const descriptor = descriptors[key]!
      if (
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        descriptor.value === undefined
      ) {
        throw new TypeError(`RFC 8785 object contains an unsafe property: ${key}`)
      }
      members[index] =
        `${JSON.stringify(key)}:${serializeCanonical(descriptor.value, seen)}`
    }
    return `{${members.join(',')}}`
  } finally {
    seen.delete(value)
  }
}

export function canonicalizeRfc8785(value: unknown): string {
  return serializeCanonical(value, new Set())
}
