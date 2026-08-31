import { existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CONTEXT_STANDARDS_AUTHORITY } from './context-standards-authority'
import { CONTEXT_STANDARDS_MATRIX } from './context-standards-matrix'

const ROOT = process.cwd()
const ALLOWED_SOURCE_VALUES = new Set(['import', 'web'])
const FORBIDDEN_EVENT_FIELDS = new Set([
  'authorUserId',
  'changedBy',
  'connectedBy',
  'createdAt',
  'createdBy',
  'inviterId',
  'recordedAt',
])

type EventConstructor = Readonly<{
  declaration: ts.FunctionLikeDeclaration
  signature: ts.Signature
}>

type ContextEnvelopeAudit = Readonly<{
  directory: string
  eventCount: number
  issues: readonly string[]
  assertionIssues: readonly string[]
}>

function eventUnionName(contextName: string): string {
  return contextName === 'AI' ? 'AiEvent' : `${contextName}Event`
}

function typeParts(type: ts.Type): readonly ts.Type[] {
  return type.isUnion() ? type.types : [type]
}

function stringLiteralValues(type: ts.Type): readonly string[] | null {
  const values: string[] = []
  for (const part of typeParts(type)) {
    if ((part.flags & ts.TypeFlags.StringLiteral) === 0) return null
    values.push((part as ts.StringLiteralType).value)
  }
  return values.sort()
}

function propertyType(
  checker: ts.TypeChecker,
  owner: ts.Type,
  propertyName: string,
): ts.Type | null {
  const property = checker.getPropertyOfType(owner, propertyName)
  const declaration = property?.valueDeclaration ?? property?.declarations?.[0]
  return property != null && declaration != null
    ? checker.getTypeOfSymbolAtLocation(property, declaration)
    : null
}

function isRequiredString(checker: ts.TypeChecker, type: ts.Type | null): boolean {
  if (type == null) return false
  return typeParts(type).every(
    (part) =>
      (part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Null | ts.TypeFlags.Undefined)) ===
        0 && checker.isTypeAssignableTo(part, checker.getStringType()),
  )
}

function isDate(checker: ts.TypeChecker, type: ts.Type | null): boolean {
  return type != null && checker.typeToString(type) === 'Date'
}

function isNullableString(
  checker: ts.TypeChecker,
  type: ts.Type | null,
  allowUndefined: boolean,
): boolean {
  if (type == null) return false
  let hasNull = false
  let hasString = false
  for (const part of typeParts(type)) {
    if ((part.flags & ts.TypeFlags.Null) !== 0) {
      hasNull = true
    } else if ((part.flags & ts.TypeFlags.Undefined) !== 0 && allowUndefined) {
      continue
    } else if (
      (part.flags & ts.TypeFlags.Any) === 0 &&
      checker.isTypeAssignableTo(part, checker.getStringType())
    ) {
      hasString = true
    } else {
      return false
    }
  }
  return hasNull && hasString
}

function isOptionalNullableString(
  checker: ts.TypeChecker,
  type: ts.Type | null,
): boolean {
  return (
    type != null &&
    typeParts(type).some((part) => (part.flags & ts.TypeFlags.Undefined) !== 0) &&
    isNullableString(checker, type, true)
  )
}

function unionMembers(checker: ts.TypeChecker, declaration: ts.TypeAliasDeclaration) {
  const union = checker.getTypeAtLocation(declaration)
  return union.isUnion() ? union.types : [union]
}

