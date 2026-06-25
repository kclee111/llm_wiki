import { queueResearch } from "@/lib/deep-research"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { normalizePath } from "@/lib/path-utils"
import { hasConfiguredDeepResearchSources } from "@/lib/web-search"
import { useResearchStore } from "@/stores/research-store"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"

const AUTO_RESOLVED_ACTION = "Auto queued for deep research"

let unsubscribeReview: (() => void) | null = null
let unsubscribeResearch: (() => void) | null = null
let unsubscribeProject: (() => void) | null = null
const attemptedReviewIds = new Set<string>()

export function selectAutoDeepResearchCandidates(
  items: ReviewItem[],
  attemptedIds: Set<string> = new Set(),
): ReviewItem[] {
  return items.filter((item) =>
    !item.resolved &&
    !attemptedIds.has(item.id) &&
    (item.type === "suggestion" || item.type === "missing-page") &&
    (item.searchQueries?.some((query) => query.trim().length > 0) ?? false)
  )
}

function topicForReview(item: ReviewItem): string {
  return (
    item.title.replace(/^(Save to Wiki|Create|Research)[:\s]*/i, "").trim() ||
    item.description.split("\n")[0]?.trim() ||
    item.title
  )
}

export function runAutoDeepResearchForReviews(
  items: ReviewItem[],
  attemptedIds: Set<string> = attemptedReviewIds,
): number {
  const researchStore = useResearchStore.getState()
  if (!researchStore.autoDeepResearchEnabled) return 0

  const wikiStore = useWikiStore.getState()
  if (!wikiStore.project) return 0
  if (!hasUsableLlm(wikiStore.llmConfig)) return 0
  if (!hasConfiguredDeepResearchSources(wikiStore.searchApiConfig)) return 0

  let queued = 0
  for (const item of selectAutoDeepResearchCandidates(items, attemptedIds)) {
    attemptedIds.add(item.id)
    queueResearch(
      normalizePath(wikiStore.project.path),
      topicForReview(item),
      wikiStore.llmConfig,
      wikiStore.searchApiConfig,
      item.searchQueries,
    )
    useReviewStore.getState().resolveItem(item.id, AUTO_RESOLVED_ACTION)
    queued++
  }
  return queued
}

export function setupAutoDeepResearch(): void {
  if (unsubscribeReview) return

  unsubscribeReview = useReviewStore.subscribe((state) => {
    runAutoDeepResearchForReviews(state.items)
  })

  unsubscribeResearch = useResearchStore.subscribe((state, prevState) => {
    if (!prevState.autoDeepResearchEnabled && state.autoDeepResearchEnabled) {
      runAutoDeepResearchForReviews(useReviewStore.getState().items)
    }
  })

  unsubscribeProject = useWikiStore.subscribe((state, prevState) => {
    if (state.project?.id !== prevState.project?.id) {
      attemptedReviewIds.clear()
    }
  })
}

export function resetAutoDeepResearchForTests(): void {
  unsubscribeReview?.()
  unsubscribeResearch?.()
  unsubscribeProject?.()
  unsubscribeReview = null
  unsubscribeResearch = null
  unsubscribeProject = null
  attemptedReviewIds.clear()
}
