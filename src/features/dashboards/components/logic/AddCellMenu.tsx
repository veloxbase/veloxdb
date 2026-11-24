import { useState } from 'react'
import {
  ChartBarIcon,
  CodeIcon,
  NotePencilIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TableIcon,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

type AddCellMenuProps = {
  onAddSql: () => void
  onAddInput: () => void
  onAddChart: () => void
  onAddTable: () => void
  onAddMarkdown: () => void
  className?: string
}

export function AddCellMenu({
  onAddSql,
  onAddInput,
  onAddChart,
  onAddTable,
  onAddMarkdown,
  className,
}: AddCellMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-7 gap-1.5 text-xs ${className ?? ''}`}>
          <PlusIcon className="size-3.5" />
          Add cell
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          onClick={() => {
            setOpen(false)
            onAddSql()
          }}
        >
          <CodeIcon className="size-4 text-primary" />
          <span>SQL Query</span>
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          onClick={() => {
            setOpen(false)
            onAddInput()
          }}
        >
          <SlidersHorizontalIcon className="size-4 text-amber-500" />
          <span>Input / Variable</span>
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          onClick={() => {
            setOpen(false)
            onAddChart()
          }}
        >
          <ChartBarIcon className="size-4 text-emerald-500" />
          <span>Chart Visual</span>
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          onClick={() => {
            setOpen(false)
            onAddTable()
          }}
        >
          <TableIcon className="size-4 text-blue-500" />
          <span>Table Visual</span>
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          onClick={() => {
            setOpen(false)
            onAddMarkdown()
          }}
        >
          <NotePencilIcon className="size-4 text-purple-500" />
          <span>Markdown Note</span>
        </button>
      </PopoverContent>
    </Popover>
  )
}
