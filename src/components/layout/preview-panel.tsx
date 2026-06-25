import { useEffect, useCallback, useRef } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, writeFile } from "@/commands/fs"
import { getFileCategory, isBinary, isExtractedTextPreviewFile } from "@/lib/file-types"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { FilePreview } from "@/components/editor/file-preview"
import { getFileName } from "@/lib/path-utils"
import { writeWikiMarkdownWithLog } from "@/lib/wiki-change-log"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function PreviewPanel() {
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const fileContent = useWikiStore((s) => s.fileContent)
  const previewContentPath = useWikiStore((s) => s.previewContentPath)
  const externalPreview = useWikiStore((s) => s.externalPreview)
  const project = useWikiStore((s) => s.project)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const canGoBack = useWikiStore((s) => s.canGoBackInPreview())
  const canGoForward = useWikiStore((s) => s.canGoForwardInPreview())
  const goBackInPreview = useWikiStore((s) => s.goBackInPreview)
  const goForwardInPreview = useWikiStore((s) => s.goForwardInPreview)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Snapshot of what was most recently loaded from disk. Milkdown re-emits
  // `markdownUpdated` on initial parse (before the user types anything),
  // which used to trigger an auto-save that could write back a placeholder
  // marker if read_file had returned one for a missing/locked file. We
  // skip save when the incoming markdown equals the last-loaded content.
  const lastLoadedRef = useRef<string>("")

  useEffect(() => {
    if (!selectedFile) {
      setFileContent("")
      lastLoadedRef.current = ""
      return
    }
    if (previewContentPath === selectedFile) {
      lastLoadedRef.current = fileContent
      return
    }
    if (externalPreview?.path === selectedFile) {
      lastLoadedRef.current = fileContent
      return
    }

    const category = getFileCategory(selectedFile)

    if (isBinary(category) && !isExtractedTextPreviewFile(selectedFile)) {
      setFileContent("")
      lastLoadedRef.current = ""
      return
    }

    readFile(selectedFile)
      .then((content) => {
        lastLoadedRef.current = content
        setFileContent(content)
      })
      .catch((err) => {
        lastLoadedRef.current = ""
        setFileContent(`Error loading file: ${err}`)
      })
  }, [selectedFile, previewContentPath, externalPreview, setFileContent])

  const writeNow = useCallback((path: string, markdown: string, syncStore = false) => {
    const write = project
      ? writeWikiMarkdownWithLog(project.path, path, markdown, { operation: "update", source: "Editor save" })
      : writeFile(path, markdown)
    write
      .then(() => {
        lastLoadedRef.current = markdown
        if (syncStore) setFileContent(markdown)
      })
      .catch((err) => console.error("Failed to save:", err))
  }, [project, setFileContent])

  const handleSave = useCallback(
    (markdown: string, options?: { immediate?: boolean }) => {
      if (!selectedFile) return
      // Ignore no-op saves from the editor's initial re-emit. Only write
      // when the user has actually changed the content relative to the
      // last disk read.
      if (markdown === lastLoadedRef.current) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (options?.immediate) {
        setFileContent(markdown)
        writeNow(selectedFile, markdown, true)
        return
      }
      saveTimerRef.current = setTimeout(() => {
        writeNow(selectedFile, markdown, true)
      }, 1000)
    },
    [selectedFile, setFileContent, writeNow]
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to preview
      </div>
    )
  }

  const category = getFileCategory(selectedFile)
  const fileName = externalPreview?.path === selectedFile
    ? externalPreview.title
    : getFileName(selectedFile)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <TooltipProvider delay={300}>
            <Tooltip>
              <TooltipTrigger
                aria-label="Back"
                disabled={!canGoBack}
                onClick={goBackInPreview}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Back</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                aria-label="Forward"
                disabled={!canGoForward}
                onClick={goForwardInPreview}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Forward</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="truncate text-xs text-muted-foreground" title={selectedFile}>
            {fileName}
          </span>
        </div>
        <button
          onClick={() => setSelectedFile(null)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Close preview"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        {externalPreview?.path === selectedFile ? (
          <ExternalReferencePreview
            source={externalPreview.source}
            title={externalPreview.title}
            path={externalPreview.url}
            snippet={externalPreview.snippet || fileContent}
          />
        ) : category === "markdown" ? (
          <WikiEditor
            key={selectedFile}
            content={fileContent}
            onSave={handleSave}
            filePath={selectedFile}
          />
        ) : (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={fileContent}
          />
        )}
      </div>
    </div>
  )
}

function ExternalReferencePreview({
  source,
  title,
  path,
  snippet,
}: {
  source: string
  title: string
  path: string
  snippet: string
}) {
  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {source}
          </span>
          <h3 className="truncate text-sm font-medium" title={title}>{title}</h3>
        </div>
        <div className="break-all rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {path}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-background p-4">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
          {snippet || "(No preview fragment returned.)"}
        </pre>
      </div>
    </div>
  )
}
