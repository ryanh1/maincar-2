import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { EmailTemplateInput, EmailTemplatePatch, EmailTemplateResponse } from '@/lib/emailTypes'

/**
 * What saving a template is called with.
 *
 * One hook, not two, because the Settings form is one form: the same fields,
 * the same validation, the same Save button, whether the rep opened "New
 * template" or clicked an existing row. `templateId` is the only thing that
 * differs, so it is the discriminator rather than a second hook the form would
 * have to choose between at render time.
 *
 * The union is what keeps the two halves honest: creating REQUIRES a name,
 * because the route does and an unnamed template is unpickable, while editing
 * takes any subset — the route writes exactly the keys the body carries, so
 * `{ name }` leaves a long body alone instead of blanking it.
 */
export type SaveEmailTemplateVariables =
  | ({ orgId: string; templateId?: undefined } & EmailTemplateInput)
  | ({ orgId: string; templateId: string } & EmailTemplatePatch)

/**
 * Create a template, or edit one. Any member may edit any template in their org,
 * including one they did not write.
 *
 * **This hook DOES invalidate the templates list, and the draft hooks
 * deliberately do not.** The reason the draft mutations stay out of the cache is
 * that a composer card owns its own text while it is open, so a refetch mid-save
 * would push the server's copy of a body back at an editor the rep is still
 * typing in and reset the caret (tasks/plan-email-composer.md → decision 3).
 * Nothing holds a live caret over a TEMPLATE LIST: the form saves and closes,
 * and the list behind it is a plain read that is now stale. Worse, the list is
 * org-shared, so a teammate's save is a change this client did not make and
 * could not have applied by hand. Invalidating is the normal, correct thing
 * here — the drafts are the exception, not this.
 *
 * `fieldsJson` is never sent. It is derived server-side from the text on every
 * write, and a client-supplied value is stripped.
 *
 * A failed save rejects with an `ApiError` carrying the server's own message —
 * "A template needs a name." on a 400, "Template not found" on a 404 for a
 * template another rep deleted while this one had the form open.
 */
export function useSaveEmailTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orgId, templateId, ...body }: SaveEmailTemplateVariables) => {
      const base = `/api/email/orgs/${orgId}/templates`
      return templateId
        ? jsonFetch<EmailTemplateResponse>(`${base}/${templateId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : jsonFetch<EmailTemplateResponse>(base, {
            method: 'POST',
            body: JSON.stringify(body),
          })
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.templates(variables.orgId) })
    },
  })
}
