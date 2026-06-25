import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewItem } from "@/stores/review-store"
import { useResearchStore } from "@/stores/research-store"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import {
  resetAutoDeepResearchForTests,
  runAutoDeepResearchForReviews,
  selectAutoDeepResearchCandidates,
  setupAutoDeepResearch,
} from "./auto-deep-research"

vi.mock("./deep-research", () => ({
  queueResearch: vi.fn(),
}))

import { queueResearch } from "./deep-research"

function review(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "review-1",
    type: "suggestion",
    title: "Research alpha",
    description: "Research alpha details",
    searchQueries: ["alpha query"],
    options: [],
    resolved: false,
    createdAt: 0,
    ...overrides,
  }
}

beforeEach(() => {
  resetAutoDeepResearchForTests()
  vi.mocked(queueResearch).mockReset()
  useReviewStore.setState({ items: [] })
  useResearchStore.setState({
    tasks: [],
    panelOpen: false,
    reviewExpansionEnabled: false,
    autoDeepResearchEnabled: false,
  })
  useWikiStore.getState().setProject({
    id: "project-id",
    name: "Project",
    path: "/project",
  })
  useWikiStore.setState({
    llmConfig: {
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4",
      ollamaUrl: "",
      customEndpoint: "",
      maxContextSize: 128000,
    },
    searchApiConfig: {
      provider: "tavily",
      apiKey: "tvly",
      deepResearchSource: "web",
    },
  })
})

afterEach(() => {
  resetAutoDeepResearchForTests()
})

describe("selectAutoDeepResearchCandidates", () => {
  it("selects unresolved suggestion and missing-page reviews with search queries", () => {
    const selected = selectAutoDeepResearchCandidates([
      review({ id: "suggestion", type: "suggestion" }),
      review({ id: "missing", type: "missing-page" }),
      review({ id: "confirm", type: "confirm" }),
      review({ id: "resolved", resolved: true }),
      review({ id: "no-query", searchQueries: [] }),
    ])

    expect(selected.map((item) => item.id)).toEqual(["suggestion", "missing"])
  })

  it("skips items that were already attempted", () => {
    const selected = selectAutoDeepResearchCandidates(
      [review({ id: "review-1" }), review({ id: "review-2" })],
      new Set(["review-1"]),
    )

    expect(selected.map((item) => item.id)).toEqual(["review-2"])
  })
})

describe("runAutoDeepResearchForReviews", () => {
  it("queues selected reviews and resolves them as automatically queued", () => {
    const items = [review({ id: "review-1" })]
    useReviewStore.getState().setItems(items)
    useResearchStore.getState().setAutoDeepResearchEnabled(true)

    runAutoDeepResearchForReviews(items)

    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "alpha",
      expect.objectContaining({ model: "gpt-4" }),
      expect.objectContaining({ provider: "tavily" }),
      ["alpha query"],
    )
    expect(useReviewStore.getState().items[0]).toMatchObject({
      resolved: true,
      resolvedAction: "Auto queued for deep research",
    })
  })

  it("does nothing when auto Deep Research is disabled", () => {
    const items = [review({ id: "review-1" })]
    useReviewStore.getState().setItems(items)

    runAutoDeepResearchForReviews(items)

    expect(queueResearch).not.toHaveBeenCalled()
    expect(useReviewStore.getState().items[0].resolved).toBe(false)
  })

  it("queues at most one review from a batch and marks the rest attempted", () => {
    const attempted = new Set<string>()
    const items = [
      review({ id: "review-1", title: "Research alpha", searchQueries: ["alpha query"] }),
      review({ id: "review-2", title: "Research beta", searchQueries: ["beta query"] }),
    ]
    useReviewStore.getState().setItems(items)
    useResearchStore.getState().setAutoDeepResearchEnabled(true)

    expect(runAutoDeepResearchForReviews(items, attempted)).toBe(1)
    expect(runAutoDeepResearchForReviews(items, attempted)).toBe(0)

    expect(queueResearch).toHaveBeenCalledTimes(1)
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "alpha",
      expect.any(Object),
      expect.any(Object),
      ["alpha query"],
    )
  })
})

describe("setupAutoDeepResearch", () => {
  it("does not backfill existing review items when auto Deep Research is enabled", () => {
    useReviewStore.getState().setItems([
      review({ id: "old-1", title: "Research old", searchQueries: ["old query"] }),
    ])
    setupAutoDeepResearch()

    useResearchStore.getState().setAutoDeepResearchEnabled(true)

    expect(queueResearch).not.toHaveBeenCalled()
    expect(useReviewStore.getState().items[0].resolved).toBe(false)
  })

  it("queues new eligible review items when auto Deep Research is enabled", () => {
    setupAutoDeepResearch()
    useResearchStore.getState().setAutoDeepResearchEnabled(true)

    useReviewStore.getState().addItems([
      {
        type: "suggestion",
        title: "Research beta",
        description: "Research beta details",
        searchQueries: ["beta query"],
        options: [],
      },
    ])

    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "beta",
      expect.objectContaining({ model: "gpt-4" }),
      expect.objectContaining({ provider: "tavily" }),
      ["beta query"],
    )
    expect(useReviewStore.getState().items[0]).toMatchObject({
      resolved: true,
      resolvedAction: "Auto queued for deep research",
    })
  })
})
