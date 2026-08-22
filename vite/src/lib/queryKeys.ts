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
  email: {
    all: ['email'] as const,
    // Keyed by org, like the member list, because a draft belongs to one org and
    // switching orgs must read a different cache entry rather than show the
    // previous org's half-written emails. Not keyed by user: the cache is
    // cleared on sign-out, so one signed-in rep only ever sees their own rows.
    drafts: (orgId: string) => ['email', 'drafts', orgId] as const,
    // Keyed by org only, like the drafts list, and for a stronger reason: a
    // template belongs to the ORG rather than to the rep who wrote it, so every
    // member of an org reads and writes this one entry. There is no per-user
    // key to add — see lib/emailTypes.ts → EmailTemplate.
    templates: (orgId: string) => ['email', 'templates', orgId] as const,
    // The server scopes a signature to the authenticated rep, and a signed-in
    // browser has one rep at a time. The org still belongs in the key because it
    // is part of the verified request path and changes with the active context.
    signatures: (orgId: string) => ['email', 'signatures', orgId] as const,
  },
  calls: {
    all: ['calls'] as const,
    // Keyed by org AND the list query, like the member list, because paging,
    // sorting, and searching happen on the SERVER: two different pages are two
    // different answers, so they must not share one cache entry. Switching orgs
    // reads a different entry rather than showing the previous org's history.
    list: (orgId: string, query?: Record<string, unknown>) =>
      ['calls', 'list', orgId, query ?? {}] as const,
    // Keyed by org and call id: the detail route scopes the lookup to both, so
    // the cache entry does too.
    detail: (orgId: string, callId: string) => ['calls', 'detail', orgId, callId] as const,
    // Keyed by org only: one Voice SDK Device per rep per org, so one cached
    // token per org is what the Device lifecycle actually needs.
    voiceToken: (orgId: string) => ['calls', 'voiceToken', orgId] as const,
  },
  recordingPolicy: (orgId: string) => ['recordingPolicy', orgId] as const,
  voicemails: {
    all: ['voicemails'] as const,
    list: (orgId: string, query?: Record<string, unknown>) =>
      ['voicemails', 'list', orgId, query ?? {}] as const,
    detail: (orgId: string, voicemailId: string) =>
      ['voicemails', 'detail', orgId, voicemailId] as const,
  },
  voicemailGreeting: {
    all: ['voicemailGreeting'] as const,
    detail: (orgId: string) => ['voicemailGreeting', orgId] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (orgId: string, query?: Record<string, unknown>) =>
      ['notifications', 'list', orgId, query ?? {}] as const,
  },
  phoneNumbers: {
    all: ['phoneNumbers'] as const,
    // Keyed by org only, not by any query: the list is not paginated (the route
    // returns every number the caller owns so the caller-ID picker can show them
    // all), so there is one answer per org. Switching orgs reads a different
    // entry rather than showing the previous org's numbers. Searching Twilio's
    // for-sale numbers is a mutation, not a cached read, so it has no key here.
    list: (orgId: string) => ['phoneNumbers', 'list', orgId] as const,
    // The admin-only org-wide view. A separate key from `list` above: they are
    // different server routes with different shapes (every number vs. mine
    // alone), so a write to one must not be mistaken for satisfying the other.
    orgList: (orgId: string) => ['phoneNumbers', 'orgList', orgId] as const,
  },
  invitations: {
    all: ['invitations'] as const,
    // Keyed by token, not by org: the reader of this one has no org yet.
    public: (token: string) => ['invitations', 'public', token] as const,
  },
  integrations: {
    // Keyed by org, like the member list, because a rep's connections belong to one
    // org and switching orgs must read a different cache entry rather than show the
    // previous org's cards. The org comes FIRST, before `list` / `health`, so that
    // `all(orgId)` is a prefix of both — invalidating it after a Connect, Test,
    // Refresh, or Disconnect refreshes the cards AND the health badge in one call.
    all: (orgId: string) => ['integrations', orgId] as const,
    list: (orgId: string) => ['integrations', orgId, 'list'] as const,
    health: (orgId: string) => ['integrations', orgId, 'health'] as const,
  },
  mailboxes: {
    // Keyed by org, like the integrations cards, because a rep's send-from addresses
    // belong to one org and switching orgs must read a different cache entry rather
    // than show the previous org's mailboxes. The org comes FIRST, before `list`, so
    // `all(orgId)` is a prefix of the list — a rename can invalidate the whole domain
    // in one call, the way `integrations.all` covers both cards and badge.
    all: (orgId: string) => ['mailboxes', orgId] as const,
    list: (orgId: string) => ['mailboxes', orgId, 'list'] as const,
  },
  crm: {
    all: (orgId: string) => ['crm', orgId] as const,
    objects: (orgId: string) => ['crm', orgId, 'objects'] as const,
    lists: (orgId: string) => ['crm', orgId, 'lists'] as const,
    list: (orgId: string, listId: string) => ['crm', orgId, 'lists', listId] as const,
    listEntries: (orgId: string, listId: string) => ['crm', orgId, 'lists', listId, 'entries'] as const,
  },
  objects: {
    all: ['objects'] as const,
    // Keyed by org: the schema (which objects, which fields) is per-tenant.
    list: (orgId: string) => ['objects', 'list', orgId] as const,
    // Keyed by org and object id: a detail read carries the live attribute set,
    // which a list read does not.
    detail: (orgId: string, objectId: string) => ['objects', 'detail', orgId, objectId] as const,
  },
  records: {
    all: ['records'] as const,
    // Keyed by org, object, AND the list query (sort), like the call history list:
    // rows are windowed and sorted on the SERVER, so a different sort is a
    // different answer and must not share a cache entry.
    list: (orgId: string, objectId: string, query?: Record<string, unknown>) =>
      ['records', 'list', orgId, objectId, query ?? {}] as const,
  },
  activity: {
    all: ['activity'] as const,
    // Keyed by org and the scope (companyId/personId/dealId): the feed route
    // accepts at most one spine scope, so the pair "which record" + "which
    // page" is the whole identity of a feed read.
    list: (orgId: string, scope: Record<string, unknown>, page: number) =>
      ['activity', orgId, scope, page] as const,
  },
  reports: {
    // Reports are scoped to an organization and may change from every lifecycle
    // action, so the domain key is a prefix for the list, detail, and run result.
    all: (orgId: string) => ['reports', orgId] as const,
    list: (orgId: string, query?: Record<string, unknown>) => ['reports', orgId, 'list', query ?? {}] as const,
    detail: (orgId: string, reportId: string) => ['reports', orgId, 'detail', reportId] as const,
    run: (orgId: string, reportId: string) => ['reports', orgId, 'run', reportId] as const,
  },
} as const
