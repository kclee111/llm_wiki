import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock("@/commands/fs", () => fsMocks)

import {
  appendWikilink,
  applySuggestedLinkFixes,
  applySuggestedLinkFix,
  ensureBrokenLinkStub,
  isSuggestedLinkFixable,
  rewriteWikilinkTarget,
  stubRelativePathFromBrokenTarget,
} from "./lint-fixes"

beforeEach(() => {
  fsMocks.createDirectory.mockReset()
  fsMocks.fileExists.mockReset()
  fsMocks.readFile.mockReset()
  fsMocks.writeFile.mockReset()
})

describe("rewriteWikilinkTarget", () => {
  it("rewrites a matching wikilink and preserves aliases", () => {
    const out = rewriteWikilinkTarget(
      "See [[transfomer|the Transformer page]] and [[attention]].",
      "transfomer",
      "entities/transformer.md",
    )

    expect(out).toBe("See [[entities/transformer|the Transformer page]] and [[attention]].")
  })

  it("leaves non-matching wikilinks byte-identical", () => {
    const input = "See [[attention|Attention]] only."
    expect(rewriteWikilinkTarget(input, "transformer", "entities/transformer.md")).toBe(input)
  })
})

describe("appendWikilink", () => {
  it("does not duplicate an existing aliased wikilink", () => {
    const input = "See [[entities/transformer|Transformer]]."
    expect(appendWikilink(input, "entities/transformer.md")).toBe(input)
  })

  it("appends a related section when the target is absent", () => {
    expect(appendWikilink("# Page\nBody", "entities/transformer.md")).toBe(
      "# Page\nBody\n\n## Related\n- [[entities/transformer]]\n",
    )
  })

  it("adds to an existing related section without duplicating the heading", () => {
    const out = appendWikilink(
      "# Page\n\n## Related\n- [[entities/attention]]\n",
      "entities/transformer.md",
    )

    expect(out.match(/^## Related$/gm)).toHaveLength(1)
    expect(out).toContain("## Related\n- [[entities/transformer]]\n- [[entities/attention]]")
  })
})

describe("ensureBrokenLinkStub", () => {
  it("reuses an existing slugified target instead of overwriting it", async () => {
    fsMocks.fileExists.mockResolvedValue(true)

    const result = await ensureBrokenLinkStub("/project", "Foo Bar")

    expect(result).toEqual({
      fullPath: "/project/wiki/queries/foo-bar.md",
      relativePath: "queries/foo-bar.md",
      created: false,
    })
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it("creates a safe stub path when no target exists", async () => {
    fsMocks.fileExists.mockResolvedValue(false)

    const result = await ensureBrokenLinkStub("/project", "Foo Bar")

    expect(result.relativePath).toBe("queries/foo-bar.md")
    expect(fsMocks.createDirectory).toHaveBeenCalledWith("/project/wiki/queries")
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/project/wiki/queries/foo-bar.md",
      expect.stringContaining("title: \"Foo Bar\""),
    )
  })

  it("keeps explicit wiki subdirectories when building stub paths", () => {
    expect(stubRelativePathFromBrokenTarget("concepts/Foo Bar")).toBe("concepts/foo-bar.md")
  })
})

describe("isSuggestedLinkFixable", () => {
  it("only marks structural lint items with concrete suggested link targets as auto-fixable", () => {
    expect(isSuggestedLinkFixable({
      type: "orphan",
      severity: "info",
      page: "concepts/iso-50001.md",
      detail: "No inbound links.",
      suggestedSource: "concepts/ems.md",
    })).toBe(true)

    expect(isSuggestedLinkFixable({
      type: "semantic",
      severity: "warning",
      page: "concepts/ems.md",
      detail: "Needs review.",
    })).toBe(false)
  })
})

describe("applySuggestedLinkFix", () => {
  it("adds an inbound link from the suggested source to an orphan page", async () => {
    fsMocks.readFile.mockResolvedValue("# EMS\n")

    await expect(applySuggestedLinkFix("/project", {
      type: "orphan",
      severity: "info",
      page: "concepts/iso-50001.md",
      detail: "No inbound links.",
      suggestedSource: "concepts/ems.md",
    })).resolves.toBe(true)

    expect(fsMocks.readFile).toHaveBeenCalledWith("/project/wiki/concepts/ems.md")
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/project/wiki/concepts/ems.md",
      "# EMS\n\n## Related\n- [[concepts/iso-50001]]\n",
    )
  })

  it("rewrites a broken wikilink to the suggested target", async () => {
    fsMocks.readFile.mockResolvedValue("See [[iso50001|ISO 50001]].")

    await expect(applySuggestedLinkFix("/project", {
      type: "broken-link",
      severity: "warning",
      page: "concepts/ems.md",
      detail: "Broken link.",
      brokenTarget: "iso50001",
      suggestedTarget: "concepts/iso-50001.md",
    })).resolves.toBe(true)

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/project/wiki/concepts/ems.md",
      "See [[concepts/iso-50001|ISO 50001]].",
    )
  })

  it("adds the suggested outbound link for a no-outlinks page", async () => {
    fsMocks.readFile.mockResolvedValue("# EMS\n")

    await expect(applySuggestedLinkFix("/project", {
      type: "no-outlinks",
      severity: "info",
      page: "concepts/ems.md",
      detail: "No outlinks.",
      suggestedTarget: "concepts/iso-50001.md",
    })).resolves.toBe(true)

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/project/wiki/concepts/ems.md",
      "# EMS\n\n## Related\n- [[concepts/iso-50001]]\n",
    )
  })
})

describe("applySuggestedLinkFixes", () => {
  it("applies all suggested link fixes and returns only unresolved lint items", async () => {
    fsMocks.readFile
      .mockResolvedValueOnce("# EMS\n")
      .mockResolvedValueOnce("# ISO\n")

    const unresolved = {
      type: "broken-link" as const,
      severity: "warning" as const,
      page: "concepts/ems.md",
      detail: "Broken link without suggestion.",
      brokenTarget: "missing",
    }

    const result = await applySuggestedLinkFixes("/project", [
      {
        type: "orphan",
        severity: "info",
        page: "concepts/iso-50001.md",
        detail: "No inbound links.",
        suggestedSource: "concepts/ems.md",
      },
      {
        type: "no-outlinks",
        severity: "info",
        page: "concepts/iso-50001.md",
        detail: "No outbound links.",
        suggestedTarget: "concepts/ems.md",
      },
      unresolved,
    ])

    expect(result.fixed).toBe(2)
    expect(result.remaining).toEqual([unresolved])
    expect(result.errors).toEqual([])
  })

  it("keeps an item when its suggested link fix fails", async () => {
    const item = {
      type: "orphan" as const,
      severity: "info" as const,
      page: "concepts/iso-50001.md",
      detail: "No inbound links.",
      suggestedSource: "concepts/ems.md",
    }
    fsMocks.readFile.mockRejectedValue(new Error("read failed"))

    const result = await applySuggestedLinkFixes("/project", [item])

    expect(result.fixed).toBe(0)
    expect(result.remaining).toEqual([item])
    expect(result.errors).toEqual(["concepts/iso-50001.md: read failed"])
  })
})
