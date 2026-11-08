import parse from 'spdx-expression-parse'

function isAllowed(node, allowed) {
  if (node.conjunction === 'or') {
    return isAllowed(node.left, allowed) || isAllowed(node.right, allowed)
  }
  if (node.conjunction === 'and') {
    return isAllowed(node.left, allowed) && isAllowed(node.right, allowed)
  }

  // Approve the complete terms, never a bare license stripped of its exception
  // or later-version grant. Package-specific exceptions remain in the gate.
  const license = `${node.license}${node.plus ? '+' : ''}`
  return allowed.has(node.exception ? `${license} WITH ${node.exception}` : license)
}

export function isAllowedExpression(expression, allowed) {
  let parsed
  try {
    parsed = parse(expression)
  } catch {
    return false
  }
  return isAllowed(parsed, allowed)
}
