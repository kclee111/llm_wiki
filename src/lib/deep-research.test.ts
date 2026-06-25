import { beforeEach, describe, expect, it, vi } from "vitest"
import { collectResearchSources, makeDeepResearchFileName, noResearchSourcesTaskPatch, queueResearch } from "./deep-research"
import type { LlmConfig, SearchApiConfig } from "@/stores/wiki-store"
import type { WebSearchResult } from "./web-search"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("./ingest-queue", () => ({
  enqueueIngest: vi.fn(),
}))

vi.mock("./web-search", async () => {
  const actual = await vi.importActual<typeof import("./web-search")>("./web-search")
  return {
    ...actual,
    webSearch: vi.fn(),
  }
})

import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { streamChat } from "./llm-client"
import { enqueueIngest } from "./ingest-queue"
import { webSearch } from "./web-search"
import { useResearchStore } from "@/stores/research-store"
import { useWikiStore } from "@/stores/wiki-store"

const webResult: WebSearchResult = {
  title: "Web",
  url: "https://example.com/web",
  snippet: "web snippet",
  source: "example.com",
}

const localResult: WebSearchResult = {
  title: "Local",
  url: "file:///C:/docs/local.md",
  snippet: "local snippet",
  source: "AnyTXT",
}

function config(patch: Partial<SearchApiConfig>): SearchApiConfig {
  return {
    provider: "none",
    apiKey: "",
    ...patch,
  }
}

const llmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "gpt-4",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 128000,
}

const searchConfig = config({ deepResearchSource: "web", provider: "tavily", apiKey: "tvly" })

beforeEach(() => {
  vi.useRealTimers()
  vi.mocked(createDirectory).mockReset()
  vi.mocked(createDirectory).mockResolvedValue(undefined)
  vi.mocked(readFile).mockReset()
  vi.mocked(writeFile).mockReset()
  vi.mocked(enqueueIngest).mockReset()
  vi.mocked(streamChat).mockReset()
  vi.mocked(webSearch).mockReset()
  useResearchStore.setState({ tasks: [], panelOpen: false, reviewExpansionEnabled: false })
  useWikiStore.getState().setProject({
    id: "project-id",
    name: "Project",
    path: "/project",
  })
})

describe("makeDeepResearchFileName", () => {
  it("keeps Unicode topics and includes time to avoid same-day overwrite", () => {
    const first = makeDeepResearchFileName(
      "反硝化除磷",
      new Date("2026-06-06T10:00:00.000Z"),
    )
    const second = makeDeepResearchFileName(
      "反硝化除磷",
      new Date("2026-06-06T10:00:01.000Z"),
    )

    expect(first.fileName).toBe("research-反硝化除磷-2026-06-06-100000.md")
    expect(second.fileName).toBe("research-反硝化除磷-2026-06-06-100001.md")
    expect(first.fileName).not.toBe(second.fileName)
  })

  it("uses the local calendar date for frontmatter metadata", () => {
    const localMorning = new Date(2026, 5, 6, 1, 30, 0)

    expect(makeDeepResearchFileName("政策版本差异", localMorning).date).toBe("2026-06-06")
  })
})

describe("noResearchSourcesTaskPatch", () => {
  it("marks source failures as an error instead of completed", () => {
    expect(noResearchSourcesTaskPatch(["Firecrawl blocked this IP", "AnyTXT offline"])).toEqual({
      status: "error",
      synthesis: "",
      error: "Firecrawl blocked this IP\nAnyTXT offline",
    })
  })

  it("marks an empty successful search as done", () => {
    expect(noResearchSourcesTaskPatch([])).toEqual({
      status: "done",
      synthesis: "No research sources found.",
      error: null,
    })
  })
})

