import type { ChartType } from '@/data/types'
import type { ConnectorPlugin, DatasetProviderPlugin, ChartVizPlugin, KpiVizPlugin, VizPlugin } from '@/features/plugins/types'

const connectors = new Map<string, ConnectorPlugin>()
const datasetProviders = new Map<string, DatasetProviderPlugin>()
const vizPlugins = new Map<string, VizPlugin>()

export function registerConnector(plugin: ConnectorPlugin): void {
  connectors.set(plugin.id, plugin)
}

export function registerDatasetProvider(plugin: DatasetProviderPlugin): void {
  datasetProviders.set(plugin.id, plugin)
}

export function registerViz(plugin: VizPlugin): void {
  vizPlugins.set(plugin.id, plugin)
}

export function getDatasetProvider(id: string): DatasetProviderPlugin | undefined {
  return datasetProviders.get(id)
}

export function listConnectors(): ConnectorPlugin[] {
  return Array.from(connectors.values())
}

export function listDashboardCapableConnectors(): ConnectorPlugin[] {
  return listConnectors().filter((connector) => connector.supportedForDashboards)
}

export function listVizPlugins(): VizPlugin[] {
  return Array.from(vizPlugins.values())
}

export function getVizPlugin(chartType: ChartType): VizPlugin | undefined {
  return listVizPlugins().find((plugin) => plugin.chartType === chartType)
}

export function getChartPlugin(chartType: ChartType): ChartVizPlugin | undefined {
  const plugin = getVizPlugin(chartType)
  return plugin && plugin.chartType !== 'kpi' ? plugin : undefined
}

export function getKpiPlugin(): KpiVizPlugin | undefined {
  const plugin = getVizPlugin('kpi')
  return plugin?.chartType === 'kpi' ? plugin : undefined
}
