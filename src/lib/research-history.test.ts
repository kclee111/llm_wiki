import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock("@/commands/fs", () => fsMocks)

import {
  appendResearchHistory,
  updateResearchHistory,
  appendResearchLogSummary,
  type ResearchHistoryEntry,
} from "./research-history"

beforeEach(() => {
  fsMocks.createDirectory.mockReset()
  fsMocks.createDirectory.mockResolvedValue(undefined)
  fsMocks.readFile.mockReset()
  fsMocks.writeFile.mockReset()
})

function entry(patch: Partial<ResearchHistoryEntry> = {}): ResearchHistoryEntry {
  return {
    id: "research-1",
    createdAt: 1782378000000,
    topic: "alpha",
    trigger: "auto-review",
    autoQueued: true,
    reviewExpansion: false,
    reviewMode: "suppressed",
    searchQueries: ["alpha query"],
    savedPath: "wiki/queries/research-alpha.md",
    sourceReviewId: "review-1",
    sourceReviewTitle: "Research alpha",
    followUpIngest: { status: "queued", ingestTaskId: "ingest-1", error: null },
    status: "done",
    error: null,
    ...patch,
  }
}

describe("appendResearchHistory", () => {
  it("appends a compact metadata entry to .llm-wiki/research-history.json", async () => {
    fsMocks.readFile.mockResolvedValue(JSON.stringify([entry({ id: "old" })]))

    await appendResearchHistory("/project", entry())

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/research-history.json",
      JSON.stringify([entry({ id: "old" }), entry()], null, 2),
    )
  })

  it("starts a new history file when none exists", async () => {
    fsMocks.readFile.mockRejectedValue(new Error("missing"))

    await appendResearchHistory("/project", entry())

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/research-history.json",
      JSON.stringify([entry()], null, 2),
    )
  })
})

describe("updateResearchHistory", () => {
  it("updates the matching history entry without replacing unrelated fields", async () => {
    fsMocks.readFile.mockResolvedValue(JSON.stringify([entry()]))

    await updateResearchHistory("/project", "research-1", {
      followUpIngest: { status: "done", ingestTaskId: "ingest-1", error: null },
    })

    expect(JSON.parse(fsMocks.writeFile.mock.calls[0][1])).toEqual([
      entry({ followUpIngest: { status: "done", ingestTaskId: "ingest-1", error: null } }),
    ])
  })

  it("does nothing when the history entry is absent", async () => {
    fsMocks.readFile.mockResolvedValue(JSON.stringify([entry({ id: "other" })]))

    await updateResearchHistory("/project", "research-1", { status: "error" })

    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })
})

describe("appendResearchLogSummary", () => {
  it("writes a human-readable auto research summary to wiki/log.md", async () => {
    fsMocks.readFile.mockResolvedValue("# Wiki Log\n")

    await appendResearchLogSummary("/project", entry(), new Date("2026-06-25T09:00:00Z"))

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/project/wiki/log.md",
      "# Wiki Log\n- 2026-06-25: Auto Deep Research queued \"alpha\" -> wiki/queries/research-alpha.md (reviewExpansion: suppressed)\n",
    )
  })
})
