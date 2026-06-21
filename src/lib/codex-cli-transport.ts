/**
 * Codex CLI subprocess transport.
 *
 * Rust-side counterpart: src-tauri/src/commands/codex_cli.rs. The Rust
 * command spawns `codex exec --json`, sends a single reconstructed prompt
 * over stdin, and emits each JSONL stdout line back as `codex-cli:{streamId}`.
 */

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { LlmConfig, ReasoningMode } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { ChatMessage, ContentBlock, RequestOverrides } from "./llm-providers"
import type { StreamCallbacks } from "./llm-client"

/**
 * How many times to spawn Codex per request. A reasoning model can finish a
 * turn having spent its whole budget on hidden reasoning, leaving the final
 * agent_message empty; one retry recovers that probabilistic failure.
 */
const CODEX_MAX_ATTEMPTS = 2

type AttemptOutcome =
  | { kind: "emitted" }
  | { kind: "empty"; details: string }
  | { kind: "error"; error: Error }
  | { kind: "aborted" }

const CODEX_CLI_TEXT_COMPLETION_PREAMBLE = [
  "You are running inside LLM Wiki as a stateless text-completion provider.",
  "Do not use tools. Do not inspect, create, edit, delete, move, or patch files.",
  "Do not call shell commands. Do not use apply_patch.",
  "Return only the requested textual answer for LLM Wiki to consume; the application will handle all file writes itself.",
].join("\n")

/**
 * Map LLM Wiki's reasoning mode onto Codex CLI's `model_reasoning_effort`
 * config value. Returns undefined when the flag should be omitted so Codex
 * keeps its own default. `off` is bounded to `low` (the lowest value Codex
 * accepts — `minimal` is rejected) to curb the reasoning runaway that can
 * leave the final agent_message empty.
 */
export function reasoningModeToCodexEffort(mode: ReasoningMode | undefined): string | undefined {
  switch (mode) {
    case "off":
    case "low":
      return "low"
    case "medium":
      return "medium"
    case "high":
    case "max":
      return "high"
    default:
      return undefined
  }
}

export function parseCodexCliLine(rawLine: string): string | null {
  const line = rawLine.trim()
  if (!line) return null

  let evt: unknown
  try {
    evt = JSON.parse(line)
  } catch {
    return null
  }

  if (!evt || typeof evt !== "object") return null
  const obj = evt as Record<string, unknown>
  if (obj.type !== "item.completed") return null

  const item = obj.item as Record<string, unknown> | undefined
  if (item?.type !== "agent_message") return null
  return typeof item.text === "string" && item.text.length > 0 ? item.text : null
}

function contentToText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content
  return content
    .map((block) => {
      if (block.type === "text") return block.text
      return `[Image omitted: ${block.mediaType}]`
    })
    .join("\n")
}

function escapePromptContent(text: string): string {
  return text.replace(/<\/?[A-Z_][A-Z0-9_]*>/gi, (tag) =>
    tag.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  )
}

export function buildPrompt(messages: ChatMessage[]): string {
  const conversation = messages
    .map((message) => {
      const role = message.role.toUpperCase()
      return `<${role}>\n${escapePromptContent(contentToText(message.content))}\n</${role}>`
    })
    .join("\n\n")
  return `${CODEX_CLI_TEXT_COMPLETION_PREAMBLE}\n\n${conversation}`
}

type SpawnPayload = Record<string, unknown> & {
  streamId: string
  model: string
  prompt: string
  isolateLocalConfig: boolean
  timeoutMinutes?: number
  workingDirectory?: string
  reasoningEffort?: string
}

