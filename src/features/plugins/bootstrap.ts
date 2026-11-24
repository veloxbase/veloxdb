import { builtInConnectors } from '@/features/plugins/builtins/connectors'
import { sqlQueryProvider } from '@/features/plugins/builtins/sql-query-provider'
import { areaPlugin, linePlugin } from '@/features/plugins/builtins/viz/line'
import { barPlugin, horizontalBarPlugin } from '@/features/plugins/builtins/viz/bar'
import { boxPlugin } from '@/features/plugins/builtins/viz/box'
import { comboPlugin } from '@/features/plugins/builtins/viz/combo'
import { donutPlugin, piePlugin } from '@/features/plugins/builtins/viz/pie'
import { gaugePlugin } from '@/features/plugins/builtins/viz/gauge'
import { heatmapPlugin } from '@/features/plugins/builtins/viz/heatmap'
import { histogramPlugin } from '@/features/plugins/builtins/viz/histogram'
import { kpiPlugin } from '@/features/plugins/builtins/viz/kpi'
import { scatterPlugin } from '@/features/plugins/builtins/viz/scatter'
import { treemapPlugin } from '@/features/plugins/builtins/viz/treemap'
import { waterfallPlugin } from '@/features/plugins/builtins/viz/waterfall'
import { registerConnector, registerDatasetProvider, registerViz } from '@/features/plugins/registry'

let registered = false

const builtInVizPlugins = [
  linePlugin,
  areaPlugin,
  barPlugin,
  horizontalBarPlugin,
  piePlugin,
  donutPlugin,
  kpiPlugin,
  scatterPlugin,
  heatmapPlugin,
  histogramPlugin,
  boxPlugin,
  comboPlugin,
  gaugePlugin,
  treemapPlugin,
  waterfallPlugin,
]

/** Idempotent — safe to call multiple times (e.g. hot reload, repeated bootstrap calls). */
export function registerBuiltInPlugins(): void {
  if (registered) return
  registered = true

  for (const connector of builtInConnectors) registerConnector(connector)
  registerDatasetProvider(sqlQueryProvider)
  for (const plugin of builtInVizPlugins) registerViz(plugin)
  // The "table" fallback isn't a VizPlugin — see `viz/table.ts`.
}
