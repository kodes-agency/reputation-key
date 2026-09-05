#!/usr/bin/env node
// Negative controls for the repository's eslint-plugin-boundaries v7 policy.
// A green production lint is not proof if an unclassified source file simply
// bypasses the dependency rule. These in-memory fixtures exercise every
// high-leverage file/layer category without mutating the working tree.

import { ESLint } from 'eslint'
import { resolve } from 'node:path'

const cwd = process.cwd()
const eslint = new ESLint({ cwd })

// ARC-03-T16: the unknown-dependency rule joins the filter. It is the rule
// that catches an import of a local file no element or file descriptor claims
// — a target `boundaries/dependencies` silently ignores. Both spellings are
// listed because v7 renamed it and the old id still resolves to the same rule.
const UNKNOWN_DEPENDENCY_RULES = [
  'boundaries/no-unknown-dependencies',
  'boundaries/no-unknown',
]
const BOUNDARY_RULES = [
  'boundaries/dependencies',
  'boundaries/no-unknown-files',
  ...UNKNOWN_DEPENDENCY_RULES,
]

const controls = [
  {
    name: 'domain cannot import database runtime',
    file: 'src/contexts/review/domain/boundary-negative-control.ts',
    source: "import '#/shared/db'\n",
  },
  {
    name: 'context build cannot import UI',
    file: 'src/contexts/review/build-boundary-negative-control.ts',
    source: "import '#/components/ui/button'\n",
  },
  {
    name: 'composition root cannot import UI',
    file: 'src/composition.ts',
    source: "import '#/components/ui/button'\n",
  },
  {
    name: 'outbox runtime cannot import auth implementation',
    file: 'src/shared/outbox/relay.ts',
    source: "import '#/shared/auth/auth'\n",
  },
  {
    name: 'route cannot import database runtime',
    file: 'src/routes/boundary-negative-control.ts',
    source: "import '#/shared/db'\n",
  },
  {
    name: 'component cannot import database runtime',
    file: 'src/components/boundary-negative-control.ts',
    source: "import '#/shared/db'\n",
  },
  {
    name: 'trust-boundary service cannot import context internals',
    file: 'services/google-egress-gateway/boundary-negative-control.ts',
    source: "import '#/contexts/review/infrastructure/review-command-store'\n",
  },
  {
    name: 'Nitro plugin cannot import UI',
    file: 'server/plugins/boundary-negative-control.ts',
    source: "import '#/components/ui/button'\n",
  },
  {
    name: 'infrastructure cannot reach outward to composition',
    file: 'src/contexts/review/infrastructure/boundary-negative-control.ts',
    source: "import '#/composition'\n",
  },
  {
    name: 'browser route cannot resolve the runtime container',
    file: 'src/routes/_authenticated/boundary-negative-control.tsx',
    source: "import '#/composition'\n",
  },
  {
    name: 'UI support cannot import a context server adapter',
    file: 'src/lib/boundary-negative-control.ts',
    source: "import '#/contexts/review/server/reply'\n",
  },
  // ARC-03-T1: scripts/ is a mandated control category. Operator commands
  // are audited admin entry points, not browsers — a context's server layer
  // is an inbound HTTP adapter and is off limits to every script.
  {
    name: 'operator script cannot import a context server adapter',
    file: 'scripts/ops/boundary-negative-control.ts',
    source: "import '../../src/contexts/review/server/reply'\n",
  },
  {
    name: 'CI script cannot import a context server adapter',
    file: 'scripts/ci/boundary-negative-control.ts',
    source: "import '../../src/contexts/review/server/reply'\n",
  },
  // A repository verifier is static analysis. If it can construct a
  // repository or resolve the container it is no longer a check, it is a
  // second deployment path with no operator, ticket or audit record.
  {
    name: 'CI script cannot import context infrastructure',
    file: 'scripts/ci/boundary-negative-control.ts',
    source: "import '../../src/contexts/review/infrastructure/review-command-store'\n",
  },
  {
    name: 'CI script cannot resolve the composition root',
    file: 'scripts/ci/boundary-negative-control.ts',
    source: "import '../../src/composition'\n",
  },
  // ARC-03-T2: the sidecars run outside the application trust boundary.
  // "shared/" is not a package they inherit — only the named provider kernel.
  {
    name: 'trust-boundary service cannot import the application database',
    file: 'services/ai-egress-gateway/boundary-negative-control.ts',
    source: "import '../../src/shared/db'\n",
  },
  {
    name: 'trust-boundary service cannot import the auth kernel',
    file: 'services/ai-egress-gateway/boundary-negative-control.ts',
    source: "import '../../src/shared/auth/auth'\n",
  },
  {
    name: 'trust-boundary service cannot import the job queue factory',
    file: 'services/ai-egress-gateway/boundary-negative-control.ts',
    source: "import '../../src/shared/jobs/queue'\n",
  },
  // ARC-03-T3: shared/ is no longer one mutually self-importing bucket. The
  // browser-reachable query namespace and the server-only job runtime are
  // different elements with different owners.
  {
    name: 'shared query namespace cannot import the job runtime',
    file: 'src/shared/queries/boundary-negative-control.ts',
    source: "import '#/shared/jobs/queue'\n",
  },
  // ARC-03-T16: one process builds one Application Container. A request
  // handler that can construct the WORKER container holds worker registration
  // authority and a second set of queue connections.
  {
    name: 'start entry cannot import the worker container builder',
    file: 'src/start.ts',
    source: "import '#/composition/deployables'\n",
  },
  {
    name: 'route cannot import the worker container builder',
    file: 'src/routes/boundary-negative-control.ts',
    source: "import '#/composition/deployables'\n",
  },
  // The api-route category IS allowed to resolve the composition root, so this
  // is the control that proves the deployable fence is doing its own work
  // rather than riding on the composition-root ban.
  {
    name: 'API route cannot import the worker container builder',
    file: 'src/routes/api/boundary-negative-control.ts',
    source: "import '#/composition/deployables'\n",
  },
  // ARC-03-T16: classifying `.storybook/**` so no-unknown could be enabled
  // must not become a licence for production code to link the harness.
  {
    name: 'component cannot import the Storybook harness',
    file: 'src/components/boundary-negative-control.ts',
    source: "import '../../.storybook/AuthedRouterDecorator'\n",
  },
  // ARC-03-T16: boundaries/no-unknown. An unclassified local target is a hole
  // through every policy above, because the dependency rule ignores dependants
  // it cannot classify.
  {
    name: 'route cannot import an unclassified local module',
    file: 'src/routes/boundary-negative-control.ts',
    source: "import '../../vitest.config'\n",
    expect: UNKNOWN_DEPENDENCY_RULES,
  },
]

