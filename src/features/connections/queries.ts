import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import { shouldRetryTransientDbInvoke } from '@/lib/transient-invoke-retry'
import type { ConnectionInput, ConnectionSummary, SwitchDatabaseRequest } from '@/data/types'

export function useConnectionsQuery() {
  return useQuery({
    queryKey: queryKeys.connections(),
    queryFn: () => veloxDbRepository.listConnections(),
    staleTime: 30 * 1000,
  })
}

type UseConnectMutationOptions = {
  onSuccess?: (connection: ConnectionSummary, input: ConnectionInput) => void
  onError?: (error: unknown, input: ConnectionInput) => void
}

type ConnectContext = {
  previousConnections?: ConnectionSummary[]
  tempId: string
}

export function useConnectMutation(options: UseConnectMutationOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ConnectionInput) => veloxDbRepository.connectDb(input),
    onMutate: (input) => {
      const previousConnections =
        queryClient.getQueryData<ConnectionSummary[]>(queryKeys.connections())

      const tempId = `temp_${Date.now()}`
      const optimistic: ConnectionSummary = {
        id: tempId,
        name: input.name,
        engine: input.engine,
        host: input.host,
        port: input.port,
        database: input.database,
        filePath: input.filePath ?? null,
        user: input.user,
        connectedAt: new Date().toISOString(),
        sslMode: input.sslMode,
        sshConfig: input.sshConfig ?? null,
        extraParams: input.extraParams ?? null,
        tablePropertyEditingSupported: input.engine === 'postgres',
      }

      queryClient.setQueryData<ConnectionSummary[]>(queryKeys.connections(), (current) => {
        const existing = current ?? []
        const filtered = existing.filter(
          (c) =>
            c.id !== tempId &&
            !(
              c.name === input.name &&
              c.host === input.host &&
              c.port === input.port &&
              c.database === input.database &&
              c.user === input.user
            ),
        )
        return [optimistic, ...filtered]
      })

      return { previousConnections, tempId } satisfies ConnectContext
    },
    onError: (error, input, context) => {
      if (context) {
        if (context.previousConnections) {
          queryClient.setQueryData(queryKeys.connections(), context.previousConnections)
        } else {
          queryClient.removeQueries({ queryKey: queryKeys.connections() })
        }
      }
      options.onError?.(error, input)
    },
    onSuccess: (nextConnection, input, context) => {
      queryClient.setQueryData<ConnectionSummary[]>(queryKeys.connections(), (current) => {
        const existing = current ?? []
        const filtered = existing.filter(
          (c) => c.id !== nextConnection.id && c.id !== context?.tempId,
        )
        return [nextConnection, ...filtered]
      })

      // Reconcile with authoritative data from backend.
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections() })

      options.onSuccess?.(nextConnection, input)
    },
  })
}

type UseActivateConnectionMutationOptions = {
  onSuccess?: (connection: ConnectionSummary) => void
  onError?: (error: unknown, connectionId: string) => void
}

export function useActivateConnectionMutation(
  options: UseActivateConnectionMutationOptions = {},
) {
  const queryClient = useQueryClient()

  return useMutation({
    retry: shouldRetryTransientDbInvoke,
    mutationFn: (connectionId: string) =>
      veloxDbRepository.setActiveConnection(connectionId),
    onError: (error, connectionId) => {
      options.onError?.(error, connectionId)
    },
    onSuccess: (nextConnection) => {
      // Keep connections list consistent (e.g. connectedAt/name changes).
      queryClient.setQueryData<ConnectionSummary[]>(queryKeys.connections(), (current) => {
        const existing = current ?? []
        const filtered = existing.filter((c) => c.id !== nextConnection.id)
        return [nextConnection, ...filtered]
      })

      void queryClient.invalidateQueries({ queryKey: queryKeys.connections() })
      options.onSuccess?.(nextConnection)
    },
  })
}

type UseDisconnectMutationOptions = {
  onSuccess?: (connectionId: string) => void
  onError?: (error: unknown, connectionId: string) => void
}

export function useDisconnectMutation(options: UseDisconnectMutationOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (connectionId: string) =>
      veloxDbRepository.disconnectDb(connectionId),
    onSuccess: (_result, connectionId) => {
      queryClient.setQueryData<ConnectionSummary[]>(
        queryKeys.connections(),
        (current) => {
          const existing = current ?? []
          return existing.filter((c) => c.id !== connectionId)
        },
      )
      options.onSuccess?.(connectionId)
    },
    onError: (error, connectionId) => {
      options.onError?.(error, connectionId)
    },
  })
}

type UseRenameConnectionMutationOptions = {
  onSuccess?: (connection: ConnectionSummary) => void
  onError?: (error: unknown) => void
}

export function useRenameConnectionMutation(options: UseRenameConnectionMutationOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ connectionId, newName }: { connectionId: string; newName: string }) =>
      veloxDbRepository.renameConnection(connectionId, newName),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConnectionSummary[]>(queryKeys.connections(), (current) => {
        const existing = current ?? []
        return existing.map((c) => (c.id === updated.id ? updated : c))
      })
      options.onSuccess?.(updated)
    },
    onError: (error) => {
      options.onError?.(error)
    },
  })
}

type UseDeleteConnectionMutationOptions = {
  onSuccess?: (connectionId: string) => void
  onError?: (error: unknown, connectionId: string) => void
}

export function useDeleteConnectionMutation(options: UseDeleteConnectionMutationOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (connectionId: string) =>
      veloxDbRepository.deleteConnection(connectionId),
    onSuccess: (_result, connectionId) => {
      queryClient.setQueryData<ConnectionSummary[]>(
        queryKeys.connections(),
        (current) => {
          const existing = current ?? []
          return existing.filter((c) => c.id !== connectionId)
        },
      )
      options.onSuccess?.(connectionId)
    },
    onError: (error, connectionId) => {
      options.onError?.(error, connectionId)
    },
  })
}


type UseSwitchDatabaseMutationOptions = {
  onSuccess?: (connection: ConnectionSummary) => void
  onError?: (error: unknown, input: SwitchDatabaseRequest) => void
}

export function useSwitchDatabaseMutation(options: UseSwitchDatabaseMutationOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    retry: shouldRetryTransientDbInvoke,
    mutationFn: (input: SwitchDatabaseRequest) =>
      veloxDbRepository.switchDatabase(input),
    onSuccess: (nextConnection) => {
      queryClient.setQueryData<ConnectionSummary[]>(queryKeys.connections(), (current) => {
        const existing = current ?? []
        const filtered = existing.filter((c) => c.id !== nextConnection.id)
        return [nextConnection, ...filtered]
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tables(nextConnection.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.queryEditorMetadata(nextConnection.id) })
      options.onSuccess?.(nextConnection)
    },
    onError: (error, input) => {
      options.onError?.(error, input)
    },
  })
}

export function useDatabasesQuery(connectionId: string | null) {
  return useQuery({
    queryKey: queryKeys.databases(connectionId),
    queryFn: () => veloxDbRepository.listDatabases(connectionId ?? undefined),
    enabled: Boolean(connectionId),
    staleTime: 30 * 1000,
  })
}
