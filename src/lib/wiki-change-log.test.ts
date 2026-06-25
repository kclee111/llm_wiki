import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock("@/commands/fs", () => fsMocks)

import {
  shouldLogWikiMarkdownChange,
  writeWikiMarkdownWithLog,
} from "./wiki-change-log"

beforeEach(() => {
  fsMocks.fileExists.mockReset()
  fsMocks.readFile.mockReset()
  fsMocks.writeFile.mockReset()
})

describe("shouldLogWikiMarkdownChange", () => {
  it("logs markdown files under wiki except wiki/log.md itself", () => {
    expect(shouldLogWikiMarkdownChange("/project", "/project/wiki/concepts/a.md")).toBe(true)
    expect(shouldLogWikiMarkdownChange("/project", "/project/wiki/log.md")).toBe(false)
    expect(shouldLogWikiMarkdownChange("/project", "/project/raw/sources/a.md")).toBe(false)
    expect(shouldLogWikiMarkdownChange("/project", "/project/wiki/concepts/a.txt")).toBe(false)
  })
})

describe("writeWikiMarkdownWithLog", () => {
  it("writes a new wiki markdown file and appends a create log entry", async () => {
    fsMocks.fileExists.mockResolvedValueOnce(false)
    fsMocks.readFile.mockResolvedValueOnce("# Wiki Log\n")

    await writeWikiMarkdownWithLog(
      "/project",
      "/project/wiki/queries/research-alpha.md",
      "# Alpha\n",
      { source: "Deep Research", now: new Date("2026-06-25T09:00:00Z") },
    )

    expect(fsMocks.writeFile).toHaveBeenNthCalledWith(1, "/project/wiki/queries/research-alpha.md", "# Alpha\n")
    expect(fsMocks.writeFile).toHaveBeenNthCalledWith(
      2,
      "/project/wiki/log.md",
      "# Wiki Log\n- 2026-06-25: Created `wiki/queries/research-alpha.md` via Deep Research\n",
    )
  })

  it("can log automatic fixes distinctly from ordinary updates", async () => {
    fsMocks.fileExists.mockResolvedValueOnce(true)
    fsMocks.readFile.mockResolvedValueOnce("# Wiki Log\n")

    await writeWikiMarkdownWithLog(
      "/project",
      "/project/wiki/concepts/ems.md",
      "# EMS\n",
      { operation: "autofix", source: "Lint suggested link", now: new Date("2026-06-25T09:00:00Z") },
    )

    expect(fsMocks.writeFile).toHaveBeenNthCalledWith(
      2,
      "/project/wiki/log.md",
      "# Wiki Log\n- 2026-06-25: Auto-fixed `wiki/concepts/ems.md` via Lint suggested link\n",
    )
  })

  it("does not log non-wiki markdown writes", async () => {
    await writeWikiMarkdownWithLog("/project", "/project/.llm-wiki/review.json", "[]")

    expect(fsMocks.fileExists).not.toHaveBeenCalled()
    expect(fsMocks.writeFile).toHaveBeenCalledOnce()
    expect(fsMocks.writeFile).toHaveBeenCalledWith("/project/.llm-wiki/review.json", "[]")
  })
})
