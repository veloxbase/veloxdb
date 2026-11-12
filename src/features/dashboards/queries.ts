import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { Dashboard, SavedQuery, SavedQueryInput } from '@/data/types'
import { migrateDashboard } from '@/features/dashboards/dashboard-migrate'

export function invalidateSavedQueryLists(queryClient: QueryClient, connectionId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries(null) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries(connectionId) })
}

export function invalidateDashboardLists(queryClient: QueryClient, connectionId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboards(null) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboards(connectionId) })
}

// ── Saved queries ──────────────────────────────────────────────

export function useSavedQueriesQuery(connectionId?: string | null) {
  return useQuery({
    queryKey: queryKeys.savedQueries(connectionId),
    queryFn: () => veloxDbRepository.listSavedQueries(connectionId),
    staleTime: 30 * 1000,
  })
}

export function useAllSavedQueriesQuery() {
  return useSavedQueriesQuery(null)
}

export function useSavedQueryQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.savedQuery(id ?? ''),
    queryFn: () => veloxDbRepository.getSavedQuery(id as string),
    enabled: Boolean(id),
  })
}

export function useSaveSavedQueryMutation(options: {
  onSuccess?: (savedQuery: SavedQuery) => void
  onError?: (error: unknown) => void
} = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SavedQueryInput) => veloxDbRepository.saveSavedQuery(input),
    onSuccess: (savedQuery) => {
      invalidateSavedQueryLists(queryClient, savedQuery.connectionId)
      queryClient.setQueryData(queryKeys.savedQuery(savedQuery.id), savedQuery)
      options.onSuccess?.(savedQuery)
    },
    onError: options.onError,
  })
}

export function useDeleteSavedQueryMutation(options: {
  onSuccess?: (id: string) => void
  onError?: (error: unknown, variables: { id: string; connectionId: string }) => void
} = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }: { id: string; connectionId: string }) => veloxDbRepository.deleteSavedQuery(id),
    onSuccess: (_result, { id, connectionId }) => {
      const filter = (old: SavedQuery[] | undefined) => old?.filter((item) => item.id !== id)
      queryClient.setQueryData(queryKeys.savedQueries(null), filter)
      queryClient.setQueryData(queryKeys.savedQueries(connectionId), filter)
      invalidateSavedQueryLists(queryClient, connectionId)
      queryClient.removeQueries({ queryKey: queryKeys.savedQuery(id) })
      options.onSuccess?.(id)
    },
    onError: options.onError,
  })
}

export function useDuplicateSavedQueryMutation(options: {
  onSuccess?: (savedQuery: SavedQuery) => void
  onError?: (error: unknown) => void
} = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => veloxDbRepository.duplicateSavedQuery(id),
    onSuccess: (savedQuery) => {
      invalidateSavedQueryLists(queryClient, savedQuery.connectionId)
      options.onSuccess?.(savedQuery)
    },
    onError: options.onError,
  })
}

// ── Dashboards ─────────────────────────────────────────────────

export function useDashboardsQuery(connectionId?: string | null) {
  return useQuery({
    queryKey: queryKeys.dashboards(connectionId),
    queryFn: async () => {
      const list = await veloxDbRepository.listDashboards(connectionId)
      return list.map((d) => {
        try {
          return migrateDashboard(d)
        } catch {
          return d
        }
      })
    },
    staleTime: 30 * 1000,
  })
}

export function useAllDashboardsQuery() {
  return useDashboardsQuery(null)
}

export function useDashboardQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.dashboard(id ?? ''),
    queryFn: async () => {
      const raw = await veloxDbRepository.getDashboard(id as string)
      if (!raw) return null
      try {
        return migrateDashboard(raw)
      } catch {
        return raw
      }
    },
    enabled: Boolean(id),
  })
}

export function useSaveDashboardMutation(options: {
  onSuccess?: (dashboard: Dashboard) => void
  onError?: (error: unknown) => void
} = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Dashboard) => veloxDbRepository.saveDashboard(input),
    onSuccess: (dashboard) => {
      invalidateDashboardLists(queryClient, dashboard.connectionId)
      queryClient.setQueryData(queryKeys.dashboard(dashboard.id), dashboard)
      options.onSuccess?.(dashboard)
    },
    onError: options.onError,
  })
}

export function useDeleteDashboardMutation(options: {
  onSuccess?: (id: string) => void
  onError?: (error: unknown, variables: { id: string; connectionId: string }) => void
} = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }: { id: string; connectionId: string }) => veloxDbRepository.deleteDashboard(id),
    onSuccess: (_result, { id, connectionId }) => {
      const filter = (old: Dashboard[] | undefined) => old?.filter((item) => item.id !== id)
      queryClient.setQueryData(queryKeys.dashboards(null), filter)
      queryClient.setQueryData(queryKeys.dashboards(connectionId), filter)
      invalidateDashboardLists(queryClient, connectionId)
      queryClient.removeQueries({ queryKey: queryKeys.dashboard(id) })
      options.onSuccess?.(id)
    },
    onError: options.onError,
  })
}

export function useDuplicateDashboardMutation(options: {
  onSuccess?: (dashboard: Dashboard) => void
  onError?: (error: unknown) => void
} = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => veloxDbRepository.duplicateDashboard(id),
    onSuccess: (dashboard) => {
      invalidateDashboardLists(queryClient, dashboard.connectionId)
      options.onSuccess?.(dashboard)
    },
    onError: options.onError,
  })
}
