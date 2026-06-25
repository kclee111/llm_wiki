import { getFileName } from "./path-utils"

export interface GraphPreview {
  path: string
  title: string
  content: string
}

export function createGraphPreview(path: string, label: string, content: string): GraphPreview {
  return {
    path,
    title: label || getFileName(path),
    content,
  }
}
