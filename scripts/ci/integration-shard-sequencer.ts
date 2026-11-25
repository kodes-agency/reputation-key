// Vitest's sequencer with one change: a sharded run of the integration project
// splits its files by recorded duration (integration-shards.ts) instead of by a
// hash of their paths. Every other run, the unit and storybook shards among
// them, keeps Vitest's own split; the order inside a shard is Vitest's own too.

import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { BaseSequencer, type TestSpecification } from 'vitest/node'
import { shardOf } from './integration-shards'
import { DURATIONS_PATH } from './record-integration-durations'

export class IntegrationShardSequencer extends BaseSequencer {
  // fallow-ignore-next-line unused-class-member -- Vitest calls it through sequence.sequencer
  override async shard(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const { shard, root } = this.ctx.config
    if (
      !shard ||
      specs.length === 0 ||
      specs.some((spec) => spec.project.name !== 'integration')
    ) {
      return super.shard(specs)
    }
    const durations = JSON.parse(
      readFileSync(resolve(root, DURATIONS_PATH), 'utf8'),
    ) as Record<string, number>
    const byFile = new Map(
      specs.map((spec) => [relative(root, spec.moduleId).split(sep).join('/'), spec]),
    )
    return shardOf([...byFile.keys()], durations, shard.index, shard.count).map((file) =>
      byFile.get(file)!,
    )
  }
}
