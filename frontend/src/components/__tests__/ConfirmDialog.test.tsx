import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../ConfirmDialog'

const onConfirm = vi.fn()
const onCancel = vi.fn()

const defaultProps = {
  open: true,
  title: 'Delete project',
  description: 'This cannot be undone.',
  onConfirm,
  onCancel,
}

beforeEach(() => vi.clearAllMocks())

describe('ConfirmDialog', () => {
  it('renders the title and description', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('Delete project')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />)
    expect(screen.queryByText('Delete project')).not.toBeInTheDocument()
  })

  it('labels the confirm button "Confirm" by default', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeInTheDocument()
  })

  it('uses a supplied confirm label', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Delete" />)
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', async () => {
    render(<ConfirmDialog {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    render(<ConfirmDialog {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when the dialog is dismissed with Escape', async () => {
    render(<ConfirmDialog {...defaultProps} />)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('styles the confirm button blue by default and red when destructive', () => {
    const { rerender } = render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: /^confirm$/i })).toHaveClass('bg-blue-600')

    rerender(<ConfirmDialog {...defaultProps} destructive />)
    expect(screen.getByRole('button', { name: /^confirm$/i })).toHaveClass('bg-red-600')
  })
})
