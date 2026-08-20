/**
 * The centralized React Query key registry.
 *
 * ALWAYS import from here. Never inline a key array in a component or hook — one
 * typo between the `useQuery` key and the `invalidateQueries` key produces a
 * cache that silently never refreshes, and nothing fails loudly enough to notice
 * (CLAUDE.md → Frontend Data Fetching Patterns → Query Keys).
 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => ['auth', 'me'] as const,
  },
} as const
