import { describe, expect, it } from "vitest"
import type { KnowledgeGap } from "./graph-insights"
import {
  knowledgeGapAutoResearchKey,
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
})