describe("collectResearchSources", () => {
  it("uses only Web Search when source mode is web", async () => {
    const webSearch = vi.fn().mockResolvedValue([webResult])
    const anyTxtSearch = vi.fn().mockResolvedValue([localResult])

    const out = await collectResearchSources(
      ["alpha"],
      config({ deepResearchSource: "web", provider: "tavily", apiKey: "tvly" }),
      "/project",
      { webSearch, anyTxtSearch },
    )

    expect(webSearch).toHaveBeenCalledTimes(1)
    expect(anyTxtSearch).not.toHaveBeenCalled()
    expect(out.results).toEqual([webResult])
  })

  it("uses only AnyTXT when source mode is anytxt", async () => {
    const webSearch = vi.fn().mockResolvedValue([webResult])
    const anyTxtSearch = vi.fn().mockResolvedValue([localResult])

    const out = await collectResearchSources(
      ["alpha"],
      config({
        deepResearchSource: "anytxt",
        provider: "tavily",
        apiKey: "tvly",
        anyTxt: { endpoint: "http://127.0.0.1:9920" },
      }),
      "/project",
      { webSearch, anyTxtSearch },
    )

    expect(webSearch).not.toHaveBeenCalled()
    expect(anyTxtSearch).toHaveBeenCalledTimes(1)
    expect(anyTxtSearch.mock.calls[0][0]).toEqual(["alpha"])
    expect(out.results).toEqual([localResult])
  })

  it("uses both sources concurrently and deduplicates by URL", async () => {
    const duplicate = { ...localResult, url: webResult.url }
    const webSearch = vi.fn().mockResolvedValue([webResult])
    const anyTxtSearch = vi.fn().mockResolvedValue([duplicate, localResult])

    const out = await collectResearchSources(
      ["alpha"],
      config({
        deepResearchSource: "both",
        provider: "tavily",
        apiKey: "tvly",
        anyTxt: { endpoint: "http://127.0.0.1:9920" },
      }),
      "/project",
      { webSearch, anyTxtSearch },
    )

    expect(webSearch).toHaveBeenCalledTimes(1)
    expect(anyTxtSearch).toHaveBeenCalledTimes(1)
    expect(out.results).toEqual([webResult, localResult])
  })

  it("keeps web results when AnyTXT fails and exposes the source error", async () => {
    const webSearch = vi.fn().mockResolvedValue([webResult])
    const anyTxtSearch = vi.fn().mockRejectedValue(new Error("Check that ATGUI.exe is running"))

    const out = await collectResearchSources(
      ["alpha"],
      config({
        deepResearchSource: "both",
        provider: "tavily",
        apiKey: "tvly",
        anyTxt: { endpoint: "http://127.0.0.1:9920" },
      }),
      "/project",
      { webSearch, anyTxtSearch },
    )

    expect(out.results).toEqual([webResult])
    expect(out.errors).toEqual(["Check that ATGUI.exe is running"])
  })

  it("skips Web Search in both mode when no web provider is configured", async () => {
    const webSearch = vi.fn().mockResolvedValue([webResult])
    const anyTxtSearch = vi.fn().mockResolvedValue([localResult])

    const out = await collectResearchSources(
      ["alpha"],
      config({
        deepResearchSource: "both",
        provider: "none",
        anyTxt: { endpoint: "http://127.0.0.1:9920" },
      }),
      "/project",
      { webSearch, anyTxtSearch },
    )

    expect(webSearch).not.toHaveBeenCalled()
    expect(anyTxtSearch).toHaveBeenCalledTimes(1)
    expect(out.results).toEqual([localResult])
  })

  it("returns no results for blank queries", async () => {
    const webSearch = vi.fn().mockResolvedValue([webResult])
    const anyTxtSearch = vi.fn().mockResolvedValue([localResult])

    const out = await collectResearchSources(
      [" ", ""],
      config({ deepResearchSource: "both", provider: "tavily", apiKey: "tvly" }),
      "/project",
      { webSearch, anyTxtSearch },
    )

    expect(webSearch).not.toHaveBeenCalled()
    expect(anyTxtSearch).not.toHaveBeenCalled()
    expect(out.results).toEqual([])
  })

  it("logs once when research sources are capped", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const webSearch = vi.fn().mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        title: `Result ${index}`,
        url: `https://example.com/${index}`,
        snippet: "snippet",
        source: "example.com",
      })),
    )
    const anyTxtSearch = vi.fn().mockResolvedValue([])

    const out = await collectResearchSources(
      ["alpha", "beta"],
      config({ deepResearchSource: "web", provider: "tavily", apiKey: "tvly" }),
      "/project",
      { webSearch, anyTxtSearch },
    )

    expect(out.results).toHaveLength(20)
    expect(infoSpy).toHaveBeenCalledTimes(1)
    infoSpy.mockRestore()
  })
})

