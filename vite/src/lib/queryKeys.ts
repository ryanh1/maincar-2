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
  orgs: {
    all: ['orgs'] as const,
    list: () => ['orgs', 'list'] as const,
    detail: (orgId: string) => ['orgs', 'detail', orgId] as const,
    // Members and invitations are keyed BY ORG, so switching orgs reads a
    // different cache entry instead of showing the previous org's people.
    members: (orgId: string) => ['orgs', 'members', orgId] as const,
    invitations: (orgId: string) => ['orgs', 'invitations', orgId] as const,
  },
} as const
