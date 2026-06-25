import type { KnowledgeGap } from "./graph-insights"

export interface AutoGraphResearchSelectionOptions {
  attemptedKeys?: Set<string>
  dismissedKeys?: Set<string>
  limit?: number
}

export function knowledgeGapAutoResearchKey(gap: KnowledgeGap): string {
  return `gap:${gap.type}:${gap.title}:${[...gap.nodeIds].sort().join(",")}`
}

export function selectAutoGraphResearchCandidates(
  gaps: KnowledgeGap[],
  options: AutoGraphResearchSelectionOptions = {},
): KnowledgeGap[] {
  const attemptedKeys = options.attemptedKeys ?? new Set()
  const dismissedKeys = options.dismissedKeys ?? new Set()
  const limit = options.limit ?? 1
  return gaps
    .filter((gap) => {
      const key = knowledgeGapAutoResearchKey(gap)
      return !attemptedKeys.has(key) && !dismissedKeys.has(key)
    })
    .slice(0, limit)
}
