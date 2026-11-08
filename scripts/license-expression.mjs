import { createRequire } from 'node:module'

// SPDX license expressions: OR binds loosest, then AND, then WITH, and
// parentheses group. Operators match in any case; license identifiers must be
// known SPDX identifiers (current or deprecated) or LicenseRef- references.
// Exception identifiers are not checked against a list: a WITH term passes only
// when its complete terms are approved, so an unknown exception never passes.
const require = createRequire(import.meta.url)
const LICENSE_IDS = new Set([
  ...require('spdx-license-ids'),
  ...require('spdx-license-ids/deprecated'),
])
const LICENSE_REF = /^(?:DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/
const LICENSE_ID = /^([A-Za-z0-9.-]+?)(\+?)$/
const EXCEPTION_ID = /^[A-Za-z0-9.-]+$/
const OPERATORS = new Set(['AND', 'OR', 'WITH'])

function malformed() {
  throw new SyntaxError('malformed license expression')
}

function licenseTerm(token) {
  if (token === undefined || OPERATORS.has(token.toUpperCase())) malformed()
  if (LICENSE_REF.test(token)) return token
  const [, id, plus] = token.match(LICENSE_ID) ?? malformed()
  return LICENSE_IDS.has(id) ? `${id}${plus}` : malformed()
}

// Every branch is parsed before the two are combined, so a malformed tail
// rejects the whole expression even when an earlier choice already passed.
function evaluate(tokens, allowed) {
  let at = 0
  const operator = () => tokens[at]?.toUpperCase()

  function term() {
    if (tokens[at] === '(') {
      at++
      const value = anyOf()
      if (tokens[at++] !== ')') malformed()
      return value
    }
    // Approve the complete terms, never a bare license stripped of its
    // exception or later-version grant.
    const license = licenseTerm(tokens[at++])
    if (operator() !== 'WITH') return allowed.has(license)
    at++
    const exception = tokens[at++]
    if (
      exception === undefined ||
      !EXCEPTION_ID.test(exception) ||
      OPERATORS.has(exception.toUpperCase())
    ) {
      malformed()
    }
    return allowed.has(`${license} WITH ${exception}`)
  }

  function allOf() {
    let value = term()
    while (operator() === 'AND') {
      at++
      const right = term()
      value = value && right
    }
    return value
  }

  function anyOf() {
    let value = allOf()
    while (operator() === 'OR') {
      at++
      const right = allOf()
      value = value || right
    }
    return value
  }

  const value = anyOf()
  if (at !== tokens.length) malformed()
  return value
}

export function isAllowedExpression(expression, allowed) {
  const tokens = expression.replace(/[()]/g, ' $& ').trim().split(/\s+/).filter(Boolean)
  try {
    return evaluate(tokens, allowed)
  } catch {
    return false
  }
}
