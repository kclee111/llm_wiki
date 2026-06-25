import { fileExists, readFile, writeFile } from "@/commands/fs"
import { getRelativePath, normalizePath } from "@/lib/path-utils"

export type WikiChangeLogOperation = "create" | "update" | "autofix"

export interface WikiChangeLogOptions {
  operation?: WikiChangeLogOperation
  source?: string
  now?: Date
}

export function shouldLogWikiMarkdownChange(projectPath: string, filePath: string): boolean {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const fp = normalizePath(filePath)
  if (!fp.startsWith(`${pp}/wiki/`)) return false
  if (!fp.toLowerCase().endsWith(".md")) return false
  return getRelativePath(fp, pp).toLowerCase() !== "wiki/log.md"
}

function wikiChangeVerb(operation: WikiChangeLogOperation): string {
  if (operation === "create") return "Created"
  if (operation === "autofix") return "Auto-fixed"
  return "Updated"
}

function wikiLogDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

async function appendWikiChangeLog(
  projectPath: string,
  filePath: string,
  operation: WikiChangeLogOperation,
  options: WikiChangeLogOptions = {},
): Promise<void> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const relativePath = getRelativePath(filePath, pp)
  const source = options.source ? ` via ${options.source}` : ""
  const entry = `- ${wikiLogDate(options.now)}: ${wikiChangeVerb(operation)} \`${relativePath}\`${source}\n`
  const logPath = `${pp}/wiki/log.md`
  const logContent = await readFile(logPath).catch(() => "# Wiki Log\n")
  await writeFile(logPath, `${logContent.trimEnd()}\n${entry}`)
}

export async function writeWikiMarkdownWithLog(
  projectPath: string,
  filePath: string,
  contents: string,
  options: WikiChangeLogOptions = {},
): Promise<void> {
  const normalizedFilePath = normalizePath(filePath)
  if (!shouldLogWikiMarkdownChange(projectPath, normalizedFilePath)) {
    await writeFile(normalizedFilePath, contents)
    return
  }

  let existed = true
  try {
    existed = await fileExists(normalizedFilePath)
  } catch {
    existed = true
  }
  await writeFile(normalizedFilePath, contents)

  const operation = options.operation ?? (existed ? "update" : "create")
  try {
    await appendWikiChangeLog(projectPath, normalizedFilePath, operation, options)
  } catch (err) {
    console.warn("[wiki-change-log] failed to append log:", err)
  }
}