describe("queueResearch follow-up ingest", () => {
  it("queues the saved research page for ingest instead of calling auto-ingest outside the queue", async () => {
    vi.useFakeTimers()
    let historyRaw = ""
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path.endsWith("research-history.json")) {
        return historyRaw ? Promise.resolve(historyRaw) : Promise.reject(new Error("missing"))
      }
      if (path.endsWith("log.md")) return Promise.resolve("# Wiki Log\n")
      return Promise.resolve("# Index")
    })
    vi.mocked(writeFile).mockImplementation((path: string, contents: string) => {
      if (path.endsWith("research-history.json")) historyRaw = contents
      return Promise.resolve(undefined as unknown as void)
    })
    vi.mocked(enqueueIngest).mockResolvedValue("ingest-research")
    vi.mocked(webSearch).mockResolvedValue([webResult])
    vi.mocked(streamChat).mockImplementation(async (_llm, _messages, handlers) => {
      handlers.onToken("synthesis")
      handlers.onDone()
    })

    queueResearch("/project", "alpha", llmConfig, searchConfig, ["alpha"], {
      trigger: "auto-review",
      autoQueued: true,
      sourceReviewId: "review-1",
      sourceReviewTitle: "Research alpha",
    })
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    expect(enqueueIngest).toHaveBeenCalledWith(
      "project-id",
      expect.stringMatching(/^wiki\/queries\/research-alpha-/),
      "Deep Research result",
      {
        sourceKind: "research-result",
        createdBy: "deep-research",
        researchTaskId: expect.any(String),
        reviewMode: "suppressed",
      },
    )
    const task = useResearchStore.getState().tasks[0]
    expect(task.triggerMetadata).toMatchObject({
      trigger: "auto-review",
      autoQueued: true,
      sourceReviewId: "review-1",
    })
    expect(task.followUpIngest).toMatchObject({
      status: "queued",
      ingestTaskId: "ingest-research",
    })
    const historyWrites = vi.mocked(writeFile).mock.calls.filter(([path]) =>
      path === "/project/.llm-wiki/research-history.json"
    )
    const historyWrite = historyWrites[historyWrites.length - 1]
    expect(historyWrite).toBeTruthy()
    const history = JSON.parse(String(historyWrite?.[1]))
    expect(history[0]).toMatchObject({
      id: task.id,
      topic: "alpha",
      trigger: "auto-review",
      autoQueued: true,
      reviewExpansion: false,
      reviewMode: "suppressed",
      savedPath: expect.stringMatching(/^wiki\/queries\/research-alpha-/),
      sourceReviewId: "review-1",
      sourceReviewTitle: "Research alpha",
      followUpIngest: { status: "queued", ingestTaskId: "ingest-research", error: null },
    })
  })

  it("allows review expansion for the follow-up ingest when the Review toggle is enabled", async () => {
    vi.useFakeTimers()
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path.endsWith("research-history.json")) return Promise.reject(new Error("missing"))
      if (path.endsWith("log.md")) return Promise.resolve("# Wiki Log\n")
      return Promise.resolve("# Index")
    })
    vi.mocked(writeFile).mockResolvedValue(undefined as unknown as void)
    vi.mocked(enqueueIngest).mockResolvedValue("ingest-research")
    vi.mocked(webSearch).mockResolvedValue([webResult])
    vi.mocked(streamChat).mockImplementation(async (_llm, _messages, handlers) => {
      handlers.onToken("synthesis")
      handlers.onDone()
    })
    useResearchStore.getState().setReviewExpansionEnabled(true)

    queueResearch("/project", "alpha", llmConfig, searchConfig, ["alpha"])
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    expect(enqueueIngest).toHaveBeenCalledWith(
      "project-id",
      expect.stringMatching(/^wiki\/queries\/research-alpha-/),
      "Deep Research result",
      expect.objectContaining({
        sourceKind: "research-result",
        createdBy: "deep-research",
        reviewMode: "expanded",
      }),
    )
  })
})