function exportedConstructors(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, readonly EventConstructor[]> {
  const module = checker.getSymbolAtLocation(sourceFile)
  const constructors = new Map<string, EventConstructor[]>()
  if (module == null) return constructors

  for (const exported of checker.getExportsOfModule(module)) {
    const declaration = exported.valueDeclaration ?? exported.declarations?.[0]
    if (
      declaration == null ||
      (!ts.isVariableDeclaration(declaration) && !ts.isFunctionDeclaration(declaration))
    ) {
      continue
    }
    const callableType = checker.getTypeOfSymbolAtLocation(exported, declaration)
    for (const signature of checker.getSignaturesOfType(
      callableType,
      ts.SignatureKind.Call,
    )) {
      const tag = propertyType(
        checker,
        checker.getReturnTypeOfSignature(signature),
        '_tag',
      )
      const tags = tag == null ? null : stringLiteralValues(tag)
      const functionLike = signature.getDeclaration()
      if (
        tags?.length !== 1 ||
        functionLike == null ||
        (!ts.isArrowFunction(functionLike) &&
          !ts.isFunctionDeclaration(functionLike) &&
          !ts.isFunctionExpression(functionLike) &&
          !ts.isMethodDeclaration(functionLike))
      ) {
        continue
      }
      const current = constructors.get(tags[0]!) ?? []
      current.push({ declaration: functionLike, signature })
      constructors.set(tags[0]!, current)
    }
  }
  return constructors
}

function nodeContains(
  root: ts.Node,
  predicate: (candidate: ts.Node) => boolean,
): boolean {
  if (predicate(root)) return true
  return root.getChildren().some((child) => nodeContains(child, predicate))
}

function referencesInput(
  declaration: ts.FunctionLikeDeclaration,
  parameterName: string,
  fieldName: string,
  allowSpread: boolean,
): boolean {
  return nodeContains(declaration, (node) => {
    if (
      allowSpread &&
      ts.isSpreadAssignment(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === parameterName
    ) {
      return true
    }
    return (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === parameterName &&
      node.name.text === fieldName
    )
  })
}

function setsFixedSource(
  declaration: ts.FunctionLikeDeclaration,
  expected: string,
): boolean {
  return nodeContains(
    declaration,
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'source' &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === expected,
  )
}

function hasAllowedSourceType(type: ts.Type | null, allowUndefined: boolean): boolean {
  if (type == null) return false
  let valueCount = 0
  for (const part of typeParts(type)) {
    if ((part.flags & ts.TypeFlags.Undefined) !== 0 && allowUndefined) continue
    if ((part.flags & ts.TypeFlags.StringLiteral) === 0) return false
    valueCount += 1
    if (!ALLOWED_SOURCE_VALUES.has((part as ts.StringLiteralType).value)) return false
  }
  return valueCount > 0
}

function generatesEventId(declaration: ts.FunctionLikeDeclaration): boolean {
  return nodeContains(declaration, (node) => {
    if (
      !ts.isPropertyAssignment(node) ||
      node.name.getText() !== 'eventId' ||
      !ts.isCallExpression(node.initializer)
    ) {
      return false
    }
    const callee = node.initializer.expression
    return (
      (ts.isIdentifier(callee) && callee.text === 'newEventId') ||
      (ts.isPropertyAccessExpression(callee) &&
        callee.expression.getText() === 'crypto' &&
        callee.name.text === 'randomUUID')
    )
  })
}

function callsAssertion(declaration: ts.FunctionLikeDeclaration): boolean {
  return nodeContains(declaration, (node) => {
    if (!ts.isCallExpression(node)) return false
    const callee = node.expression
    return (
      ts.isIdentifier(callee) &&
      (callee.text === 'assert' ||
        callee.text.startsWith('assert') ||
        callee.text.startsWith('validate'))
    )
  })
}

function inputType(
  checker: ts.TypeChecker,
  constructor: EventConstructor,
): Readonly<{ name: string; type: ts.Type }> | null {
  const parameter = constructor.signature.parameters[0]
  const declaration = parameter?.valueDeclaration ?? parameter?.declarations?.[0]
  if (parameter == null || declaration == null) return null
  return {
    name: parameter.getName(),
    type: checker.getTypeOfSymbolAtLocation(parameter, declaration),
  }
}

function isReadonlyTypeNode(
  sourceFile: ts.SourceFile,
  node: ts.TypeNode,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (
    ts.isParenthesizedTypeNode(node) ||
    (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword)
  ) {
    return isReadonlyTypeNode(sourceFile, node.type, seen)
  }
  if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    return node.types.every((part) => isReadonlyTypeNode(sourceFile, part, seen))
  }
  if (ts.isTypeLiteralNode(node)) {
    return node.members.every(
      (member) =>
        !ts.isPropertySignature(member) ||
        member.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
        ) === true,
    )
  }
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return false
  if (node.typeName.text === 'Readonly') return true
  if (seen.has(node.typeName.text)) return false
  const alias = sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === node.typeName.getText(sourceFile),
  )
  if (alias == null) return false
  return isReadonlyTypeNode(
    sourceFile,
    alias.type,
    new Set([...seen, node.typeName.text]),
  )
}

function isReadonlyEventType(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  tag: string,
): boolean {
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration => {
      if (!ts.isTypeAliasDeclaration(statement)) return false
      const candidateTag = propertyType(
        checker,
        checker.getTypeAtLocation(statement),
        '_tag',
      )
      return (
        candidateTag != null && stringLiteralValues(candidateTag)?.includes(tag) === true
      )
    },
  )
  return declaration != null && isReadonlyTypeNode(sourceFile, declaration.type)
}

