import type { KnowledgeGap } from "./graph-insights"

export const DEFAULT_AUTO_GRAPH_RESEARCH_LIMIT = 10
const MIN_AUTO_GRAPH_RESEARCH_LIMIT = 1
const MAX_AUTO_GRAPH_RESEARCH_LIMIT = 100

export interface AutoGraphResearchSelectionOptions {
  attemptedKeys?: Set<string>
  dismissedKeys?: Set<string>
  limit?: number
  remainingBudget?: number
}

export function clampAutoGraphResearchLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUTO_GRAPH_RESEARCH_LIMIT
  return Math.min(
    MAX_AUTO_GRAPH_RESEARCH_LIMIT,
    Math.max(MIN_AUTO_GRAPH_RESEARCH_LIMIT, Math.floor(value)),
  )
}

export function getAutoGraphResearchBatchLimit(
  maxConcurrent: number,
  runningCount: number,
  remainingBudget: number,
): number {
  const availableSlots = Math.max(0, Math.floor(maxConcurrent) - Math.max(0, Math.floor(runningCount)))
  const budget = Math.max(0, Math.floor(remainingBudget))
  return Math.min(availableSlots, budget)
}

export function advanceAutoGraphResearchQueuedCount(
  currentCount: number,
  queuedCount: number,
): number {
  return Math.max(0, Math.floor(currentCount)) + Math.max(0, Math.floor(queuedCount))
}

export function releaseAutoGraphResearchAttemptedKeys(
  attemptedKeys: Set<string>,
  keys: Iterable<string>,
): void {
  for (const key of keys) {
    attemptedKeys.delete(key)
  }
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
  if (options.remainingBudget !== undefined && options.remainingBudget <= 0) {
    return []
  }
  const effectiveLimit = options.remainingBudget === undefined
    ? limit
    : Math.min(limit, Math.floor(options.remainingBudget))
  return gaps
    .filter((gap) => {
      const key = knowledgeGapAutoResearchKey(gap)
      return !attemptedKeys.has(key) && !dismissedKeys.has(key)
    })
    .slice(0, effectiveLimit)
}