export async function streamCodexCli(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  overrides?: RequestOverrides,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks

  if (import.meta.env?.DEV && overrides) {
    for (const key of ["temperature", "top_p", "top_k", "max_tokens", "stop"] as const) {
      if (overrides[key] !== undefined) {
        // eslint-disable-next-line no-console
        console.warn(`[codex-cli] ignoring unsupported override "${key}": CLI has no equivalent flag`)
      }
    }
  }

  let aborted = signal?.aborted ?? false
  if (aborted) {
    onDone()
    return
  }

  // Terminal callbacks fire exactly once across all attempts.
  let settled = false
  const settleDone = () => {
    if (settled) return
    settled = true
    onDone()
  }
  const settleError = (error: Error) => {
    if (settled) return
    settled = true
    onError(error)
  }

  const workingDirectory = useWikiStore.getState().project?.path
  if (!workingDirectory) {
    settleError(new Error("Codex CLI requires an active project working directory"))
    return
  }

  const prompt = buildPrompt(messages)
  const reasoningEffort = reasoningModeToCodexEffort(
    overrides?.reasoning?.mode ?? config.reasoning?.mode,
  )

  let currentStreamId: string | undefined
  const abortListener = () => {
    aborted = true
    if (currentStreamId) {
      void invoke("codex_cli_kill", { streamId: currentStreamId }).catch(() => {})
    }
  }
  signal?.addEventListener("abort", abortListener)

  const runAttempt = async (): Promise<AttemptOutcome> => {
    const streamId = crypto.randomUUID()
    currentStreamId = streamId
    let emitted = false
    let unlistenData: UnlistenFn | undefined
    let unlistenDone: UnlistenFn | undefined

    const unparsedLines: string[] = []
    let unparsedSize = 0
    const captureUnparsed = (line: string) => {
      if (unparsedSize >= 4096) return
      const trimmed = line.trim()
      if (!trimmed) return
      unparsedLines.push(line)
      unparsedSize += line.length + 1
    }
    const replayAgentMessagesFromStdout = (stdout: string | undefined) => {
      if (!stdout) return
      for (const line of stdout.split(/\r?\n/)) {
        const token = parseCodexCliLine(line)
        if (token !== null) {
          emitted = true
          onToken(token)
        }
      }
    }

    let resolveAttempt: (outcome: AttemptOutcome) => void = () => {}
    const attemptDone = new Promise<AttemptOutcome>((resolve) => {
      resolveAttempt = resolve
    })
    let resolved = false
    const finishAttempt = (outcome: AttemptOutcome) => {
      if (resolved) return
      resolved = true
      unlistenData?.()
      unlistenDone?.()
      resolveAttempt(outcome)
    }

    try {
      unlistenData = await listen<string>(`codex-cli:${streamId}`, (event) => {
        const token = parseCodexCliLine(event.payload)
        if (token !== null) {
          emitted = true
          onToken(token)
        } else {
          captureUnparsed(event.payload)
        }
      })
      if (aborted) {
        finishAttempt({ kind: "aborted" })
        return attemptDone
      }

      unlistenDone = await listen<{ code: number | null; stderr: string; stdout?: string }>(
        `codex-cli:${streamId}:done`,
        (event) => {
          const code = event.payload?.code
          const stderr = event.payload?.stderr?.trim() ?? ""
          const stdout = event.payload?.stdout ?? ""
          if (code !== null && code !== undefined && code !== 0) {
            const details = stderr || stdout.trim() || unparsedLines.join("\n")
            finishAttempt({
              kind: "error",
              error: new Error(
                details
                  ? `Codex CLI exited with code ${code}:\n${details}`
                  : `Codex CLI exited with code ${code}. Run \`codex\` in a terminal to inspect the problem.`,
              ),
            })
          } else {
            if (!emitted) replayAgentMessagesFromStdout(stdout)
            if (!emitted) {
              finishAttempt({ kind: "empty", details: stdout.trim() || unparsedLines.join("\n").trim() })
            } else {
              finishAttempt({ kind: "emitted" })
            }
          }
        },
      )
      if (aborted) {
        finishAttempt({ kind: "aborted" })
        return attemptDone
      }

      const payload: SpawnPayload = {
        streamId,
        model: config.model,
        prompt,
        isolateLocalConfig: config.localCliIsolation === true,
        timeoutMinutes: config.codexCliTimeoutMinutes,
        workingDirectory,
      }
      if (reasoningEffort !== undefined) {
        payload.reasoningEffort = reasoningEffort
      }
      await invoke("codex_cli_spawn", payload)
      if (aborted || signal?.aborted) {
        aborted = true
        await invoke("codex_cli_kill", { streamId }).catch(() => {})
        finishAttempt({ kind: "aborted" })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const error = /not found|No such file|executable file not found/i.test(message)
        ? new Error(
            "Codex CLI not found. Install `codex` with `npm install -g @openai/codex` or pick a different provider.",
          )
        : err instanceof Error
          ? err
          : new Error(message)
      finishAttempt({ kind: "error", error })
    }

    return attemptDone
  }

  try {
    for (let attempt = 0; attempt < CODEX_MAX_ATTEMPTS; attempt++) {
      const outcome = await runAttempt()
      if (aborted || outcome.kind === "aborted") {
        settleDone()
        return
      }
      if (outcome.kind === "emitted") {
        settleDone()
        return
      }
      if (outcome.kind === "error") {
        settleError(outcome.error)
        return
      }
      // outcome.kind === "empty": retry once, then surface a clear error.
      if (attempt < CODEX_MAX_ATTEMPTS - 1) {
        continue
      }
      const guidance =
        "Codex returned an empty response again after a retry — the model spent its turn on reasoning without emitting a final message. Try lowering the reasoning effort (Settings → LLM) or switching to a different model."
      const details = outcome.details
      settleError(new Error(
        details ? `${guidance}\n\nRaw output:\n${details}` : guidance,
      ))
      return
    }
  } finally {
    signal?.removeEventListener("abort", abortListener)
  }
}
