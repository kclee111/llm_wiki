import { createDirectory, fileExists, readFile } from "@/commands/fs"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { makeQuerySlug } from "@/lib/wiki-filename"
import type { LintResult } from "@/lib/lint"
import { writeWikiMarkdownWithLog } from "@/lib/wiki-change-log"

export function lintLinkTarget(target: string): string {
  return normalizePath(target)
    .replace(/^wiki\//i, "")
    .replace(/\.md$/i, "")
    .trim()
}

function normalizedLintLinkTarget(target: string): string {
  return lintLinkTarget(target).toLowerCase()
}

function hasWikilinkToTarget(content: string, target: string): boolean {
  const normalized = normalizedLintLinkTarget(target)
  return Array.from(content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g))
    .some((match) => normalizedLintLinkTarget(match[1]) === normalized)
}

export function appendWikilink(content: string, target: string): string {
  const linkTarget = lintLinkTarget(target)
  if (hasWikilinkToTarget(content, linkTarget)) return content
  const linkLine = `- [[${linkTarget}]]`
  const relatedHeading = /^##\s+Related\s*$/im.exec(content)
  if (relatedHeading) {
    const insertAt = relatedHeading.index + relatedHeading[0].length
    return `${content.slice(0, insertAt)}\n${linkLine}${content.slice(insertAt)}`
  }
  return `${content.trimEnd()}\n\n## Related\n${linkLine}\n`
}

export function rewriteWikilinkTarget(
  content: string,
  brokenTarget: string,
  suggestedTarget: string,
): string {
  const broken = normalizedLintLinkTarget(brokenTarget)
  const replacement = lintLinkTarget(suggestedTarget)
  return content.replace(
    /\[\[([^\]|]+?)(\|[^\]]+?)?\]\]/g,
    (match, rawTarget: string, rawAlias?: string) => {
      if (normalizedLintLinkTarget(rawTarget) !== broken) return match
      return `[[${replacement}${rawAlias ?? ""}]]`
    },
  )
}

export function isSuggestedLinkFixable(item: LintResult): boolean {
  if (item.type === "orphan") return Boolean(item.suggestedSource)
  if (item.type === "broken-link") return Boolean(item.brokenTarget && item.suggestedTarget)
  if (item.type === "no-outlinks") return Boolean(item.suggestedTarget)
  return false
}

export async function applySuggestedLinkFix(projectPath: string, item: LintResult): Promise<boolean> {
  const pp = normalizePath(projectPath)
  if (item.type === "orphan" && item.suggestedSource) {
    const sourcePath = `${pp}/wiki/${item.suggestedSource}`
    const content = await readFile(sourcePath)
    await writeWikiMarkdownWithLog(pp, sourcePath, appendWikilink(content, item.page), {
      operation: "autofix",
      source: "Lint orphan suggested source",
    })
    return true
  }

  if (item.type === "broken-link" && item.brokenTarget && item.suggestedTarget) {
    const pagePath = `${pp}/wiki/${item.page}`
    const content = await readFile(pagePath)
    await writeWikiMarkdownWithLog(pp, pagePath, rewriteWikilinkTarget(content, item.brokenTarget, item.suggestedTarget), {
      operation: "autofix",
      source: "Lint broken-link suggestion",
    })
    return true
  }

  if (item.type === "no-outlinks" && item.suggestedTarget) {
    const pagePath = `${pp}/wiki/${item.page}`
    const content = await readFile(pagePath)
    await writeWikiMarkdownWithLog(pp, pagePath, appendWikilink(content, item.suggestedTarget), {
      operation: "autofix",
      source: "Lint no-outlinks suggestion",
    })
    return true
  }

  return false
}

export async function applySuggestedLinkFixes(
  projectPath: string,
  items: readonly LintResult[],
): Promise<{ fixed: number; remaining: LintResult[]; errors: string[] }> {
  const remaining: LintResult[] = []
  const errors: string[] = []
  let fixed = 0

  for (const item of items) {
    if (!isSuggestedLinkFixable(item)) {
      remaining.push(item)
      continue
    }

    try {
      const applied = await applySuggestedLinkFix(projectPath, item)
      if (applied) {
        fixed += 1
      } else {
        remaining.push(item)
      }
    } catch (err) {
      remaining.push(item)
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${item.page}: ${message}`)
    }
  }

  return { fixed, remaining, errors }
}

export function stubRelativePathFromBrokenTarget(brokenTarget: string): string {
  const normalized = lintLinkTarget(brokenTarget)
  const parts = normalized
    .split("/")
    .map((part) => makeQuerySlug(part))
    .filter(Boolean)
  const rel = parts.length > 1
    ? parts.join("/")
    : `queries/${parts[0] ?? "missing-page"}`
  return `${rel}.md`
}

function stubTitleFromBrokenTarget(brokenTarget: string): string {
  return getFileName(lintLinkTarget(brokenTarget))
    .replace(/[-_]+/g, " ")
    .trim() || "Missing Page"
}

export async function ensureBrokenLinkStub(
  projectPath: string,
  brokenTarget: string,
): Promise<{ fullPath: string; relativePath: string; created: boolean }> {
  const relativePath = stubRelativePathFromBrokenTarget(brokenTarget)
  const fullPath = `${projectPath}/wiki/${relativePath}`
  if (await fileExists(fullPath)) {
    return { fullPath, relativePath, created: false }
  }

  const parent = fullPath.split("/").slice(0, -1).join("/")
  await createDirectory(parent)
  const title = stubTitleFromBrokenTarget(brokenTarget)
  const date = new Date().toISOString().slice(0, 10)
  const content = [
    "---",
    "type: query",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `created: ${date}`,
    `updated: ${date}`,
    "tags: [stub, lint]",
    "related: []",
    "sources: []",
    "---",
    "",
    `# ${title}`,
    "",
    "Created by Wiki Lint as a placeholder for a missing wikilink target.",
    "",
  ].join("\n")
  await writeWikiMarkdownWithLog(projectPath, fullPath, content, {
    operation: "create",
    source: "Lint broken-link stub",
  })
  return { fullPath, relativePath, created: true }
}
