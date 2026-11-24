import type { ReactNode } from "react"

type CellBadgeRendererProps = {
  value: string | null | undefined
  highlightQuery?: string
}

function renderHighlightedText(text: string, query?: string): ReactNode {
  if (!query || !query.trim()) {
    return text
  }

  const trimmed = query.trim()
  const lowerText = text.toLowerCase()
  const lowerQuery = trimmed.toLowerCase()

  const parts: ReactNode[] = []
  let startIndex = 0
  let index = lowerText.indexOf(lowerQuery, startIndex)

  if (index === -1) {
    return text
  }

  let keyIndex = 0
  while (index !== -1) {
    if (index > startIndex) {
      parts.push(text.slice(startIndex, index))
    }
    const match = text.slice(index, index + trimmed.length)
    parts.push(
      <mark
        key={`match-${keyIndex++}`}
        className="rounded-xs bg-amber-400/35 text-foreground font-medium px-0.5"
      >
        {match}
      </mark>
    )
    startIndex = index + trimmed.length
    index = lowerText.indexOf(lowerQuery, startIndex)
  }

  if (startIndex < text.length) {
    parts.push(text.slice(startIndex))
  }

  return parts
}

export function isJsonString(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed)
      return true
    } catch {
      return false
    }
  }
  return false
}

export function CellBadgeRenderer({
  value,
  highlightQuery,
}: CellBadgeRendererProps) {
  if (value === null) {
    return (
      <span className="inline-flex items-center px-1 rounded-sm text-[10px] font-mono font-medium text-muted-foreground/70 bg-muted/60 select-none">
        NULL
      </span>
    )
  }

  if (value === undefined || value === "") {
    return (
      <span className="inline-flex items-center px-1 rounded-sm text-[10px] font-mono italic text-muted-foreground/50 select-none">
        (empty)
      </span>
    )
  }

  // Boolean check
  const lower = value.trim().toLowerCase()
  if (lower === "true" || lower === "t") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.2 rounded-sm text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 select-none">
        true
      </span>
    )
  }
  if (lower === "false" || lower === "f") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.2 rounded-sm text-[10px] font-mono font-semibold bg-muted text-muted-foreground select-none">
        false
      </span>
    )
  }

  // JSON check
  if (isJsonString(value)) {
    const trimmed = value.trim()
    const isArray = trimmed.startsWith("[")
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
        <span className="shrink-0 px-1 py-0.2 rounded-xs text-[9px] font-mono font-bold bg-primary/10 text-primary select-none">
          {isArray ? "[ ]" : "{ }"}
        </span>
        <span className="truncate text-foreground/90 font-mono text-[11px]">
          {renderHighlightedText(trimmed, highlightQuery)}
        </span>
      </span>
    )
  }

  return (
    <span className="block min-w-0 truncate">
      {renderHighlightedText(value, highlightQuery)}
    </span>
  )
}
