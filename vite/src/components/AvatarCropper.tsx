/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024

export function photoRejection(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Choose a PNG, JPG, or WebP image.'
  if (file.size > MAX_SOURCE_BYTES) return 'Choose an image smaller than 10MB.'
  return null
}

async function exportSquare(source: string, crop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('That image could not be read.'))
    element.src = source
  })
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot prepare the image.')
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, 512, 512)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('That image could not be prepared.')), 'image/png'))
}

export function AvatarCropper({ file, onCancel, onSave, saving }: { file: File | null; onCancel: () => void; onSave: (blob: Blob) => Promise<void>; saving: boolean }) {
  const [source] = useState(() => file ? URL.createObjectURL(file) : null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [pixels, setPixels] = useState<Area | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    return () => { if (source) URL.revokeObjectURL(source) }
  }, [source])
  const complete = useCallback((_area: Area, areaPixels: Area) => setPixels(areaPixels), [])
  async function save() {
    if (!source || !pixels) return
    try { setError(null); await onSave(await exportSquare(source, pixels)) } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the photo. Try again.') }
  }
  return <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onCancel()}><DialogContent><DialogHeader><DialogTitle>Crop your photo</DialogTitle><DialogDescription>Choose the part of the photo to show.</DialogDescription></DialogHeader><div className="relative h-72 overflow-hidden rounded-md border border-border bg-surface-2">{source && <Cropper image={source} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} maxZoom={4} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={complete} />}</div><Slider aria-label="Zoom" min={1} max={4} step={0.05} value={[zoom]} onValueChange={([next]) => setZoom(next ?? 1)} />{error && <p className="text-sm text-danger">{error}</p>}<DialogFooter><Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !pixels}>{saving ? 'Saving…' : 'Save photo'}</Button></DialogFooter></DialogContent></Dialog>
}
