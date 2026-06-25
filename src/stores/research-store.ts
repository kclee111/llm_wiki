import { create } from "zustand"
import type { WebSearchResult } from "@/lib/web-search"

export interface ResearchTask {
  id: string
  topic: string
  searchQueries?: string[]
  reviewExpansion: boolean
  status: "queued" | "searching" | "synthesizing" | "saving" | "done" | "error"
  webResults: WebSearchResult[]
  synthesis: string
  savedPath: string | null
  followUpIngest?: {
    status: "queued" | "processing" | "done" | "failed"
    ingestTaskId?: string
    error?: string | null
  }
  error: string | null
  createdAt: number
}

interface ResearchState {
  tasks: ResearchTask[]
  panelOpen: boolean
  maxConcurrent: number
  reviewExpansionEnabled: boolean
  autoDeepResearchEnabled: boolean

  addTask: (topic: string) => string
  updateTask: (id: string, updates: Partial<ResearchTask>) => void
  updateFollowUpIngest: (id: string, updates: NonNullable<ResearchTask["followUpIngest"]>) => void
  removeTask: (id: string) => void
  setPanelOpen: (open: boolean) => void
  setReviewExpansionEnabled: (enabled: boolean) => void
  setAutoDeepResearchEnabled: (enabled: boolean) => void
  getRunningCount: () => number
  getNextQueued: () => ResearchTask | undefined
}

let counter = 0

export const useResearchStore = create<ResearchState>((set, get) => ({
  tasks: [],
  panelOpen: false,
  maxConcurrent: 3,
  reviewExpansionEnabled: false,
  autoDeepResearchEnabled: false,

  addTask: (topic) => {
    const id = `research-${++counter}`
    const reviewExpansion = get().reviewExpansionEnabled
    set((state) => ({
      tasks: [
        ...state.tasks,
        {
          id,
          topic,
          reviewExpansion,
          status: "queued",
          webResults: [],
          synthesis: "",
          savedPath: null,
          error: null,
          createdAt: Date.now(),
        },
      ],
      panelOpen: true,
    }))
    return id
  },

  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  updateFollowUpIngest: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, followUpIngest: { ...t.followUpIngest, ...updates } }
          : t,
      ),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  setPanelOpen: (panelOpen) => set({ panelOpen }),

  setReviewExpansionEnabled: (reviewExpansionEnabled) => set({ reviewExpansionEnabled }),

  setAutoDeepResearchEnabled: (autoDeepResearchEnabled) => set({ autoDeepResearchEnabled }),

  getRunningCount: () => {
    const { tasks } = get()
    return tasks.filter((t) =>
      t.status === "searching" || t.status === "synthesizing" || t.status === "saving"
    ).length
  },

  getNextQueued: () => {
    const { tasks } = get()
    return tasks.find((t) => t.status === "queued")
  },
}))
