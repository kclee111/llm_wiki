import { describe, expect, it } from "vitest"
import { createGraphPreview } from "./graph-preview"

describe("createGraphPreview", () => {
  it("uses the node label as the preview title", () => {
    expect(createGraphPreview("/project/wiki/concepts/ems.md", "EMS", "# EMS")).toEqual({
      path: "/project/wiki/concepts/ems.md",
      title: "EMS",
      content: "# EMS",
    })
  })

  it("falls back to the file name when the node label is empty", () => {
    expect(createGraphPreview("/project/wiki/concepts/ems.md", "", "# EMS").title).toBe("ems.md")
  })
})
