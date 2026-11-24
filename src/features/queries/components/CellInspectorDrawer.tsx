import { useEffect, useMemo, useState } from "react"
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  PencilSimpleIcon,
  TextHIcon,
  XIcon,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { isJsonString } from "@/features/queries/components/CellBadgeRenderer"

type InspectedCell = {
  rowId: string
  columnId: string
  value: string | null
  rowIndex: number
}

type CellInspectorDrawerProps = {
  cell: InspectedCell | null
  isOpen: boolean
  onClose: () => void
  canEdit?: boolean
  onSaveEdit?: (rowId: string, columnId: string, newValue: string) => void
  isSaving?: boolean
}

export function CellInspectorDrawer({
  cell,
  isOpen,
  onClose,
  canEdit = false,
  onSaveEdit,
  isSaving = false,
}: CellInspectorDrawerProps) {
  const [copied, setCopied] = useState(false)
  const [formatJson, setFormatJson] = useState(true)
  const [wordWrap, setWordWrap] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState("")

  useEffect(() => {
    if (cell) {
      setDraftValue(cell.value ?? "")
      setIsEditing(false)
    }
  }, [cell])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isEditing) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, isEditing, onClose])

  const isJson = useMemo(() => isJsonString(cell?.value), [cell?.value])

  const displayContent = useMemo(() => {
    if (!cell || cell.value === null) return "NULL"
    if (cell.value === "") return ""
    if (isJson && formatJson) {
      try {
        const parsed = JSON.parse(cell.value)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return cell.value
      }
    }
    return cell.value
  }, [cell, isJson, formatJson])

  const handleCopy = async () => {
    if (!cell) return
    const textToCopy = displayContent === "NULL" ? "" : displayContent
    await navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const handleSaveEdit = () => {
    if (!cell || !onSaveEdit) return
    onSaveEdit(cell.rowId, cell.columnId, draftValue)
    setIsEditing(false)
  }

  if (!isOpen || !cell) {
    return null
  }

  const charCount = cell.value?.length ?? 0

  return (
    <div className="flex h-full w-80 sm:w-96 shrink-0 flex-col border-l border-border bg-background shadow-lg transition-all">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold text-foreground">Cell Inspector</span>
          <span className="truncate rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {cell.columnId}
          </span>
          <span className="rounded-xs bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            #{cell.rowIndex + 1}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close cell inspector"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {/* Action Sub-bar */}
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/10 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {cell.value === null ? (
            <span className="font-mono text-muted-foreground/70">NULL</span>
          ) : isJson ? (
            <span className="font-mono font-medium text-primary">JSON Object</span>
          ) : (
            <span>{charCount.toLocaleString()} chars</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isJson && !isEditing ? (
            <Button
              variant={formatJson ? "secondary" : "ghost"}
              size="icon-xs"
              onClick={() => setFormatJson(!formatJson)}
              title={formatJson ? "Show raw JSON" : "Prettify JSON"}
            >
              <CodeIcon className="size-3" />
            </Button>
          ) : null}

          {!isEditing ? (
            <Button
              variant={wordWrap ? "secondary" : "ghost"}
              size="icon-xs"
              onClick={() => setWordWrap(!wordWrap)}
              title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            >
              <TextHIcon className="size-3" />
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleCopy}
            title="Copy cell value"
          >
            {copied ? (
              <CheckIcon className="size-3 text-emerald-500" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </Button>

          {canEdit && !isEditing ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setDraftValue(cell.value ?? "")
                setIsEditing(true)
              }}
              title="Edit value in inspector"
            >
              <PencilSimpleIcon className="size-3" />
              <span>Edit</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Body Content */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {isEditing ? (
          <div className="flex h-full flex-col gap-2">
            <textarea
              className="flex-1 resize-none rounded-none border border-border bg-background p-2 font-mono text-xs text-foreground outline-none focus:border-ring"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder="Enter cell value or leave empty for NULL..."
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="xs"
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                onClick={handleSaveEdit}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Apply"}
              </Button>
            </div>
          </div>
        ) : (
          <pre
            className={`font-mono text-xs text-foreground select-text ${
              wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
            } ${cell.value === null ? "italic text-muted-foreground" : ""}`}
          >
            {displayContent}
          </pre>
        )}
      </div>

      {/* Footer Info */}
      <div className="border-t border-border bg-muted/10 px-3 py-1.5 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>Row ID: {cell.rowId}</span>
        <span>UTF-8</span>
      </div>
    </div>
  )
}
