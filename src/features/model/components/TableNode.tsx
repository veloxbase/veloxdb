import { useMemo } from 'react'
import { Group, Rect, Text } from 'react-konva'

import type { ColumnInfo } from '@/data/types'
import type { KonvaPalette } from '@/features/model/konva-theme'
import { TABLE_NODE_WIDTH, tableNodeHeight } from '@/features/model/table-node-metrics'

const NODE_WIDTH = TABLE_NODE_WIDTH
const HEADER_H = 40
const ROW_H = 18
const MAX_ROWS = 8
const PAD = 10
const CORNER = 12

type TableNodeProps = {
  x: number
  y: number
  schema: string
  name: string
  columns: ColumnInfo[] | null
  selected: boolean
  palette: KonvaPalette
  onSelect: () => void
  onDragEnd: (x: number, y: number) => void
  onRequestColumns: () => void
}

export function TableNode({
  x,
  y,
  schema,
  name,
  columns,
  selected,
  palette,
  onSelect,
  onDragEnd,
  onRequestColumns,
}: TableNodeProps) {
  const height = useMemo(() => tableNodeHeight(columns), [columns])

  const headerStop = Math.min(Math.max(HEADER_H / height, 0.12), 0.42)

  const rows = columns?.slice(0, MAX_ROWS) ?? []
  const moreCount = columns && columns.length > MAX_ROWS ? columns.length - MAX_ROWS : 0

  const stroke = selected ? palette.borderFocus : palette.border
  const strokeW = selected ? 2 : 1

  return (
    <Group
      x={x}
      y={y}
      draggable
      dragDistance={6}
      onMouseDown={(e) => {
        e.cancelBubble = true
        onSelect()
      }}
      onDragEnd={(e) => {
        onDragEnd(e.target.x(), e.target.y())
      }}
      onDblClick={(e) => {
        e.cancelBubble = true
        onRequestColumns()
      }}
      onTap={(e) => {
        e.cancelBubble = true
        onSelect()
      }}
    >
      <Rect
        width={NODE_WIDTH}
        height={height}
        cornerRadius={CORNER}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: height }}
        fillLinearGradientColorStops={[
          0,
          palette.header,
          headerStop,
          palette.header,
          headerStop,
          palette.card,
          1,
          palette.card,
        ]}
        stroke={stroke}
        strokeWidth={strokeW}
        shadowColor={palette.shadow}
        shadowBlur={selected ? 18 : 14}
        shadowOffset={{ x: 0, y: selected ? 6 : 4 }}
        shadowOpacity={1}
        listening={false}
        perfectDrawEnabled={false}
      />
      <Text
        x={PAD}
        y={11}
        width={NODE_WIDTH - PAD * 2}
        text={name}
        fontSize={13}
        fontStyle="bold"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fill={palette.foreground}
        listening={false}
        perfectDrawEnabled={false}
        ellipsis
      />
      <Text
        x={PAD}
        y={28}
        width={NODE_WIDTH - PAD * 2}
        text={schema}
        fontSize={11}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fill={palette.mutedForeground}
        listening={false}
        perfectDrawEnabled={false}
        ellipsis
      />
      {columns == null ? (
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
            <Text
              key={col.columnName}
              x={PAD}
              y={HEADER_H + 8 + i * ROW_H}
              width={NODE_WIDTH - PAD * 2}
              text={`${col.columnName}  ·  ${col.dataType}`}
              fontSize={11}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill={palette.foreground}
              listening={false}
              perfectDrawEnabled={false}
              ellipsis
            />
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
