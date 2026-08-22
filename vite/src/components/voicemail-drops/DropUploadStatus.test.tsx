import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DropUploadStatus } from '@/components/voicemail-drops/DropUploadStatus'

describe('DropUploadStatus', () => {
  const onRetry = vi.fn()
  const onCancel = vi.fn()

  it('shows bounded upload progress and lets the rep cancel an active upload', async () => {
    const user = userEvent.setup()

    render(<DropUploadStatus status="uploading" progress={125} onRetry={onRetry} onCancel={onCancel} />)

    expect(screen.getByText('Uploading')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('100%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel upload' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it.each([
    ['transcoding', 'Transcoding'],
    ['transcribing', 'Transcribing'],
    ['ready', 'Ready'],
  ] as const)('shows the %s processing state', (status, label) => {
    render(<DropUploadStatus status={status} onRetry={onRetry} onCancel={onCancel} />)

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel upload' })).not.toBeInTheDocument()
  })

  it('explains a failure and lets the rep retry', async () => {
    const user = userEvent.setup()

    render(
      <DropUploadStatus
        status="failed"
        error="The audio file could not be uploaded. Check your connection and try again."
        onRetry={onRetry}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('The audio file could not be uploaded. Check your connection and try again.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry upload' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