function fieldOrderIssues(checker: ts.TypeChecker, event: ts.Type): readonly string[] {
  const fields = checker.getPropertiesOfType(event).map(({ name }) => name)
  const issues: string[] = []
  if (fields[0] !== '_tag') issues.push('_tag must be the first field')
  if (fields[1] !== 'eventId') issues.push('eventId must follow _tag')

  const organizationIndex = fields.indexOf('organizationId')
  const propertyIndex = fields.indexOf('propertyId')
  const userIndex = fields.indexOf('userId')
  if (propertyIndex >= 0 && organizationIndex > propertyIndex) {
    issues.push('organizationId must precede propertyId')
  }
  if (userIndex >= 0 && organizationIndex > userIndex) {
    issues.push('organizationId must precede userId')
  }
  if (userIndex >= 0 && propertyIndex >= 0 && propertyIndex > userIndex) {
    issues.push('propertyId must precede userId')
  }

  const occurredAtIndex = fields.indexOf('occurredAt')
  const correlationIdIndex = fields.indexOf('correlationId')
  if (occurredAtIndex !== fields.length - 2 || correlationIdIndex !== fields.length - 1) {
    issues.push('occurredAt and correlationId must be the final envelope fields')
  }
  return issues
}

/** Absent, or every constituent is `null` or an assignable non-any string. */
function isStringOrExplicitNull(checker: ts.TypeChecker, type: ts.Type | null): boolean {
  if (type == null) return true
  return typeParts(type).every(
    (part) =>
      (part.flags & ts.TypeFlags.Null) !== 0 ||
      ((part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Undefined)) === 0 &&
        checker.isTypeAssignableTo(part, checker.getStringType())),
  )
}

/** One event under audit, with the two issue sinks its rules report into. */
type EventAuditSubject = Readonly<{
  checker: ts.TypeChecker
  sourceFile: ts.SourceFile
  event: ts.Type
  tag: string
  sourceType: ts.Type | null
  sourceValues: readonly string[] | null
  issue: (message: string) => void
  assertionIssue: (message: string) => void
}>

/** No event field may use a forbidden name or an actor-id suffix. */
function auditEventFieldVocabulary(subject: EventAuditSubject): void {
  const { checker, event, issue } = subject
  for (const field of checker.getPropertiesOfType(event)) {
    if (
      FORBIDDEN_EVENT_FIELDS.has(field.name) ||
      (/By(?:User)?Id?$/u.test(field.name) && field.name !== 'removedBy')
    ) {
      issue(`${field.name} violates the event field vocabulary`)
    }
  }
}

/** A `source` field, when the event declares one, may only offer allowed origins. */
function auditEventSource(subject: EventAuditSubject): void {
  const { sourceType, sourceValues, issue } = subject
  if (sourceType == null) return
  if (
    sourceValues == null ||
    sourceValues.length === 0 ||
    sourceValues.some((source) => !ALLOWED_SOURCE_VALUES.has(source))
  ) {
    issue("source may contain only 'web' or 'import'")
  }
}

/** Envelope shape rules for one event type in a context's event union. */
function auditEventShape(subject: EventAuditSubject): void {
  const { checker, sourceFile, event, tag, issue } = subject
  if (!isRequiredString(checker, propertyType(checker, event, 'eventId'))) {
    issue('eventId must be a required string')
  }
  if (!isReadonlyEventType(checker, sourceFile, tag)) {
    issue('event type must be readonly')
  }
  if (!isRequiredString(checker, propertyType(checker, event, 'organizationId'))) {
    issue('organizationId must be a required string')
  }
  if (!isDate(checker, propertyType(checker, event, 'occurredAt'))) {
    issue('occurredAt must be a required Date')
  }
  if (!isNullableString(checker, propertyType(checker, event, 'correlationId'), false)) {
    issue('correlationId must be exactly string | null')
  }
  if (!isStringOrExplicitNull(checker, propertyType(checker, event, 'propertyId'))) {
    issue('propertyId must be a string or explicit null')
  }
  if (!isStringOrExplicitNull(checker, propertyType(checker, event, 'userId'))) {
    issue('userId must be a string or explicit null')
  }
  if (checker.getPropertyOfType(event, 'data') != null) {
    issue('payload must be flat; data wrappers are forbidden')
  }
  auditEventFieldVocabulary(subject)
  auditEventSource(subject)
  for (const orderingIssue of fieldOrderIssues(checker, event)) issue(orderingIssue)
}

