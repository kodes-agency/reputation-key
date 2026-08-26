#!/usr/bin/env node
// Negative controls for the repository's eslint-plugin-boundaries v7 policy.
// A green production lint is not proof if an unclassified source file simply
// bypasses the dependency rule. These in-memory fixtures exercise every
// high-leverage file/layer category without mutating the working tree.

import { ESLint } from 'eslint'
import { resolve } from 'node:path'

const cwd = process.cwd()
const eslint = new ESLint({ cwd })

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
]

async function boundaryMessages(control) {
  const [result] = await eslint.lintText(control.source, {
    filePath: resolve(cwd, control.file),
  })
  return result.messages.filter(
    ({ ruleId }) =>
      ruleId === 'boundaries/dependencies' || ruleId === 'boundaries/no-unknown-files',
  )
}

const failures = []
for (const control of controls) {
  const messages = await boundaryMessages(control)
  if (!messages.some(({ ruleId }) => ruleId === 'boundaries/dependencies')) {
    failures.push(`${control.name}: invalid import was accepted`)
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
