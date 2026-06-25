import type { ResearchTask } from "@/stores/research-store"

export type ReviewAutoResearchState = "queued" | "running" | "saving" | "failed"

export interface ReviewAutoResearchStatus {
  task: ResearchTask
  state: ReviewAutoResearchState
}

export function getReviewAutoResearchStatus(
  tasks: ResearchTask[],
  reviewId: string,
): ReviewAutoResearchStatus | null {
  const task = tasks
    .filter((candidate) =>
      candidate.triggerMetadata?.trigger === "auto-review" &&
      candidate.triggerMetadata.sourceReviewId === reviewId &&
      candidate.status !== "done"
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  if (!task) return null
  if (task.status === "queued") return { task, state: "queued" }
  if (task.status === "saving") return { task, state: "saving" }
  if (task.status === "error") return { task, state: "failed" }
  return { task, state: "running" }
}
