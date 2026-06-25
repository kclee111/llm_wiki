import { describe, expect, it } from "vitest"
import type { KnowledgeGap } from "./graph-insights"
import {
  DEFAULT_AUTO_GRAPH_RESEARCH_LIMIT,
  advanceAutoGraphResearchQueuedCount,
  clampAutoGraphResearchLimit,
  getAutoGraphResearchBatchLimit,
  knowledgeGapAutoResearchKey,
  releaseAutoGraphResearchAttemptedKeys,
  selectAutoGraphResearchCandidates,
} from "./auto-graph-research"

function gap(overrides: Partial<KnowledgeGap> = {}): KnowledgeGap {
  return {
    type: "isolated-node",
    title: "Isolated pages",
    description: "alpha, beta",
    nodeIds: ["b", "a"],
    suggestion: "Research this gap.",
    ...overrides,
  }
}

describe("knowledgeGapAutoResearchKey", () => {
  it("is stable across node id order", () => {
    expect(knowledgeGapAutoResearchKey(gap({ nodeIds: ["b", "a"] }))).toBe(
      knowledgeGapAutoResearchKey(gap({ nodeIds: ["a", "b"] })),
    )
  })
})

describe("selectAutoGraphResearchCandidates", () => {
  it("selects the first non-dismissed and non-attempted knowledge gap", () => {
    const first = gap({ title: "First", nodeIds: ["1"] })
    const second = gap({ title: "Second", nodeIds: ["2"] })
    const selected = selectAutoGraphResearchCandidates([first, second], {
      attemptedKeys: new Set([knowledgeGapAutoResearchKey(first)]),
      dismissedKeys: new Set(),
      limit: 1,
    })

    expect(selected).toEqual([second])
  })

  it("limits auto graph research to one gap by default", () => {
    const selected = selectAutoGraphResearchCandidates([
      gap({ title: "First", nodeIds: ["1"] }),
      gap({ title: "Second", nodeIds: ["2"] }),
    ])

    expect(selected).toHaveLength(1)
    expect(selected[0].title).toBe("First")
  })

  it("skips dismissed graph insights", () => {
    const item = gap({ title: "Dismissed", nodeIds: ["1"] })

    expect(selectAutoGraphResearchCandidates([item], {
      dismissedKeys: new Set([knowledgeGapAutoResearchKey(item)]),
    })).toEqual([])
  })

  it("does not select a graph insight when the auto research budget is exhausted", () => {
    expect(selectAutoGraphResearchCandidates([gap()], {
      remainingBudget: 0,
    })).toEqual([])
  })

  it("caps selected graph insights to the remaining auto research budget", () => {
    const selected = selectAutoGraphResearchCandidates([
      gap({ title: "First", nodeIds: ["1"] }),
      gap({ title: "Second", nodeIds: ["2"] }),
      gap({ title: "Third", nodeIds: ["3"] }),
    ], {
      limit: 3,
      remainingBudget: 2,
    })

    expect(selected.map((item) => item.title)).toEqual(["First", "Second"])
  })
})

describe("clampAutoGraphResearchLimit", () => {
  it("defaults max graph insight auto research to 10", () => {
    expect(DEFAULT_AUTO_GRAPH_RESEARCH_LIMIT).toBe(10)
  })

  it("keeps the max graph insight auto research setting in a bounded integer range", () => {
    expect(clampAutoGraphResearchLimit(0)).toBe(1)
    expect(clampAutoGraphResearchLimit(10.8)).toBe(10)
    expect(clampAutoGraphResearchLimit(500)).toBe(100)
    expect(clampAutoGraphResearchLimit(Number.NaN)).toBe(DEFAULT_AUTO_GRAPH_RESEARCH_LIMIT)
  })
})

describe("getAutoGraphResearchBatchLimit", () => {
  it("uses available research slots and remaining graph insight budget", () => {
    expect(getAutoGraphResearchBatchLimit(3, 0, 10)).toBe(3)
    expect(getAutoGraphResearchBatchLimit(3, 2, 10)).toBe(1)
    expect(getAutoGraphResearchBatchLimit(3, 0, 2)).toBe(2)
  })

  it("does not allow graph insight auto research when no slot or budget remains", () => {
    expect(getAutoGraphResearchBatchLimit(3, 3, 10)).toBe(0)
    expect(getAutoGraphResearchBatchLimit(3, 0, 0)).toBe(0)
  })
})

describe("advanceAutoGraphResearchQueuedCount", () => {
  it("counts only graph insights that were actually queued", () => {
    expect(advanceAutoGraphResearchQueuedCount(2, 3)).toBe(5)
    expect(advanceAutoGraphResearchQueuedCount(2, 0)).toBe(2)
  })
})

describe("releaseAutoGraphResearchAttemptedKeys", () => {
  it("allows unqueued graph insights to become eligible again after cancellation", () => {
    const attempted = new Set(["queued", "cancelled"])

    releaseAutoGraphResearchAttemptedKeys(attempted, ["cancelled"])

    expect([...attempted]).toEqual(["queued"])
  })
})