/** The constructor must either accept an allowed `source` or set a fixed one. */
function auditConstructorSource(
  subject: EventAuditSubject,
  constructor: EventConstructor,
  input: Readonly<{ name: string; type: ts.Type }>,
): void {
  const { checker, sourceType, sourceValues, issue } = subject
  if (sourceType == null || sourceValues == null) return
  const constructorSource = propertyType(checker, input.type, 'source')
  if (constructorSource != null) {
    if (!hasAllowedSourceType(constructorSource, true)) {
      issue("constructor source may contain only 'web' or 'import'")
    } else if (!referencesInput(constructor.declaration, input.name, 'source', false)) {
      issue('constructor must preserve its caller-provided source')
    }
    return
  }
  if (sourceValues.length > 1) {
    issue('constructor must receive source when the event admits multiple origins')
  } else if (!setsFixedSource(constructor.declaration, sourceValues[0]!)) {
    issue(`constructor must set its fixed ${sourceValues[0]} source at emit time`)
  }
}

/** Emit-time rules for the single exported constructor of one event. */
function auditEventConstructor(
  subject: EventAuditSubject,
  eventConstructors: readonly EventConstructor[],
): void {
  const { checker, issue, assertionIssue } = subject
  if (eventConstructors.length !== 1) {
    issue(`expected exactly one exported constructor, found ${eventConstructors.length}`)
    assertionIssue(
      `expected exactly one exported constructor, found ${eventConstructors.length}`,
    )
    return
  }
  const constructor = eventConstructors[0]!
  const input = inputType(checker, constructor)
  if (input == null) {
    issue('constructor must accept one event argument object')
    assertionIssue('constructor must accept one event argument object')
    return
  }
  if (!callsAssertion(constructor.declaration)) {
    assertionIssue('constructor must call assert or a named assertion helper')
  }
  if (checker.getPropertyOfType(input.type, 'eventId') != null) {
    issue('constructor input must not accept eventId')
  }
  if (!isDate(checker, propertyType(checker, input.type, 'occurredAt'))) {
    issue('constructor must receive occurredAt as a required Date')
  } else if (!referencesInput(constructor.declaration, input.name, 'occurredAt', true)) {
    issue('constructor must preserve its caller-provided occurredAt')
  }
  if (
    !isOptionalNullableString(checker, propertyType(checker, input.type, 'correlationId'))
  ) {
    issue('constructor must accept an optional string | null correlationId')
  } else if (
    !referencesInput(constructor.declaration, input.name, 'correlationId', false)
  ) {
    issue('constructor must preserve its caller-provided correlationId')
  }
  if (!generatesEventId(constructor.declaration)) {
    issue('constructor must generate eventId at emit time')
  }
  auditConstructorSource(subject, constructor, input)
}

function auditContextEnvelope(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  contextName: string,
  directory: string,
): ContextEnvelopeAudit {
  const unionName = eventUnionName(contextName)
  const unionDeclaration = sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === unionName,
  )
  if (unionDeclaration == null) {
    return {
      directory,
      eventCount: 0,
      issues: [`missing ${unionName}`],
      assertionIssues: [`missing ${unionName}`],
    }
  }

  const constructors = exportedConstructors(checker, sourceFile)
  const issues: string[] = []
  const assertionIssues: string[] = []
  const members = unionMembers(checker, unionDeclaration)
  const unionTags = new Set<string>()
  for (const event of members) {
    const tagType = propertyType(checker, event, '_tag')
    const tagValues = tagType == null ? null : stringLiteralValues(tagType)
    const tag = tagValues?.length === 1 ? tagValues[0]! : checker.typeToString(event)
    const sourceType = propertyType(checker, event, 'source')
    const subject: EventAuditSubject = {
      checker,
      sourceFile,
      event,
      tag,
      sourceType,
      sourceValues: sourceType == null ? [] : stringLiteralValues(sourceType),
      issue: (message) => {
        issues.push(`${tag}: ${message}`)
      },
      assertionIssue: (message) => {
        assertionIssues.push(`${tag}: ${message}`)
      },
    }

    if (tagValues?.length !== 1) {
      subject.issue('_tag must be one string literal')
    } else if (unionTags.has(tag)) {
      subject.issue('event union contains a duplicate _tag')
    } else {
      unionTags.add(tag)
    }

    auditEventShape(subject)
    auditEventConstructor(subject, constructors.get(tag) ?? [])
  }

  return {
    directory,
    eventCount: members.length,
    issues: [...new Set(issues)].sort(),
    assertionIssues: [...new Set(assertionIssues)].sort(),
  }
}

