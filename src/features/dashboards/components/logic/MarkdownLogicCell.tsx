import { useState } from 'react'
import { SlidersIcon } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { NotebookCell } from '@/data/types'
import { NoteStylePicker } from '@/features/dashboards/components/notes/NoteStylePicker'
import { parseNoteOptions, type NoteOptions } from '@/features/dashboards/components/notes/note-options'
import { RichNoteEditor } from '@/features/dashboards/components/notes/RichNoteEditor'
import { LogicCell } from './LogicCell'

type MarkdownLogicCellProps = {
  cell: Extract<NotebookCell, { type: 'markdown' }>
  variableValues?: Record<string, string>
  dragHandleProps?: Record<string, unknown>
  onUpdate: (patch: Partial<NotebookCell>) => void
  onDelete: () => void
  onDuplicate?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onToggleShowInApp: () => void
}

export function MarkdownLogicCell({
  cell,
  variableValues = {},
  dragHandleProps,
  onUpdate,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onToggleShowInApp,
}: MarkdownLogicCellProps) {
  const [showOptions, setShowOptions] = useState(false)
  const options: NoteOptions = parseNoteOptions(cell, cell.content)

  const handleOptionsChange = (patch: Partial<NoteOptions>) => {
    onUpdate({
      ...patch,
      content: patch.content !== undefined ? patch.content : cell.content,
    })
  }

  return (
    <LogicCell
      cell={cell}
      dragHandleProps={dragHandleProps}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onToggleShowInApp={onToggleShowInApp}
      statusBadge={
        <Button
          variant={showOptions ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          onClick={() => setShowOptions((p) => !p)}
          title="Customize card style preset and font options"
        >
          <SlidersIcon className="size-3" />
          <span>Style</span>
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Note Title
            </label>
            <Input
              value={cell.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="e.g. Executive Summary"
              className="mt-0.5 h-7 text-xs"
            />
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Card Style Preset
            </label>
            <div className="mt-0.5 flex h-7 items-center truncate rounded-md border border-border bg-muted/20 px-2 text-xs font-medium text-foreground">
              <span className="capitalize">{options.style.replace('-', ' ')}</span>
            </div>
          </div>
        </div>

        {/* Collapsible Style Controls */}
        {showOptions ? (
          <NoteStylePicker
            options={options}
            onChange={handleOptionsChange}
            className="rounded-md border border-border/80 bg-muted/10 p-3"
          />
        ) : null}

        {/* Rich Markdown Authoring Canvas */}
        <RichNoteEditor
          content={cell.content}
          onChange={(content) => onUpdate({ content })}
          variableValues={variableValues}
          fontSize={options.fontSize}
          minHeight="140px"
        />
      </div>
    </LogicCell>
  )
}
