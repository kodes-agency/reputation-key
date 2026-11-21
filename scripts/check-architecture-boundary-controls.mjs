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
const QUEUE_CLIENT_RULE = '@typescript-eslint/no-restricted-imports'
const BOUNDARY_RULES = [
  'no-restricted-imports',
  QUEUE_CLIENT_RULE,
  'boundaries/dependencies',
  'boundaries/no-unknown-files',
  ...UNKNOWN_DEPENDENCY_RULES,
]

const controls = [
  {
    name: 'a feature server file that is not an adapter cannot import a port another area owns',
    file: 'src/contexts/guest/rights/boundary-negative-control.server.ts',
    source:
      "import '#/contexts/identity/application/ports/organization-export-contributor.port'\n",
  },
  {
    name: 'a feature adapter cannot import another area outside its ports',
    file: 'src/contexts/guest/rights/boundary-negative-control.adapter.server.ts',
    source: "import '#/contexts/identity/domain/errors'\n",
  },
  {
    name: "a feature contract cannot take a value from another area's public API",
    file: 'src/contexts/guest/page/boundary-negative-control.contracts.ts',
    source:
      "import { StoredObjectTooLargeError } from '#/contexts/portal/public-api'\nexport const control = StoredObjectTooLargeError\n",
  },
  // An area's public API is src/contexts/<area>/public-api.ts (Review and Inbox
  // keep application/public-api.ts until their server functions move).
  // It keeps the bans application/ had, and a feature file named like a public
  // API is not one.
  {
    name: "an area's root public API cannot import UI",
    file: 'src/contexts/feed/public-api.ts',
    source: "import '#/components/ui/button'\n",
  },
  {
    name: "an area's root public API cannot import another area's feature server",
    file: 'src/contexts/feed/public-api.ts',
    source: "import '#/contexts/reporting/portal-results/get-portal-analytics.server'\n",
  },
  {
    name: "an area's root public API cannot resolve the composition root",
    file: 'src/contexts/feed/public-api.ts',
    source: "import '#/composition'\n",
  },
  {
    name: "an area's root public API cannot import the outbox relay",
    file: 'src/contexts/feed/public-api.ts',
    source: "import '#/shared/outbox/relay'\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: "an area's root public API cannot construct queue transport",
    file: 'src/contexts/feed/public-api.ts',
    source: "import { Queue } from 'bullmq'\nexport const control = Queue\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: "a feature contract cannot take types from another area's application/ outside its public API",
    file: 'src/contexts/guest/page/boundary-negative-control.contracts.ts',
    source:
      "import type { aiRequestFingerprint } from '#/contexts/ai/application/ai-workflow-support'\nexport type Control = typeof aiRequestFingerprint\n",
  },
  {
    name: "a feature server cannot import another area's application/ outside its public API",
    file: 'src/contexts/guest/rights/boundary-negative-control.server.ts',
    source: "import '#/contexts/identity/application/staff-self-context'\n",
  },
  {
    name: "a domain cannot import another area's public API",
    file: 'src/contexts/guest/domain/boundary-negative-control.ts',
    source:
      "import type { PortalPublicApi } from '#/contexts/portal/public-api'\nexport type Control = PortalPublicApi\n",
  },
  {
    name: "shared code cannot import an area's public API",
    file: 'src/shared/boundary-negative-control.ts',
    source:
      "import type { PortalPublicApi } from '#/contexts/portal/public-api'\nexport type Control = PortalPublicApi\n",
  },
  {
    name: "a feature contract cannot take types from another area's feature file named like a public API",
    file: 'src/contexts/guest/page/boundary-negative-control.contracts.ts',
    source:
      "import type { createPortalGroupPublicApi } from '#/contexts/portal/groups/portal-group-public-api.server'\nexport type Control = typeof createPortalGroupPublicApi\n",
  },
  // The public API is the one file at an area's root another area may import;
  // the build seam beside it stays closed to feature code.
  {
    name: "a feature server cannot import another area's build seam at the area root",
    file: 'src/contexts/guest/rights/boundary-negative-control.server.ts',
    source: "import '#/contexts/portal/build'\n",
  },
  {
    name: "a feature screen cannot import another area's build seam at the area root",
    file: 'src/contexts/guest/page/ui/boundary-negative-control.tsx',
    source: "import '#/contexts/portal/build'\n",
  },
  {
    name: 'ordinary test helpers cannot import Feed infrastructure',
    file: 'src/shared/testing/boundary-negative-control.ts',
    source:
      "import '#/contexts/feed/infrastructure/notification-consumer-test-fixtures'\n",
  },
  {
    name: 'notification route harness cannot import another context infrastructure',
    file: 'src/shared/testing/notification-route-test-harness.ts',
    source:
      "import '#/contexts/identity/infrastructure/beta-feedback-triage.repository'\n",
  },
  {
    name: 'Feed infrastructure cannot import the test route harness',
    file: 'src/contexts/feed/infrastructure/boundary-negative-control.ts',
    source: "import '#/shared/testing/notification-route-test-harness'\n",
  },
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
    name: 'Portal results UI cannot import its reporting read',
    file: 'src/contexts/reporting/portal-results/ui/portal-analytics-tab.tsx',
    source: "import '../get-portal-analytics.server'\n",
  },
  {
    name: 'Portal results UI cannot import its repository',
    file: 'src/contexts/reporting/portal-results/ui/portal-analytics-tab.tsx',
    source: "import '../portal-analytics.repository.server'\n",
  },
  {
    name: 'Portal results contract cannot import database runtime',
    file: 'src/contexts/reporting/portal-results/contracts.ts',
    source: "import '#/shared/db'\n",
  },
  {
    name: 'Portal results UI cannot import Drizzle',
    file: 'src/contexts/reporting/portal-results/ui/portal-analytics-tab.tsx',
    source: "import { sql } from 'drizzle-orm'\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'Portal results read cannot import Drizzle',
    file: 'src/contexts/reporting/portal-results/get-portal-analytics.server.ts',
    source: "import { sql } from 'drizzle-orm'\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'Portal results read cannot construct queue transport',
    file: 'src/contexts/reporting/portal-results/get-portal-analytics.server.ts',
    source: "import { Queue } from 'bullmq'\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'Portal results storage cannot import React hooks',
    file: 'src/contexts/reporting/portal-results/portal-analytics.repository.server.ts',
    source: "import { useState } from 'react'\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'feature server read cannot import React',
    file: 'src/contexts/reporting/portal-results/get-portal-analytics.server.ts',
    source: "import React from 'react'\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'another context cannot import a feature server implementation',
    file: 'src/contexts/review/application/boundary-negative-control.ts',
    source: "import '#/contexts/reporting/portal-results/get-portal-analytics.server'\n",
  },
  {
    name: 'feature contract cannot import its neighboring server implementation',
    file: 'src/contexts/reporting/portal-results/contracts.ts',
    source: "import './get-portal-analytics.server'\n",
  },
  {
    name: 'feature contract cannot import application runtime',
    file: 'src/contexts/reporting/portal-results/contracts.ts',
    source: "import '../application/goal-results-matrix'\n",
  },
  {
    name: 'new feature UI cannot import a server implementation',
    file: 'src/contexts/reporting/boundary-control/ui/read.tsx',
    source: "import '../../portal-results/get-portal-analytics.server'\n",
  },
  {
    name: 'feature server cannot import the outbox relay',
    file: 'src/contexts/reporting/portal-results/portal-analytics.repository.server.ts',
    source: "import '#/shared/outbox/relay'\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'feature server cannot import outbox infrastructure',
    file: 'src/contexts/reporting/portal-results/portal-analytics.repository.server.ts',
    source: "import '#/shared/outbox/infrastructure/outbox-repository'\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'feature server cannot import another area’s feature server',
    file: 'src/contexts/portal/boundary-control/read.server.ts',
    source:
      "import '#/contexts/reporting/portal-results/portal-analytics.repository.server'\n",
  },
  {
    name: 'a route cannot import a feature server implementation',
    file: 'src/routes/boundary-negative-control.ts',
    source:
      "import '#/contexts/reporting/portal-results/portal-analytics.repository.server'\n",
  },
  {
    name: 'new feature server cannot import React',
    file: 'src/contexts/portal/boundary-control/read.server.ts',
    source: "import React from 'react'\n",
    expect: ['no-restricted-imports'],
  },
  ...['domain', 'application', 'infrastructure', 'server'].map((layer) => ({
    name: `nested UI in ${layer} keeps its layer boundary`,
    file: `src/contexts/reporting/${layer}/boundary-control/ui/read.tsx`,
    source: "import '#/components/ui/button'\n",
  })),
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
    file: 'src/shared/format/boundary-negative-control.ts',
    source: "import '#/contexts/review/server/reply'\n",
  },
  // ARC-03-T1: scripts/ is a mandated control category. Operator commands
  // are admin entry points, not browsers — a context's server layer is an
  // inbound HTTP adapter and is off limits to every script.
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
    source:
      "import '../../src/contexts/identity/infrastructure/beta-feedback-triage.repository'\n",
  },
  {
    name: 'CI script cannot resolve the composition root',
    file: 'scripts/ci/boundary-negative-control.ts',
    source: "import '../../src/composition'\n",
  },
  // ARC-03-T3: shared/ is no longer one mutually self-importing bucket. The
  // browser-reachable query namespace and the server-only job runtime are
  // different elements with different owners.
  {
    name: 'shared query namespace cannot import the job runtime',
    file: 'src/shared/queries/boundary-negative-control.ts',
    source: "import '#/shared/jobs/queue'\n",
  },
  // ARC-03-T16: only the operator harness may construct the refusing operator
  // graph. A second entry point with that authority could create another
  // Application Container and expose maintenance capabilities.
  {
    name: 'start entry cannot import the operator container builder',
    file: 'src/start.ts',
    source: "import '#/composition/operator-container'\n",
  },
  {
    name: 'route cannot import the operator container builder',
    file: 'src/routes/boundary-negative-control.ts',
    source: "import '#/composition/operator-container'\n",
  },
  // The api-route category IS allowed to resolve the composition root, so this
  // control proves the operator-builder fence does its own work rather than
  // riding on the composition-root ban.
  {
    name: 'API route cannot import the operator container builder',
    file: 'src/routes/api/boundary-negative-control.ts',
    source: "import '#/composition/operator-container'\n",
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
  // Queue and Redis clients are built in shared/jobs and the composition root;
  // area code names their types only.
  {
    name: 'a feature job cannot build a queue',
    file: 'src/contexts/reputation/sync/boundary-negative-control-job.server.ts',
    source: "import { Queue } from 'bullmq'\nexport const control = Queue\n",
    expect: [QUEUE_CLIENT_RULE],
  },
  {
    name: 'a feature adapter cannot open its own Redis connection',
    file: 'src/contexts/ai/execution/boundary-negative-control.adapter.server.ts',
    source: "import Redis from 'ioredis'\nexport const control = Redis\n",
    expect: [QUEUE_CLIENT_RULE],
  },
  {
    name: 'a feature rule file cannot import a queue package',
    file: 'src/contexts/reporting/rating-goals/boundary-negative-control.ts',
    source: "import { Worker } from 'bullmq'\nexport const control = Worker\n",
    expect: [QUEUE_CLIENT_RULE],
  },
  {
    name: "an area's build cannot build a queue",
    file: 'src/contexts/feed/build.ts',
    source: "import { Queue } from 'bullmq'\nexport const control = Queue\n",
    expect: [QUEUE_CLIENT_RULE],
  },
  {
    name: 'an infrastructure adapter cannot open its own Redis connection',
    file: 'src/contexts/ai/infrastructure/boundary-negative-control.ts',
    source: "import { Redis } from 'ioredis'\nexport const control = Redis\n",
    expect: [QUEUE_CLIENT_RULE],
  },
]

