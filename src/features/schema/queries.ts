import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { TableInfo, TablePropertiesApplyRequest } from '@/data/types'

type UseTableIndexesQueryArgs = {
  connectionId: string | undefined
  table: TableInfo | null
  enabled: boolean
}

export function useTableIndexesQuery({ connectionId, table, enabled }: UseTableIndexesQueryArgs) {
  return useQuery({
    queryKey: queryKeys.tableIndexes(connectionId, table),
    queryFn: () => {
      if (!table) {
        throw new Error('Table is required for indexes query.')
      }
      return veloxDbRepository.getTableIndexes(connectionId, table)
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

type UseTableSchemaQueryArgs = {
  connectionId: string | undefined
  table: TableInfo | null
  enabled: boolean
}

export function useTableSchemaQuery({ connectionId, table, enabled }: UseTableSchemaQueryArgs) {
  return useQuery({
    queryKey: queryKeys.schema(connectionId, table),
    queryFn: () => {
      if (!table) {
        // Should never happen when `enabled` is correctly wired.
        throw new Error('Table is required for schema query.')
      }
      return veloxDbRepository.getSchema(connectionId, table)
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

type UseTablePropertiesQueryArgs = {
  connectionId: string | undefined
  table: TableInfo | null
  enabled: boolean
}

export function useTablePropertiesQuery({
  connectionId,
  table,
  enabled,
}: UseTablePropertiesQueryArgs) {
  return useQuery({
    queryKey: queryKeys.tableProperties(connectionId, table),
    queryFn: () => {
      if (!table) {
        // Should never happen when `enabled` is correctly wired.
        throw new Error('Table is required for table properties query.')
      }

      return veloxDbRepository.getTableProperties(connectionId, table)
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useApplyTablePropertiesMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: TablePropertiesApplyRequest) =>
      veloxDbRepository.applyTableProperties(request),
    onSuccess: (_data, variables) => {
      const table: TableInfo = {
        schema: variables.tableSchema,
        name: variables.tableName,
        previewQuery: '',
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.tableProperties(variables.connectionId, table) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.schema(variables.connectionId, table) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.foreignKeys(variables.connectionId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tableIndexes(variables.connectionId, table) })
    },
  })
}

