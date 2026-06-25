import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { IngestReviewMode } from "@/lib/ingest"
import type { ReviewItem } from "@/stores/review-store"

export type ResearchTrigger = "manual-review" | "auto-review" | "graph-insight" | "research-panel"
export type ResearchStatus = "queued" | "searching" | "synthesizing" | "saving" | "done" | "error"
export type FollowUpIngestStatus = "queued" | "processing" | "done" | "failed"

export interface ResearchTriggerMetadata {
  trigger: ResearchTrigger
  autoQueued?: boolean
  sourceReviewId?: string
  sourceReviewTitle?: string
  graphInsightType?: string
  graphInsightTitle?: string
}

export interface ResearchHistoryEntry {
  id: string
  createdAt: number
  topic: string
  trigger: ResearchTrigger
  autoQueued: boolean
  reviewExpansion: boolean
  reviewMode?: IngestReviewMode
  searchQueries?: string[]
  savedPath: string | null
  sourceReviewId?: string
  sourceReviewTitle?: string
  graphInsightType?: string
  graphInsightTitle?: string
  followUpIngest?: {
    status: FollowUpIngestStatus
    ingestTaskId?: string
    error?: string | null
  }
  status: ResearchStatus
  error: string | null
}

function historyPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/research-history.json`
}

async function readHistory(projectPath: string): Promise<ResearchHistoryEntry[]> {
  try {
    const raw = await readFile(historyPath(projectPath))
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as ResearchHistoryEntry[] : []
  } catch {
    return []
  }
}

async function writeHistory(projectPath: string, entries: ResearchHistoryEntry[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await writeFile(historyPath(pp), JSON.stringify(entries, null, 2))
}

export async function appendResearchHistory(
  projectPath: string,
  entry: ResearchHistoryEntry,
): Promise<void> {
  const entries = await readHistory(projectPath)
  entries.push(entry)
  await writeHistory(projectPath, entries)
}

export async function updateResearchHistory(
  projectPath: string,
  id: string,
  patch: Partial<ResearchHistoryEntry>,
): Promise<void> {
  const entries = await readHistory(projectPath)
  const index = entries.findIndex((entry) => entry.id === id)
  if (index === -1) return
  entries[index] = { ...entries[index], ...patch }
  await writeHistory(projectPath, entries)
}

function logDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function logPrefix(entry: ResearchHistoryEntry): string {
  if (entry.autoQueued) return "Auto Deep Research queued"
  return "Deep Research queued"
}

export async function appendResearchLogSummary(
  projectPath: string,
  entry: ResearchHistoryEntry,
  now: Date = new Date(),
): Promise<void> {
  const pp = normalizePath(projectPath)
  const logPath = `${pp}/wiki/log.md`
  const logContent = await readFile(logPath).catch(() => "# Wiki Log\n")
  const target = entry.savedPath ?? "(not saved)"
  const reviewMode = entry.reviewMode ?? (entry.reviewExpansion ? "expanded" : "suppressed")
  const line = `- ${logDate(now)}: ${logPrefix(entry)} "${entry.topic}" -> ${target} (reviewExpansion: ${reviewMode})\n`
  await writeFile(logPath, `${logContent.trimEnd()}\n${line}`)
}

export function makeResearchHistoryEntry(input: {
  id: string
  createdAt: number
  topic: string
  status: ResearchStatus
  reviewExpansion: boolean
  searchQueries?: string[]
  savedPath?: string | null
  error?: string | null
  metadata?: ResearchTriggerMetadata
}): ResearchHistoryEntry {
  const metadata = input.metadata
  return {
    id: input.id,
    createdAt: input.createdAt,
    topic: input.topic,
    trigger: metadata?.trigger ?? "research-panel",
    autoQueued: metadata?.autoQueued ?? false,
    reviewExpansion: input.reviewExpansion,
    searchQueries: input.searchQueries,
    savedPath: input.savedPath ?? null,
    sourceReviewId: metadata?.sourceReviewId,
    sourceReviewTitle: metadata?.sourceReviewTitle,
    graphInsightType: metadata?.graphInsightType,
    graphInsightTitle: metadata?.graphInsightTitle,
    status: input.status,
    error: input.error ?? null,
  }
}

export async function reconcileCompletedAutoResearchReviews(
  projectPath: string,
  items: ReviewItem[],
): Promise<ReviewItem[]> {
  const entries = await readHistory(projectPath)
  const completedReviewIds = new Set(
    entries
      .filter((entry) =>
        entry.trigger === "auto-review" &&
        entry.autoQueued &&
        entry.status === "done" &&
        Boolean(entry.sourceReviewId)
      )
      .map((entry) => entry.sourceReviewId as string),
  )
  if (completedReviewIds.size === 0) return items
  return items.map((item) =>
    !item.resolved && completedReviewIds.has(item.id)
      ? { ...item, resolved: true, resolvedAction: "Auto Deep Research completed" }
      : item
  )
}
