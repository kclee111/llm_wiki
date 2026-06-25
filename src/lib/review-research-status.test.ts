import { describe, expect, it } from "vitest"
import { getReviewAutoResearchStatus } from "./review-research-status"
import type { ResearchTask } from "@/stores/research-store"

function task(patch: Partial<ResearchTask> = {}): ResearchTask {
  return {
    id: "research-1",
    topic: "alpha",
    reviewExpansion: false,
    triggerMetadata: {
      trigger: "auto-review",
      autoQueued: true,
      sourceReviewId: "review-1",
      sourceReviewTitle: "Review alpha",
    },
    status: "queued",
    webResults: [],
    synthesis: "",
    savedPath: null,
    error: null,
    createdAt: 1,
    ...patch,
  }
}

describe("getReviewAutoResearchStatus", () => {
  it("returns queued/running/saving/failed states for an auto research task linked to a review", () => {
    expect(getReviewAutoResearchStatus([task({ status: "queued" })], "review-1")?.state).toBe("queued")
    expect(getReviewAutoResearchStatus([task({ status: "searching" })], "review-1")?.state).toBe("running")
    expect(getReviewAutoResearchStatus([task({ status: "synthesizing" })], "review-1")?.state).toBe("running")
    expect(getReviewAutoResearchStatus([task({ status: "saving" })], "review-1")?.state).toBe("saving")
    expect(getReviewAutoResearchStatus([task({ status: "error" })], "review-1")?.state).toBe("failed")
  })

  it("ignores completed, manual, and unrelated research tasks", () => {
    expect(getReviewAutoResearchStatus([task({ status: "done" })], "review-1")).toBeNull()
    expect(getReviewAutoResearchStatus([
      task({
        triggerMetadata: {
          trigger: "manual-review",
          autoQueued: false,
          sourceReviewId: "review-1",
        },
      }),
    ], "review-1")).toBeNull()
    expect(getReviewAutoResearchStatus([task()], "review-2")).toBeNull()
  })

  it("uses the newest matching auto research task", () => {
    const status = getReviewAutoResearchStatus([
      task({ id: "old", status: "error", createdAt: 1 }),
      task({ id: "new", status: "searching", createdAt: 2 }),
    ], "review-1")

    expect(status?.task.id).toBe("new")
    expect(status?.state).toBe("running")
  })
})
