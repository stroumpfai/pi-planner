import { vi, beforeEach, describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPNGModal } from '../ExportPNGModal'
import * as pisService from '@/services/pis'

vi.mock('@/services/pis', async (importOriginal) => {
  const actual = await importOriginal<typeof pisService>()
  return {
    ...actual,
    downloadPIPNG: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/stores/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const defaultProps = {
  piId: 'pi-123',
  piName: 'Q1 2026',
  open: true,
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('ExportPNGModal', () => {
  it('defaults to the roadmap layout', () => {
    render(<ExportPNGModal {...defaultProps} />)
    expect(screen.getByLabelText(/roadmap bars/i)).toBeChecked()
    expect(screen.getByLabelText(/pbi list/i)).not.toBeChecked()
  })

  it('renders the 6 roadmap option toggles', () => {
    render(<ExportPNGModal {...defaultProps} />)
    expect(screen.getByLabelText(/pi effort/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/sprint effort/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/swimlane effort/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/events/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/center swimlane text/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/export date/i)).toBeInTheDocument()
    // list-only options are hidden in roadmap layout
    expect(screen.queryByLabelText(/split by swimline/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/display the id/i)).not.toBeInTheDocument()
  })

  it('switching to PBI list swaps roadmap-only and list-only options', async () => {
    render(<ExportPNGModal {...defaultProps} />)
    await userEvent.click(screen.getByLabelText(/pbi list/i))

    expect(screen.getByLabelText(/split by swimline/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/display the id/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/swimlane effort/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/center swimlane text/i)).not.toBeInTheDocument()
    // shared options remain
    expect(screen.getByLabelText(/pi effort/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/export date/i)).toBeInTheDocument()
  })

  it('switching to Heatmap hides layout-specific and sprint/event toggles', async () => {
    render(<ExportPNGModal {...defaultProps} />)
    await userEvent.click(screen.getByLabelText(/heatmap/i))

    // heatmap keeps only the title/footer toggles
    expect(screen.getByLabelText(/pi effort/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/export date/i)).toBeInTheDocument()
    // everything sprint/lane/list-specific is hidden
    expect(screen.queryByLabelText(/sprint effort/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^events$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/swimlane effort/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/center swimlane text/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/split by swimline/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/display the id/i)).not.toBeInTheDocument()
  })

  it('exports the heatmap layout', async () => {
    render(<ExportPNGModal {...defaultProps} />)
    await userEvent.click(screen.getByLabelText(/heatmap/i))
    await userEvent.click(screen.getByRole('button', { name: /export/i }))

    await waitFor(() =>
      expect(pisService.downloadPIPNG).toHaveBeenCalledWith(
        'pi-123',
        'Q1 2026',
        expect.objectContaining({ layout: 'heatmap' }),
      ),
    )
    const saved = JSON.parse(localStorage.getItem('pi-export-png-options') ?? '{}')
    expect(saved.layout).toBe('heatmap')
  })

  it('all toggles are OFF by default when no stored preference', () => {
    render(<ExportPNGModal {...defaultProps} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(6)
    checkboxes.forEach((cb) => expect(cb).not.toBeChecked())
  })

  it('restores saved preferences from localStorage on open', () => {
    localStorage.setItem(
      'pi-export-png-options',
      JSON.stringify({ showEvents: true, showExportDate: true }),
    )
    render(<ExportPNGModal {...defaultProps} />)
    expect(screen.getByLabelText(/events/i)).toBeChecked()
    expect(screen.getByLabelText(/export date/i)).toBeChecked()
    expect(screen.getByLabelText(/pi effort/i)).not.toBeChecked()
  })

  it('clicking a toggle flips its state', async () => {
    render(<ExportPNGModal {...defaultProps} />)
    const eventsToggle = screen.getByLabelText(/events/i)
    expect(eventsToggle).not.toBeChecked()
    await userEvent.click(eventsToggle)
    expect(eventsToggle).toBeChecked()
  })

  it('Export button calls downloadPIPNG with the selected options and saves to localStorage', async () => {
    render(<ExportPNGModal {...defaultProps} />)
    await userEvent.click(screen.getByLabelText(/sprint effort/i))
    await userEvent.click(screen.getByLabelText(/events/i))
    await userEvent.click(screen.getByRole('button', { name: /export/i }))

    await waitFor(() =>
      expect(pisService.downloadPIPNG).toHaveBeenCalledWith(
        'pi-123',
        'Q1 2026',
        expect.objectContaining({ showSprintEffort: true, showEvents: true }),
      ),
    )

    const saved = JSON.parse(localStorage.getItem('pi-export-png-options') ?? '{}')
    expect(saved.showSprintEffort).toBe(true)
    expect(saved.showEvents).toBe(true)
    expect(saved.showPiEffort).toBe(false)
  })

  it('exports the PBI list layout with split-by-swimline and show-id', async () => {
    render(<ExportPNGModal {...defaultProps} />)
    await userEvent.click(screen.getByLabelText(/pbi list/i))
    await userEvent.click(screen.getByLabelText(/split by swimline/i))
    await userEvent.click(screen.getByLabelText(/display the id/i))
    await userEvent.click(screen.getByRole('button', { name: /export/i }))

    await waitFor(() =>
      expect(pisService.downloadPIPNG).toHaveBeenCalledWith(
        'pi-123',
        'Q1 2026',
        expect.objectContaining({ layout: 'list', splitBySwimline: true, showId: true }),
      ),
    )

    const saved = JSON.parse(localStorage.getItem('pi-export-png-options') ?? '{}')
    expect(saved.layout).toBe('list')
    expect(saved.splitBySwimline).toBe(true)
    expect(saved.showId).toBe(true)
  })

  it('Cancel button calls onClose without triggering export', async () => {
    render(<ExportPNGModal {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(defaultProps.onClose).toHaveBeenCalled()
    expect(pisService.downloadPIPNG).not.toHaveBeenCalled()
  })

  it('shows error toast when export fails', async () => {
    const { toast } = await import('@/stores/toastStore')
    vi.mocked(pisService.downloadPIPNG).mockRejectedValueOnce(new Error('Network error'))
    render(<ExportPNGModal {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('PNG export failed'))
  })
})
