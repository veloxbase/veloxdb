import type { Dashboard, DashboardPage, DashboardStory } from '@/data/types'

export function dashboardPages(dashboard: Dashboard): DashboardPage[] {
  if (dashboard.pages && dashboard.pages.length > 0) return dashboard.pages
  return [{
    id: 'page_overview',
    name: 'Overview',
    widgetIds: dashboard.layout.map((slot) => slot.i),
  }]
}

export function pageForId(dashboard: Dashboard, pageId: string | null): DashboardPage {
  const pages = dashboardPages(dashboard)
  return pages.find((page) => page.id === pageId) ?? pages[0]
}

export function filterDashboardToPage(dashboard: Dashboard, pageId: string | null): Dashboard {
  const page = pageForId(dashboard, pageId)
  const ids = new Set(page.widgetIds)
  return {
    ...dashboard,
    layout: dashboard.layout.filter((slot) => ids.has(slot.i)),
  }
}

export function addDashboardPage(dashboard: Dashboard, name = 'New page'): Dashboard {
  const pages = dashboardPages(dashboard)
  const page: DashboardPage = { id: crypto.randomUUID(), name, widgetIds: [] }
  return { ...dashboard, pages: [...pages, page], updatedAt: Date.now() }
}

export function renameDashboardPage(dashboard: Dashboard, pageId: string, name: string): Dashboard {
  return {
    ...dashboard,
    pages: dashboardPages(dashboard).map((page) => (page.id === pageId ? { ...page, name } : page)),
    updatedAt: Date.now(),
  }
}

export function assignWidgetToPage(dashboard: Dashboard, pageId: string, widgetId: string): Dashboard {
  const pages = dashboardPages(dashboard).map((page) => {
    if (page.id !== pageId) return page
    if (page.widgetIds.includes(widgetId)) return page
    return { ...page, widgetIds: [...page.widgetIds, widgetId] }
  })
  return { ...dashboard, pages, updatedAt: Date.now() }
}

export function emptyStory(title: string): DashboardStory {
  return { id: crypto.randomUUID(), title, beats: [] }
}