function buildEnvelopeAudits(): readonly ContextEnvelopeAudit[] {
  const eventful = CONTEXT_STANDARDS_AUTHORITY.filter(({ directory }) =>
    existsSync(join(ROOT, 'src', 'contexts', directory, 'domain', 'events.ts')),
  )
  const config = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile)
  if (config.error != null)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT)
  const paths = eventful.map(({ directory }) =>
    join(ROOT, 'src', 'contexts', directory, 'domain', 'events.ts'),
  )
  const program = ts.createProgram(paths, parsed.options)
  const checker = program.getTypeChecker()
  const diagnostics = paths.flatMap((fileName) => {
    const sourceFile = program.getSourceFile(fileName)
    return sourceFile == null
      ? []
      : [
          ...program.getSyntacticDiagnostics(sourceFile),
          ...program.getSemanticDiagnostics(sourceFile),
        ]
  })
  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => ROOT,
        getNewLine: () => '\n',
      }),
    )
  }

  return eventful.map(({ name, directory }) => {
    const path = join(ROOT, 'src', 'contexts', directory, 'domain', 'events.ts')
    const sourceFile = program.getSourceFile(path)
    if (sourceFile == null) {
      return {
        directory,
        eventCount: 0,
        issues: ['event source is outside the program'],
        assertionIssues: ['event source is outside the program'],
      }
    }
    return auditContextEnvelope(checker, sourceFile, name, directory)
  })
}

describe('event-envelope standards matrix proof', () => {
  const audits = buildEnvelopeAudits()

  it('classifies all 17 retained contexts and audits every event-producing union', () => {
    expect(CONTEXT_STANDARDS_MATRIX).toHaveLength(17)
    expect(audits.map(({ directory }) => directory)).toEqual(
      CONTEXT_STANDARDS_MATRIX.filter(
        ({ standards }) => standards.envelope.applicability === 'applicable',
      ).map(({ directory }) => directory),
    )
    for (const row of CONTEXT_STANDARDS_MATRIX.filter(
      ({ standards }) => standards.envelope.applicability === 'not_applicable',
    )) {
      expect(
        existsSync(join(ROOT, 'src', 'contexts', row.directory, 'domain', 'events.ts')),
        row.directory,
      ).toBe(false)
    }
    for (const audit of audits)
      expect(audit.eventCount, audit.directory).toBeGreaterThan(0)
  })

  it('checks every event-union member and records only fully conforming contexts as evidenced', () => {
    const eventCount = audits.reduce((count, audit) => count + audit.eventCount, 0)
    expect(eventCount).toBeGreaterThan(0)

    for (const audit of audits) {
      const matrix = CONTEXT_STANDARDS_MATRIX.find(
        ({ directory }) => directory === audit.directory,
      )!
      expect(matrix.standards.envelope.resolution, audit.issues.join('\n')).toBe(
        audit.issues.length === 0 ? 'evidenced' : 'unresolved',
      )
    }
  })

  it('keeps the current conforming set explicit and exposes every unresolved violation', () => {
    expect(
      audits
        .filter(({ issues }) => issues.length === 0)
        .map(({ directory }) => directory),
    ).toEqual([
      'ai',
      'badge',
      'goal',
      'guest',
      'identity',
      'inbox',
      'integration',
      'metric',
      'portal',
      'property',
      'review',
      'staff',
      'team',
    ])
    for (const audit of audits.filter(({ issues }) => issues.length > 0)) {
      expect(audit.issues, audit.directory).not.toEqual([])
    }
  })

  it('checks every event constructor for an explicit minimal assertion path', () => {
    expect(
      audits
        .filter(({ assertionIssues }) => assertionIssues.length === 0)
        .map(({ directory }) => directory),
    ).toEqual([
      'ai',
      'badge',
      'goal',
      'guest',
      'identity',
      'inbox',
      'integration',
      'metric',
      'portal',
      'property',
      'review',
      'staff',
      'team',
    ])
    for (const audit of audits) {
      const matrix = CONTEXT_STANDARDS_MATRIX.find(
        ({ directory }) => directory === audit.directory,
      )!
      expect(matrix.standards.assert.resolution, audit.assertionIssues.join('\n')).toBe(
        audit.assertionIssues.length === 0 ? 'evidenced' : 'unresolved',
      )
    }
  })
})
