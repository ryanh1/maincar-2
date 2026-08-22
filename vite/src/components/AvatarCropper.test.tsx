import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-easy-crop', () => ({
  default: ({ image, onCropComplete }: { image: string; onCropComplete: (_area: unknown, pixels: { x: number; y: number; width: number; height: number }) => void }) => (
    <button type="button" onClick={() => onCropComplete({}, { x: 0, y: 0, width: 1, height: 1 })}>
      <img alt="Crop preview" src={image} />
    </button>
  ),
}))

import { AvatarPhotoField } from '@/components/AvatarPhotoField'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AvatarPhotoField', () => {
  it('keeps the selected photo preview URL valid after Strict Mode remounts effects', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn().mockReturnValue('blob:active-preview')
    const revokeObjectURL = vi.fn()
    const upload = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      set src(_source: string) { this.onload?.() }
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['crop'], { type: 'image/png' })))

    render(
      <StrictMode>
        <AvatarPhotoField name="Al Pha" avatarUrl={null} label="profile" upload={upload} />
      </StrictMode>,
    )

    await user.upload(document.querySelector('input[type="file"]')!, new File(['photo'], 'headshot.png', { type: 'image/png' }))

    const preview = await screen.findByAltText('Crop preview')
    expect(revokeObjectURL).not.toHaveBeenCalledWith(preview.getAttribute('src'))

    await user.click(preview)
    await user.click(screen.getByRole('button', { name: 'Save photo' }))

    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(Blob)))
  })
})
