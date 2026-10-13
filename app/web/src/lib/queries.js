// Server data via TanStack Query: cached, shared between pages, refetched after changes.
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Don't retry "not found" or "sign in required"; those won't fix themselves.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

export const keys = {
  me: ['me'],
  workspaces: ['workspaces'],
  boards: (workspaceId) => ['boards', workspaceId],
  board: (id) => ['board', id],
  tasks: (boardId) => ['tasks', boardId],
};

// null when signed out (401), the user otherwise.
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () =>
      api.me().then(
        ({ user }) => user,
        (err) => {
          if (err instanceof ApiError && err.status === 401) return null;
          throw err;
        },
      ),
    staleTime: 5 * 60_000,
  });
}

export const useWorkspaces = () => useQuery({ queryKey: keys.workspaces, queryFn: api.workspaces });

export const useBoards = (workspaceId) =>
  useQuery({ queryKey: keys.boards(workspaceId), queryFn: () => api.boards(workspaceId), enabled: Boolean(workspaceId) });

export const useBoard = (id) => useQuery({ queryKey: keys.board(id), queryFn: () => api.board(id), enabled: Boolean(id) });

export const useTasks = (boardId) =>
  useQuery({ queryKey: keys.tasks(boardId), queryFn: () => api.tasks(boardId), enabled: Boolean(boardId) });

// A mutation that refreshes the given query keys when it succeeds.
export function useAction(fn, { invalidate = [], onSuccess } = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, variables) => {
      await Promise.all(invalidate.map((queryKey) => client.invalidateQueries({ queryKey })));
      onSuccess?.(data, variables);
    },
  });
}
