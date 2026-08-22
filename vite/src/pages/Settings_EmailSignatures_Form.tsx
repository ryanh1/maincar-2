import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { RichTextEditor, type LinkRequest } from '@/components/editor/RichTextEditor'
import { RichTextEditorUrlDialog } from '@/components/editor/RichTextEditor_UrlDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredAsterisk } from '@/components/ui/RequiredAsterisk'
import { useSaveEmailSignature } from '@/hooks/email'
import type { EmailSignature, SaveEmailSignatureVariables } from '@/hooks/email'
import { ApiError } from '@/lib/api'

interface Props { orgId: string; signature: EmailSignature | null; onDone: () => void }

export function Settings_EmailSignatures_Form({ orgId, signature, onDone }: Props) {
  const saveSignature = useSaveEmailSignature()
  const [name, setName] = useState(signature?.name ?? '')
  const [bodyHtml, setBodyHtml] = useState(signature?.bodyHtml ?? '')
  const [isDefault, setIsDefault] = useState(signature?.isDefault ?? false)
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return void toast.error('Name the signature to save it.')
    const variables: SaveEmailSignatureVariables = signature
      ? { orgId, signatureId: signature.id, name: trimmedName, bodyHtml, isDefault }
      : { orgId, name: trimmedName, bodyHtml, isDefault }
    saveSignature.mutate(variables, {
      onSuccess: () => { toast.success('Signature saved.'); onDone() },
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not save the signature. Try again.'),
    })
  }

  return <section className="flex flex-col gap-6">
    <h2 className="text-base font-semibold">{signature ? 'Edit signature' : 'New signature'}</h2>
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex max-w-sm flex-col gap-2">
        <Label htmlFor="signatureName">Name <RequiredAsterisk /></Label>
        <Input id="signatureName" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Signature</span>
        <div className="flex h-64 flex-col overflow-hidden rounded-md border border-border">
          <RichTextEditor label="Signature" placeholder="Write your signature" initialHtml={signature?.bodyHtml ?? ''} onChange={setBodyHtml} onRequestLink={setLinkRequest} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
        Make this my default signature
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saveSignature.isPending}>{saveSignature.isPending ? 'Saving…' : 'Save signature'}</Button>
        <Button type="button" variant="secondary" onClick={onDone} disabled={saveSignature.isPending}>Cancel</Button>
      </div>
    </form>
    <RichTextEditorUrlDialog request={linkRequest} onClose={() => setLinkRequest(null)} />
  </section>
}
