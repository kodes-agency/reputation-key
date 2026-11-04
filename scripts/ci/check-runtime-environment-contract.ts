import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { isEntryPoint } from './entry-point'

/** Check key coverage without parsing example credentials or booting the app. */
export function missingExampleKeys(schemaSource: string, example: string): string[] {
  const source = ts.createSourceFile('env.ts', schemaSource, ts.ScriptTarget.Latest)
  let shape: ts.ObjectLiteralExpression | undefined
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === 'baseEnvSchema' &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const argument = node.initializer.arguments[0]
      if (argument && ts.isObjectLiteralExpression(argument)) shape = argument
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!shape || shape.properties.length === 0) {
    throw new Error('Cannot find the baseEnvSchema object in env.ts')
  }
  const keys = shape.properties.map((property) => {
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ) {
      throw new Error('Unsupported baseEnvSchema property in env.ts')
    }
    return property.name.text
  })
  const documented = new Set(
    [...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) => match[1]),
  )
  return keys.filter((key) => !documented.has(key)).sort()
}

function main(): number {
  const schema = readFileSync(
    new URL('../../src/shared/config/env.ts', import.meta.url),
    'utf8',
  )
  const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
  const missing = missingExampleKeys(schema, example)
  if (missing.length > 0) {
    process.stderr.write(
      `[runtime-environment-contract] Missing .env.example keys:\n${missing.map((key) => `  ${key}`).join('\n')}\n`,
    )
    return 1
  }
  process.stdout.write(
    '[runtime-environment-contract] OK — .env.example covers all environment keys\n',
  )
  return 0
}

if (isEntryPoint(import.meta.url)) {
  process.exit(main())
}
