import type { BuilderChartType, ChartEncodings } from '@/features/dashboards/chart-builder-state'
import {
  seriesFieldLabel,
  showsBarLayoutField,
  showsSeriesField,
  showsSizeField,
  usesSingleY,
  xFieldLabel,
  yFieldLabel,
} from '@/features/dashboards/chart-type-labels'
import type { BarLayoutMode } from '@/features/plugins/builtins/viz/shared'
import type { KpiFormat } from '@/features/plugins/types'

const selectClassName =
  'h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'

export type KpiFormatChoice = KpiFormat | 'auto'

type ChartEncodingFieldsProps = {
  idPrefix: string
  chartType: BuilderChartType
  columns: string[]
  encodings: ChartEncodings
  onEncodingsChange: (next: ChartEncodings) => void
  barLayout?: BarLayoutMode
  onBarLayoutChange?: (next: BarLayoutMode) => void
  kpiFormat?: KpiFormatChoice
  onKpiFormatChange?: (next: KpiFormatChoice) => void
}

export function ChartEncodingFields({
  idPrefix,
  chartType,
  columns,
  encodings,
  onEncodingsChange,
  barLayout = 'stack',
  onBarLayoutChange,
  kpiFormat = 'auto',
  onKpiFormatChange,
}: ChartEncodingFieldsProps) {
  const singleY = usesSingleY(chartType)

  return (
    <>
      {chartType === 'kpi' ? (
        <div>
          <label htmlFor={`${idPrefix}-x`} className="mb-1.5 block text-xs text-muted-foreground">
            Period column (optional, enables delta + sparkline)
          </label>
          <select
            id={`${idPrefix}-x`}
            value={encodings.x ?? ''}
            onChange={(event) => onEncodingsChange({ ...encodings, x: event.target.value || null })}
            className={selectClassName}
          >
            <option value="">Auto-detect</option>
            {columns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
        </div>
      ) : null}

      {chartType !== 'kpi' && chartType !== 'gauge' && chartType !== 'histogram' ? (
        <div>
          <label htmlFor={`${idPrefix}-x`} className="mb-1.5 block text-xs text-muted-foreground">
            {xFieldLabel(chartType)}
          </label>
          <select
            id={`${idPrefix}-x`}
            value={encodings.x ?? ''}
            onChange={(event) => onEncodingsChange({ ...encodings, x: event.target.value || null })}
            className={selectClassName}
          >
            {columns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <label htmlFor={`${idPrefix}-y`} className="mb-1.5 block text-xs text-muted-foreground">
          {yFieldLabel(chartType)}
        </label>
        <select
          id={`${idPrefix}-y`}
          multiple={!singleY}
          size={singleY ? undefined : Math.min(4, columns.length)}
          value={singleY ? (encodings.y[0] ?? '') : encodings.y}
          onChange={(event) => {
            if (singleY) {
              const compare = chartType === 'kpi' ? encodings.y[1] : undefined
              const primary = event.target.value
              onEncodingsChange({
                ...encodings,
                y: primary ? (compare && compare !== primary ? [primary, compare] : [primary]) : [],
              })
              return
            }
            const selected = Array.from(event.target.selectedOptions).map((option) => option.value)
            onEncodingsChange({ ...encodings, y: selected })
          }}
          className={singleY ? selectClassName : 'w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'}
        >
          {singleY ? <option value="">Select a column</option> : null}
          {columns.map((column) => (
            <option key={column} value={column}>{column}</option>
          ))}
        </select>
      </div>

      {chartType === 'kpi' ? (
        <>
          <div>
            <label htmlFor={`${idPrefix}-compare`} className="mb-1.5 block text-xs text-muted-foreground">
              Compare to (previous value column)
            </label>
            <select
              id={`${idPrefix}-compare`}
              value={encodings.y[1] ?? ''}
              onChange={(event) => {
                const primary = encodings.y[0]
                const compare = event.target.value
                onEncodingsChange({
                  ...encodings,
                  y: primary ? (compare ? [primary, compare] : [primary]) : compare ? [compare] : [],
                })
              }}
              className={selectClassName}
            >
              <option value="">None</option>
              {columns.filter((column) => column !== encodings.y[0]).map((column) => (
                <option key={column} value={column}>{column}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-format`} className="mb-1.5 block text-xs text-muted-foreground">Format</label>
            <select
              id={`${idPrefix}-format`}
              value={kpiFormat}
              onChange={(event) => onKpiFormatChange?.(event.target.value as KpiFormatChoice)}
              className={selectClassName}
            >
              <option value="auto">Auto (from column name)</option>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="percent">Percent</option>
              <option value="duration">Duration</option>
            </select>
          </div>
        </>
      ) : null}

      {showsSeriesField(chartType) ? (
        <div>
          <label htmlFor={`${idPrefix}-series`} className="mb-1.5 block text-xs text-muted-foreground">
            {seriesFieldLabel(chartType)}
          </label>
          <select
            id={`${idPrefix}-series`}
            value={encodings.series ?? ''}
            onChange={(event) => onEncodingsChange({ ...encodings, series: event.target.value || null })}
            className={selectClassName}
          >
            <option value="">None</option>
            {columns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
        </div>
      ) : null}

      {showsSizeField(chartType) ? (
        <div>
          <label htmlFor={`${idPrefix}-size`} className="mb-1.5 block text-xs text-muted-foreground">Size</label>
          <select
            id={`${idPrefix}-size`}
            value={encodings.size ?? ''}
            onChange={(event) => onEncodingsChange({ ...encodings, size: event.target.value || null })}
            className={selectClassName}
          >
            <option value="">None</option>
            {columns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
        </div>
      ) : null}

      {showsBarLayoutField(chartType) && encodings.series ? (
        <div>
          <label htmlFor={`${idPrefix}-layout`} className="mb-1.5 block text-xs text-muted-foreground">Series layout</label>
          <select
            id={`${idPrefix}-layout`}
            value={barLayout}
            onChange={(event) => onBarLayoutChange?.(event.target.value as BarLayoutMode)}
            className={selectClassName}
          >
            <option value="stack">Stacked</option>
            <option value="group">Grouped</option>
            <option value="normalize">100% stacked</option>
          </select>
        </div>
      ) : null}
    </>
  )
}
