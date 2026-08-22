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

interface Props {
  orgId: string
  signature: EmailSignature | null
  onSaved: (signature: EmailSignature) => void
  onCancel: () => void
}

export function Settings_EmailSignatures_Form({ orgId, signature, onSaved, onCancel }: Props) {
  const saveSignature = useSaveEmailSignature()
  const [name, setName] = useState(signature?.name ?? '')
  const [bodyHtml, setBodyHtml] = useState(signature?.bodyHtml ?? '')
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return void toast.error('Name the signature to save it.')
    const variables: SaveEmailSignatureVariables = signature
      ? { orgId, signatureId: signature.id, name: trimmedName, bodyHtml }
      : { orgId, name: trimmedName, bodyHtml }
    saveSignature.mutate(variables, {
      onSuccess: ({ signature: savedSignature }) => {
        toast.success('Signature saved.')
        onSaved(savedSignature)
      },
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not save the signature. Try again.'),
    })
  }

  return <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex max-w-sm flex-col gap-1">
        <Label htmlFor="signatureName">Name <RequiredAsterisk /></Label>
        <Input id="signatureName" className="h-8" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Signature</span>
        <div className="flex h-64 flex-col overflow-hidden rounded-md border border-border">
          <RichTextEditor label="Signature" placeholder="Write your signature" initialHtml={signature?.bodyHtml ?? ''} onChange={setBodyHtml} onRequestLink={setLinkRequest} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saveSignature.isPending}>{saveSignature.isPending ? 'Saving…' : 'Save signature'}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={saveSignature.isPending}>Cancel</Button>
      </div>
    <RichTextEditorUrlDialog request={linkRequest} onClose={() => setLinkRequest(null)} />
  </form>
}
