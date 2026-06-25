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
  it("queues selected reviews without resolving the original review item", () => {
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
      {
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "review-1",
        sourceReviewTitle: "Research alpha",
      },
    )
    expect(useReviewStore.getState().items[0]).toMatchObject({
      resolved: false,
    })
    expect(useReviewStore.getState().items[0]).not.toHaveProperty("resolvedAction")
  })

  it("does nothing when auto Deep Research is disabled", () => {
    const items = [review({ id: "review-1" })]
    useReviewStore.getState().setItems(items)

    runAutoDeepResearchForReviews(items)

    expect(queueResearch).not.toHaveBeenCalled()
    expect(useReviewStore.getState().items[0].resolved).toBe(false)
  })

  it("queues unresolved reviews up to the available research slots", () => {
    const attempted = new Set<string>()
    const items = [
      review({ id: "review-1", title: "Research alpha", searchQueries: ["alpha query"] }),
      review({ id: "review-2", title: "Research beta", searchQueries: ["beta query"] }),
      review({ id: "review-3", title: "Research gamma", searchQueries: ["gamma query"] }),
      review({ id: "review-4", title: "Research delta", searchQueries: ["delta query"] }),
    ]
    useReviewStore.getState().setItems(items)
    useResearchStore.getState().setAutoDeepResearchEnabled(true)

    expect(runAutoDeepResearchForReviews(items, attempted)).toBe(3)
    expect(runAutoDeepResearchForReviews(items, attempted)).toBe(1)

    expect(queueResearch).toHaveBeenCalledTimes(4)
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "alpha",
      expect.any(Object),
      expect.any(Object),
      ["alpha query"],
      expect.objectContaining({
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "review-1",
      }),
    )
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "beta",
      expect.any(Object),
      expect.any(Object),
      ["beta query"],
      expect.objectContaining({
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "review-2",
      }),
    )
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "gamma",
      expect.any(Object),
      expect.any(Object),
      ["gamma query"],
      expect.objectContaining({
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "review-3",
      }),
    )
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "delta",
      expect.any(Object),
      expect.any(Object),
      ["delta query"],
      expect.objectContaining({
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "review-4",
      }),
    )
  })

  it("fills only the remaining research slots when other research tasks are active", () => {
    const items = [
      review({ id: "review-1", title: "Research alpha", searchQueries: ["alpha query"] }),
      review({ id: "review-2", title: "Research beta", searchQueries: ["beta query"] }),
      review({ id: "review-3", title: "Research gamma", searchQueries: ["gamma query"] }),
    ]
    useReviewStore.getState().setItems(items)
    useResearchStore.setState({
      autoDeepResearchEnabled: true,
      tasks: [
        {
          id: "research-1",
          topic: "alpha",
          searchQueries: ["alpha query"],
          reviewExpansion: false,
          triggerMetadata: { trigger: "auto-review", autoQueued: true, sourceReviewId: "review-1" },
          status: "searching",
          webResults: [],
          synthesis: "",
          savedPath: null,
          error: null,
          createdAt: 0,
        },
        {
          id: "research-2",
          topic: "other",
          reviewExpansion: false,
          triggerMetadata: { trigger: "research-panel", autoQueued: false },
          status: "synthesizing",
          webResults: [],
          synthesis: "",
          savedPath: null,
          error: null,
          createdAt: 0,
        },
      ],
    })

    expect(runAutoDeepResearchForReviews(items, new Set(["review-1"]))).toBe(1)

    expect(queueResearch).toHaveBeenCalledTimes(1)
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "beta",
      expect.any(Object),
      expect.any(Object),
      ["beta query"],
      expect.objectContaining({
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "review-2",
      }),
    )
  })
})

describe("setupAutoDeepResearch", () => {
  it("queues existing unresolved review items up to max concurrency when auto Deep Research is enabled", () => {
    useReviewStore.getState().setItems([
      review({ id: "old-1", title: "Research old", searchQueries: ["old query"] }),
      review({ id: "old-2", title: "Research older", searchQueries: ["older query"] }),
      review({ id: "old-3", title: "Research oldest", searchQueries: ["oldest query"] }),
      review({ id: "old-4", title: "Research skipped", searchQueries: ["skipped query"] }),
    ])
    setupAutoDeepResearch()

    useResearchStore.getState().setAutoDeepResearchEnabled(true)

    expect(queueResearch).toHaveBeenCalledTimes(3)
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "old",
      expect.objectContaining({ model: "gpt-4" }),
      expect.objectContaining({ provider: "tavily" }),
      ["old query"],
      expect.objectContaining({
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "old-1",
      }),
    )
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "older",
      expect.objectContaining({ model: "gpt-4" }),
      expect.objectContaining({ provider: "tavily" }),
      ["older query"],
      expect.objectContaining({
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "old-2",
      }),
    )
    expect(queueResearch).toHaveBeenCalledWith(
      "/project",
      "oldest",
      expect.objectContaining({ model: "gpt-4" }),
      expect.objectContaining({ provider: "tavily" }),
      ["oldest query"],
      expect.objectContaining({
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: "old-3",
      }),
    )
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
      {
        trigger: "auto-review",
        autoQueued: true,
        sourceReviewId: expect.any(String),
        sourceReviewTitle: "Research beta",
      },
    )
    expect(useReviewStore.getState().items[0]).toMatchObject({
      resolved: false,
    })
    expect(useReviewStore.getState().items[0]).not.toHaveProperty("resolvedAction")
  })
})
