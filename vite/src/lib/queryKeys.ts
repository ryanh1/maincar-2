import type { EmailTemplateListQuery } from './emailTypes'

/**
 * The centralized React Query key registry.
 *
 * ALWAYS import from here. Never inline a key array in a component or hook — one
 * typo between the `useQuery` key and the `invalidateQueries` key produces a
 * cache that silently never refreshes, and nothing fails loudly enough to notice
 * (CLAUDE.md → Frontend Data Fetching Patterns → Query Keys).
 */
export const queryKeys = {
  callAlertSettings: ['callAlertSettings'] as const,
  keyboardBindings: ['keyboardBindings'] as const,
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
    teams: (orgId: string, query?: Record<string, unknown>) =>
      ['orgs', 'teams', orgId, query ?? {}] as const,
    invitations: (orgId: string) => ['orgs', 'invitations', orgId] as const,
  },
  teams: {
    all: (orgId: string) => ['teams', orgId] as const,
    list: (orgId: string, query?: Record<string, unknown>) =>
      ['teams', orgId, 'list', query ?? {}] as const,
  },
  email: {
    all: ['email'] as const,
    // Keyed by org, like the member list, because a draft belongs to one org and
    // switching orgs must read a different cache entry rather than show the
    // previous org's half-written emails. Not keyed by user: the cache is
    // cleared on sign-out, so one signed-in rep only ever sees their own rows.
    drafts: (orgId: string) => ['email', 'drafts', orgId] as const,
    // The bare organization key is deliberately the prefix for every template
    // list. Mutations invalidate it to refresh every visible scope and page,
    // while a read adds its complete server query so private data cannot satisfy
    // an organization-only request (or vice versa).
    templates: (orgId: string, query?: EmailTemplateListQuery) =>
      query ? (['email', 'templates', orgId, query] as const) : (['email', 'templates', orgId] as const),
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
  tasks: {
    all: (orgId: string) => ['tasks', orgId] as const,
    list: (orgId: string, query: Record<string, unknown> = {}) => ['tasks', orgId, 'list', query] as const,
  },
  recordingPolicy: (orgId: string) => ['recordingPolicy', orgId] as const,
  inboundForwarding: (orgId: string) => ['inboundForwarding', orgId] as const,
  captureSettings: (orgId: string) => ['captureSettings', orgId] as const,
  dispositions: (orgId: string) => ['dispositions', orgId] as const,
  nextSteps: {
    all: (orgId: string) => ['nextSteps', orgId] as const,
    types: (orgId: string) => ['nextSteps', orgId, 'types'] as const,
    rules: (orgId: string) => ['nextSteps', orgId, 'rules'] as const,
  },
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
    // The bare list is the caller-ID picker's complete inventory. It deliberately
    // prefixes every paginated caller table query so a number mutation refreshes
    // the picker and every visible page together.
    list: (orgId: string) => ['phoneNumbers', 'list', orgId] as const,
    listPage: (orgId: string, query: Record<string, unknown>) =>
      ['phoneNumbers', 'list', orgId, query] as const,
    // The admin-only org-wide view. A separate key from `list` above: they are
    // different server routes with different shapes (every number vs. mine
    // alone), so a write to one must not be mistaken for satisfying the other.
    orgList: (orgId: string) => ['phoneNumbers', 'orgList', orgId] as const,
    orgListPage: (orgId: string, query: Record<string, unknown>) =>
      ['phoneNumbers', 'orgList', orgId, query] as const,
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
    listAll: (orgId: string, objectId: string) => ['records', 'list', orgId, objectId] as const,
    fieldChanges: (orgId: string, objectId: string, days: number) =>
      ['records', 'fieldChanges', orgId, objectId, days] as const,
    fieldHistory: (orgId: string, recordId: string, attribute: string) =>
      ['records', 'fieldHistory', orgId, recordId, attribute] as const,
  },
  savedViews: {
    all: (orgId: string) => ['savedViews', orgId] as const,
    list: (orgId: string, objectId: string) => ['savedViews', orgId, 'list', objectId] as const,
  },
  cellStyles: {
    all: (orgId: string) => ['cellStyles', orgId] as const,
    list: (orgId: string, viewId: string) => ['cellStyles', orgId, 'list', viewId] as const,
  },
  colorRules: {
    all: (orgId: string) => ['colorRules', orgId] as const,
    list: (orgId: string, viewId: string) => ['colorRules', orgId, 'list', viewId] as const,
  },
  detailLayouts: {
    detail: (orgId: string, objectId: string) => ['detailLayouts', orgId, objectId] as const,
  },
  activity: {
    all: ['activity'] as const,
    // Keyed by org and the scope (companyId/personId/dealId): the feed route
    // accepts at most one spine scope, so the pair "which record" + "which
    // page" is the whole identity of a feed read.
    list: (orgId: string, scope: Record<string, unknown>, page: number, filters: object = {}) =>
      ['activity', orgId, scope, page, filters] as const,
  },
  reports: {
    // Reports are scoped to an organization and may change from every lifecycle
    // action, so the domain key is a prefix for the list, detail, and run result.
    all: (orgId: string) => ['reports', orgId] as const,
    list: (orgId: string, query?: Record<string, unknown>) => ['reports', orgId, 'list', query ?? {}] as const,
    detail: (orgId: string, reportId: string) => ['reports', orgId, 'detail', reportId] as const,
    run: (orgId: string, reportId: string, config: unknown) => ['reports', orgId, 'run', reportId, config] as const,
  },
  accountTimeline: {
    all: (orgId: string) => ['accountTimeline', orgId] as const,
    list: (
      orgId: string,
      root: { type: 'company' | 'deal'; id: string },
      params: Record<string, unknown> = {},
    ) => ['accountTimeline', orgId, root, params] as const,
    detail: (orgId: string, root: { type: 'company' | 'deal'; id: string }, eventId: string, params: Record<string, unknown> = {}) =>
      ['accountTimeline', orgId, root, 'detail', eventId, params] as const,
  },
  calendar: {
    all: (orgId: string) => ['calendar', orgId] as const,
    sources: (orgId: string) => ['calendar', orgId, 'sources'] as const,
    events: (orgId: string, query: Record<string, unknown>) => ['calendar', orgId, 'events', query] as const,
  },
} as const
