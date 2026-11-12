import { Input } from '@/components/ui/input'
import type { NotebookCell } from '@/data/types'
import { LogicCell } from './LogicCell'

type InputLogicCellProps = {
  cell: Extract<NotebookCell, { type: 'input' }>
  dragHandleProps?: Record<string, unknown>
  onUpdate: (patch: Partial<NotebookCell>) => void
  onDelete: () => void
  onDuplicate?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

export function InputLogicCell({
  cell,
  dragHandleProps,
  onUpdate,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: InputLogicCellProps) {
  return (
    <LogicCell
      cell={cell}
      dragHandleProps={dragHandleProps}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="text-[10px] font-medium uppercase text-muted-foreground">
            Variable Name
          </label>
          <Input
            value={cell.varName}
            onChange={(e) =>
              onUpdate({
                varName: e.target.value.replace(/[^a-zA-Z0-9_]/g, ''),
              })
            }
            placeholder="e.g. country"
            className="mt-0.5 h-7 font-mono text-xs"
          />
        </div>

        <div>
          <label className="text-[10px] font-medium uppercase text-muted-foreground">
            Input Type
          </label>
          <select
            value={cell.inputType}
            onChange={(e) =>
              onUpdate({ inputType: e.target.value as 'text' | 'number' | 'date' | 'dropdown' })
            }
            className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="dropdown">Dropdown</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] font-medium uppercase text-muted-foreground">
            Default Value
          </label>
          <Input
            type={cell.inputType === 'number' ? 'number' : cell.inputType === 'date' ? 'date' : 'text'}
            value={cell.defaultValue}
            onChange={(e) => onUpdate({ defaultValue: e.target.value })}
            placeholder="Default value"
            className="mt-0.5 h-7 text-xs"
          />
        </div>

        {cell.inputType === 'dropdown' ? (
          <div className="sm:col-span-3">
            <label className="text-[10px] font-medium uppercase text-muted-foreground">
              Dropdown Options (comma separated)
            </label>
            <Input
              value={(cell.options ?? []).join(', ')}
              onChange={(e) =>
                onUpdate({
                  options: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="e.g. US, EU, APAC, LATAM"
              className="mt-0.5 h-7 text-xs"
            />
          </div>
        ) : null}
      </div>
    </LogicCell>
  )
}
