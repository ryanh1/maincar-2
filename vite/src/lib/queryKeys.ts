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
    // The member list also keys on its query, because paging, sorting, and
    // searching happen on the SERVER: two different pages are two different
    // answers, and sharing one cache entry would show page 1 while page 2 loads.
    members: (orgId: string, query?: Record<string, unknown>) =>
      ['orgs', 'members', orgId, query ?? {}] as const,
    membersAll: (orgId: string) => ['orgs', 'members', orgId] as const,
    invitations: (orgId: string) => ['orgs', 'invitations', orgId] as const,
  },
  invitations: {
    all: ['invitations'] as const,
    // Keyed by token, not by org: the reader of this one has no org yet.
    public: (token: string) => ['invitations', 'public', token] as const,
  },
} as const
