import { memo, useMemo } from 'react'
import { Group, Rect, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'

import type { ColumnInfo } from '@/data/types'
import type { KonvaPalette } from '@/features/model/konva-theme'
import type { ColumnDetailLevel } from '@/features/model/model-types'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'
import { contrastTextForBg } from '@/lib/contrast-text-for-bg'
import type { DiagramTool } from '@/features/model/use-diagram-interaction'

const NODE_WIDTH = TABLE_NODE_WIDTH
const HEADER_H = 40
const ROW_H = 18
const MAX_ROWS = 8
const PAD = 10
/** Reserved width for right-aligned data type column (db-diagram style). */
const TYPE_COL_W = 80

export type TableNodeProps = {
  x: number
  y: number
  schema: string
  name: string
  columns: ColumnInfo[] | null
  selected: boolean
  diagramTool: DiagramTool
  palette: KonvaPalette
  /** Custom header gradient top color (`#rrggbb`); theme default when omitted. */
  headerFill?: string
  /** When true, node is not draggable; used with Space-held canvas pan. */
  spaceHeld?: boolean
  onBeginCanvasPan?: (clientX: number, clientY: number) => void
  onSelect: (shiftKey: boolean) => void
  onDragStart?: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onRequestColumns: () => void
  onConnectColumnPointerDown?: (columnName: string, e: KonvaEventObject<MouseEvent>) => void
  onConnectColumnPointerUp?: (columnName: string, e: KonvaEventObject<MouseEvent>) => void
  columnDetail?: ColumnDetailLevel
  /** Column names to emphasize (e.g. FK edge hover). */
  highlightColumnNames?: ReadonlySet<string>
}

function TableNodeInner({
  x,
  y,
  schema,
  name,
  columns,
  selected,
  diagramTool,
  palette,
  headerFill,
  spaceHeld = false,
  onBeginCanvasPan,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRequestColumns,
  onConnectColumnPointerDown,
  onConnectColumnPointerUp,
  columnDetail = 'full',
  highlightColumnNames,
}: TableNodeProps) {
  const height = useMemo(
    () => tableNodeHeight(columns, columnDetail),
    [columns, columnDetail],
  )

  const headerStop = Math.min(Math.max(HEADER_H / height, 0.12), 0.42)

  const rows = columns?.slice(0, MAX_ROWS) ?? []
  const moreCount = columns && columns.length > MAX_ROWS ? columns.length - MAX_ROWS : 0

  const stroke = selected ? palette.borderFocus : palette.border
  const strokeW = selected ? 2 : 1

  const bandHeaderFill = headerFill ?? palette.header
  const headerNameFill = headerFill ? contrastTextForBg(headerFill) : palette.foreground
  const headerTitle = useMemo(() => `${name} (${schema})`, [name, schema])

  const draggable = !spaceHeld && diagramTool === 'select'
  const showConnectColumns =
    diagramTool === 'connect' &&
    columnDetail !== 'header' &&
    columns != null &&
    columns.length > 0

  return (
    <Group
      x={x}
      y={y}
      draggable={draggable}
      dragDistance={8}
      onMouseDown={(e) => {
        if (spaceHeld && onBeginCanvasPan && e.evt.button === 0) {
          onBeginCanvasPan(e.evt.clientX, e.evt.clientY)
          e.cancelBubble = true
          return
        }
        e.cancelBubble = true
        onSelect(e.evt.shiftKey)
      }}
      onDragStart={() => {
        onDragStart?.()
      }}
      onDragMove={(e) => {
        onDragMove?.(e.target.x(), e.target.y())
      }}
      onDragEnd={(e) => {
        onDragEnd(e.target.x(), e.target.y())
      }}
      onDblClick={(e) => {
        e.cancelBubble = true
        // Focus this table for inspector + canvas highlight (dblclick alone does not replay click).
        onSelect(false)
        onRequestColumns()
      }}
      onDblTap={(e) => {
        e.cancelBubble = true
        onSelect(false)
        onRequestColumns()
      }}
      onTap={(e) => {
        e.cancelBubble = true
        onSelect(false)
      }}
    >
      <Rect
        width={NODE_WIDTH}
        height={height}
        cornerRadius={palette.cornerRadiusPx}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: height }}
        fillLinearGradientColorStops={[
          0,
          bandHeaderFill,
          headerStop,
          bandHeaderFill,
          headerStop,
          palette.card,
          1,
          palette.card,
        ]}
        stroke={stroke}
        strokeWidth={strokeW}
        shadowColor={palette.shadow}
        shadowBlur={selected ? 10 : 8}
        shadowOffset={{ x: 0, y: selected ? 3 : 2 }}
        shadowOpacity={1}
        listening
        perfectDrawEnabled={false}
      />
      <Text
        x={PAD}
        y={12}
        width={NODE_WIDTH - PAD * 2}
        text={headerTitle}
        fontSize={13}
        fontStyle="bold"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fill={headerNameFill}
        listening={false}
        perfectDrawEnabled={false}
        ellipsis
      />
      {columnDetail === 'header' ? null : columns == null ? (
        <Text
          x={PAD}
          y={HEADER_H + 8}
          width={NODE_WIDTH - PAD * 2}
          text="Double-click to load columns"
          fontSize={11}
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fill={palette.mutedForeground}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : (
        <>
          {rows.map((col, i) => (
            <Group key={col.columnName}>
              {showConnectColumns ? (
                <Rect
                  x={PAD}
                  y={HEADER_H + 4 + i * ROW_H}
                  width={NODE_WIDTH - PAD * 2}
                  height={ROW_H}
                  fill="rgba(0,0,0,0.001)"
                  onMouseDown={(e) => {
                    e.cancelBubble = true
                    onConnectColumnPointerDown?.(col.columnName, e)
                  }}
                  onMouseUp={(e) => {
                    e.cancelBubble = true
                    onConnectColumnPointerUp?.(col.columnName, e)
                  }}
                  perfectDrawEnabled={false}
                />
              ) : null}
              <Text
                x={PAD}
                y={HEADER_H + 8 + i * ROW_H}
                width={NODE_WIDTH - PAD * 2 - TYPE_COL_W}
                text={col.columnName}
                fontSize={12}
                fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
                fill={
                  highlightColumnNames?.has(col.columnName) ? palette.borderFocus : palette.foreground
                }
                listening={false}
                perfectDrawEnabled={false}
                ellipsis
              />
              <Text
                x={NODE_WIDTH - PAD - TYPE_COL_W}
                y={HEADER_H + 8 + i * ROW_H}
                width={TYPE_COL_W}
                text={col.dataType}
                align="right"
                fontSize={11}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill={palette.mutedForeground}
                listening={false}
                perfectDrawEnabled={false}
                ellipsis
              />
            </Group>
          ))}
          {moreCount > 0 ? (
            <Text
              x={PAD}
              y={HEADER_H + 8 + rows.length * ROW_H}
              width={NODE_WIDTH - PAD * 2}
              text={`+${moreCount} more`}
              fontSize={10}
              fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
              fill={palette.mutedForeground}
              listening={false}
              perfectDrawEnabled={false}
            />
          ) : null}
        </>
      )}
    </Group>
  )
}

export const TableNode = memo(TableNodeInner)