const allowedControls = [
  {
    name: 'a feature job may name the queue Job type',
    file: 'src/contexts/reputation/sync/boundary-positive-control-job.server.ts',
    source: "import type { Job } from 'bullmq'\nexport type Control = Job\n",
  },
  {
    name: 'a feature adapter may name the Redis type',
    file: 'src/contexts/ai/execution/boundary-positive-control.adapter.server.ts',
    source: "import type { Redis } from 'ioredis'\nexport type Control = Redis\n",
  },
  {
    name: 'a feature integration test may build a real queue',
    file: 'src/contexts/ai/replay/boundary-positive-control.integration.test.ts',
    source: "import { Queue } from 'bullmq'\nexport const control = Queue\n",
  },
  {
    name: 'a feature adapter may import the port another area owns that it implements',
    file: 'src/contexts/guest/rights/boundary-positive-control.adapter.server.ts',
    source:
      "import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'\nexport type Control = OrganizationExportContributor\n",
  },
  {
    name: "a feature contract may take types from another area's public API",
    file: 'src/contexts/guest/page/boundary-positive-control.contracts.ts',
    source:
      "import type { PublicPortalResult } from '#/contexts/portal/public-api'\nexport type Control = PublicPortalResult\n",
  },
  {
    name: "an area's root public API may name its own domain types",
    file: 'src/contexts/feed/public-api.ts',
    source:
      "import type { NotificationType } from './domain/notification-types'\nexport type { NotificationType }\n",
  },
  {
    name: "an area's root public API may wrap its own feature server code",
    file: 'src/contexts/feed/public-api.ts',
    source:
      "import { queryAuditEvents } from './audit/read.server'\nexport const control = queryAuditEvents\n",
  },
  {
    name: "an area's root public API may take another area's public API",
    file: 'src/contexts/feed/public-api.ts',
    source:
      "import type { PropertyPublicApi } from '#/contexts/property/public-api'\nexport type Control = PropertyPublicApi\n",
  },
  // Review and Inbox keep application/public-api.ts until their server functions move, so these
  // controls keep the old path covered.
  {
    name: "a feature screen may import Review's application public API",
    file: 'src/contexts/guest/page/ui/boundary-positive-control.tsx',
    source: "import '#/contexts/review/application/public-api'\n",
  },
  {
    name: "a feature server may import Review's application public API",
    file: 'src/contexts/guest/rights/boundary-positive-control.server.ts',
    source: "import '#/contexts/review/application/public-api'\n",
  },
  {
    name: "a route may import Inbox's application public API",
    file: 'src/routes/boundary-positive-control.ts',
    source: "import '#/contexts/inbox/application/public-api'\n",
  },
  {
    name: "an operator script may import Review's application public API",
    file: 'scripts/ops/boundary-positive-control.ts',
    source: "import '../../src/contexts/review/application/public-api'\n",
  },
  // Once an area has moved, its public API is the root file; the same seams
  // must be open for it.
  {
    name: "a feature screen may import another area's public API",
    file: 'src/contexts/guest/page/ui/boundary-positive-control.tsx',
    source: "import '#/contexts/portal/public-api'\n",
  },
  {
    name: "a feature server may import another area's public API",
    file: 'src/contexts/guest/rights/boundary-positive-control.server.ts',
    source: "import '#/contexts/portal/public-api'\n",
  },
  {
    name: "a route may import an area's public API",
    file: 'src/routes/boundary-positive-control.ts',
    source: "import '#/contexts/property/public-api'\n",
  },
  {
    name: "an operator script may import an area's public API",
    file: 'scripts/ops/boundary-positive-control.ts',
    source: "import '../../src/contexts/feed/public-api'\n",
  },
  {
    name: "a feature contract may take types from Review's application public API until its server functions move",
    file: 'src/contexts/guest/page/boundary-positive-control.contracts.ts',
    source:
      "import type { Review } from '#/contexts/review/application/public-api'\nexport type Control = Review\n",
  },
  {
    name: 'route may import a feature browser contract',
    file: 'src/routes/boundary-positive-control.ts',
    source: "import '#/contexts/reporting/portal-results/contracts'\n",
  },
  {
    name: 'feature server implementation may import its own repository',
    file: 'src/contexts/reporting/portal-results/get-portal-analytics.server.ts',
    source: "import './portal-analytics.repository.server'\n",
  },
  {
    name: 'notification route harness may register Feed consumers',
    file: 'src/shared/testing/notification-route-test-harness.ts',
    source:
      "import '#/contexts/feed/infrastructure/notification-consumer-test-fixtures'\n",
  },
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
    source: "import '#/shared/class-names/utils'\n",
  },
  {
    name: 'Portal results UI may import its browser contract and UI primitives',
    file: 'src/contexts/reporting/portal-results/ui/portal-analytics-tab.tsx',
    source: "import '../contracts'\nimport '#/components/ui/button'\n",
  },
  {
    name: 'Portal results stories may render the goal line',
    file: 'src/contexts/reporting/portal-results/ui/portal-analytics-tab.stories.tsx',
    source:
      "import '#/contexts/reporting/monthly-goals/ui/portal-goal-results-line'\nimport '#/contexts/reporting/monthly-goals/contracts'\n",
  },
  {
    name: 'Reporting build may assemble Portal results read and storage',
    file: 'src/contexts/reporting/build.ts',
    source:
      "import './portal-results/get-portal-analytics.server'\nimport './portal-results/portal-analytics.repository.server'\n",
  },
  {
    name: 'Reporting repositories may share Portal results SQL helpers',
    file: 'src/contexts/reporting/portal-results/portal-last-scans.server.ts',
    source: "import './portal-analytics-shared.server'\n",
  },
  {
    name: 'a feature server may use another feature’s server code in its area',
    file: 'src/contexts/reporting/rating-goals/boundary-positive-control.server.ts',
    source: "import '../portal-results/portal-analytics.repository.server'\n",
  },
  {
    name: 'the worker may import a feature server implementation',
    file: 'src/worker/boundary-positive-control.ts',
    source:
      "import '#/contexts/reporting/portal-results/portal-analytics.repository.server'\n",
  },
  {
    name: 'composition may import a feature server implementation',
    file: 'src/composition/boundary-positive-control.ts',
    source:
      "import '#/contexts/reporting/portal-results/portal-analytics.repository.server'\n",
  },
  {
    name: 'a named contract file is a feature contract',
    file: 'src/contexts/reporting/portal-results/analytics.contracts.ts',
    source: "import '#/shared/domain/ids'\n",
  },
  {
    name: 'Portal results storage may use Drizzle',
    file: 'src/contexts/reporting/portal-results/portal-analytics.repository.server.ts',
    source: "import { sql } from 'drizzle-orm'\n",
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
  // ARC-03-T3: the same edge from the area that owns queue-depth readiness is
  // documented and must stay open — the split is a placement rule, not a ban.
  {
    name: 'shared health may import the job runtime',
    file: 'src/shared/health/boundary-positive-control.ts',
    source: "import '#/shared/jobs/queue'\n",
  },
  // ARC-03-T16: scripts/ops is the only category allowed to build this graph.
  {
    name: 'operator script may import the operator container builder',
    file: 'scripts/ops/boundary-positive-control.ts',
    source: "import '../../src/composition/operator-container'\n",
  },
  {
    name: 'story file may import the Storybook harness',
    file: 'src/components/boundary-positive-control.stories.tsx',
    source: "import '../../.storybook/AuthedRouterDecorator'\n",
  },
]

// Moving the public APIs retired ports/, queries/ and ui/ at an area's root: no element
// claims them, so a file there is unclassified and fails the lint.
const retiredFolderControls = ['ports', 'queries', 'ui'].map((folder) => ({
  name: `${folder}/ at an area's root is retired`,
  file: `src/contexts/reporting/${folder}/boundary-negative-control.ts`,
  source: 'export {}\n',
}))

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

for (const control of retiredFolderControls) {
  const messages = await boundaryMessages(control)
  if (!messages.some(({ ruleId }) => ruleId === 'boundaries/no-unknown-files')) {
    failures.push(`${control.name}: a file there was classified`)
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
  `[architecture-boundaries] OK — ${controls.length} invalid imports rejected; ${allowedControls.length} valid seams accepted; ${retiredFolderControls.length} retired folders refused.`,
)