const allowedControls = [
  {
    name: 'domain may import shared domain',
    file: 'src/contexts/review/domain/boundary-positive-control.ts',
    source: "import '#/shared/domain/ids'\n",
  },
  {
    name: 'composition may import a context build seam',
    file: 'src/composition.ts',
    source: "import '#/contexts/review/build'\n",
  },
  {
    name: 'trust-boundary service may import a shared kernel',
    file: 'services/google-egress-gateway/boundary-positive-control.ts',
    source: "import '../../src/shared/google-provider-control/contracts'\n",
  },
  {
    name: 'router may import a UI primitive',
    file: 'src/router.tsx',
    source: "import '#/components/ui/button'\n",
  },
  {
    name: 'context server adapter may resolve the application container',
    file: 'src/contexts/review/server/boundary-positive-control.ts',
    source: "import '#/composition'\n",
  },
  {
    name: 'API route may resolve a narrow runtime operation',
    file: 'src/routes/api/boundary-positive-control.ts',
    source: "import '#/composition'\n",
  },
  {
    name: 'component may import shared UI support',
    file: 'src/components/boundary-positive-control.ts',
    source: "import '#/lib/utils'\n",
  },
  // ARC-03-T1: the two seams scripts/ are supposed to use.
  {
    name: 'operator script may resolve the composition root',
    file: 'scripts/ops/boundary-positive-control.ts',
    source: "import '../../src/composition'\n",
  },
  {
    name: 'CI script may import a shared governance catalogue',
    file: 'scripts/ci/boundary-positive-control.ts',
    source: "import '../../src/shared/governance/entry-point-catalogue'\n",
  },
  // ARC-03-T2: the two halves of the named kernel — a nested provider module
  // and a root contract file — must both stay reachable.
  {
    name: 'trust-boundary service may import the provider kernel',
    file: 'services/ai-egress-gateway/boundary-positive-control.ts',
    source: "import '../../src/shared/google-provider-control/route-catalogue'\n",
  },
  {
    name: 'trust-boundary service may import the AI transport contract',
    file: 'services/ai-egress-gateway/boundary-positive-control.ts',
    source: "import '../../src/shared/ai-internal-transport-contract'\n",
  },
  // ARC-03-T3: the same edge from the area that owns queue-depth readiness is
  // documented and must stay open — the split is a placement rule, not a ban.
  {
    name: 'shared health may import the job runtime',
    file: 'src/shared/health/boundary-positive-control.ts',
    source: "import '#/shared/jobs/queue'\n",
  },
  // ARC-03-T16: the worker entry is the one process that must build it.
  {
    name: 'worker entry may import the worker container builder',
    file: 'src/worker/boundary-positive-control.ts',
    source: "import '#/composition/deployables'\n",
  },
  {
    name: 'story file may import the Storybook harness',
    file: 'src/components/boundary-positive-control.stories.tsx',
    source: "import '../../.storybook/AuthedRouterDecorator'\n",
  },
]

async function boundaryMessages(control) {
  const [result] = await eslint.lintText(control.source, {
    filePath: resolve(cwd, control.file),
  })
  return result.messages.filter(({ ruleId }) => BOUNDARY_RULES.includes(ruleId))
}

const failures = []
for (const control of controls) {
  const expected = control.expect ?? ['boundaries/dependencies']
  const messages = await boundaryMessages(control)
  if (!messages.some(({ ruleId }) => expected.includes(ruleId))) {
    failures.push(
      `${control.name}: invalid import was accepted (expected ${expected.join(
        ' or ',
      )}, saw ${messages.map(({ ruleId }) => ruleId).join(', ') || 'nothing'})`,
    )
  }
  if (messages.some(({ ruleId }) => ruleId === 'boundaries/no-unknown-files')) {
    failures.push(`${control.name}: fixture source file is unclassified`)
  }
}

for (const control of allowedControls) {
  const messages = await boundaryMessages(control)
  if (messages.length > 0) {
    failures.push(
      `${control.name}: valid import was rejected (${messages
        .map(({ ruleId }) => ruleId)
        .join(', ')})`,
    )
  }
}

if (failures.length > 0) {
  console.error('Architecture boundary controls failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(
  `[architecture-boundaries] OK — ${controls.length} invalid imports rejected; ${allowedControls.length} valid seams accepted.`,
)
