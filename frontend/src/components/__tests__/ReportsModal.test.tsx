import { vi, beforeEach, describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportsModal } from '../ReportsModal'
import * as pisService from '@/services/pis'

vi.mock('@/services/pis', async (importOriginal) => {
  const actual = await importOriginal<typeof pisService>()
  return {
    ...actual,
    downloadPIReport: vi.fn().mockResolvedValue(undefined),
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

describe('ReportsModal', () => {
  it('defaults to readiness + markdown + show IDs', () => {
    render(<ReportsModal {...defaultProps} />)
    expect(screen.getByLabelText(/readiness/i)).toBeChecked()
    expect(screen.getByLabelText(/planning readout/i)).not.toBeChecked()
    expect(screen.getByLabelText(/sprint breakdown/i)).not.toBeChecked()
    expect(screen.getByLabelText(/markdown/i)).toBeChecked()
    expect(screen.getByLabelText(/pdf/i)).not.toBeChecked()
    expect(screen.getByLabelText(/display ids/i)).toBeChecked()
  })

  it('hides the breakdown-only toggles for readiness and readout', async () => {
    render(<ReportsModal {...defaultProps} />)
    expect(screen.queryByLabelText(/display states/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/include unplaced items/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText(/planning readout/i))
    expect(screen.queryByLabelText(/display states/i)).not.toBeInTheDocument()
  })

  it('reveals the breakdown-only toggles, both on, when Sprint breakdown is picked', async () => {
    render(<ReportsModal {...defaultProps} />)
    await userEvent.click(screen.getByLabelText(/sprint breakdown/i))

    expect(screen.getByLabelText(/display states/i)).toBeChecked()
    expect(screen.getByLabelText(/include unplaced items/i)).toBeChecked()
    expect(screen.getByLabelText(/display ids/i)).toBeChecked()
  })

  it('exports the breakdown report with its toggles and saves them', async () => {
    render(<ReportsModal {...defaultProps} />)
    await userEvent.click(screen.getByLabelText(/sprint breakdown/i))
    await userEvent.click(screen.getByLabelText(/display states/i)) // turn off
    await userEvent.click(screen.getByLabelText(/include unplaced items/i)) // turn off
    await userEvent.click(screen.getByRole('button', { name: /export/i }))

    await waitFor(() =>
      expect(pisService.downloadPIReport).toHaveBeenCalledWith(
        'pi-123',
        'Q1 2026',
        expect.objectContaining({
          reportType: 'breakdown',
          showStates: false,
          includeUnplaced: false,
          showIds: true,
        }),
      ),
    )

    const saved = JSON.parse(localStorage.getItem('pi-export-report-options') ?? '{}')
    expect(saved.reportType).toBe('breakdown')
    expect(saved.showStates).toBe(false)
    expect(saved.includeUnplaced).toBe(false)
  })

  it('restores saved breakdown preferences on open', () => {
    localStorage.setItem(
      'pi-export-report-options',
      JSON.stringify({ reportType: 'breakdown', showStates: false }),
    )
    render(<ReportsModal {...defaultProps} />)
    expect(screen.getByLabelText(/sprint breakdown/i)).toBeChecked()
    expect(screen.getByLabelText(/display states/i)).not.toBeChecked()
    // Keys absent from storage fall back to the defaults.
    expect(screen.getByLabelText(/include unplaced items/i)).toBeChecked()
  })

  it('restores saved preferences from localStorage on open', () => {
    localStorage.setItem(
      'pi-export-report-options',
      JSON.stringify({ reportType: 'readout', format: 'pdf', showIds: false }),
    )
    render(<ReportsModal {...defaultProps} />)
    expect(screen.getByLabelText(/planning readout/i)).toBeChecked()
    expect(screen.getByLabelText(/pdf/i)).toBeChecked()
    expect(screen.getByLabelText(/display ids/i)).not.toBeChecked()
  })

  it('Export button calls downloadPIReport with the selected options and saves them', async () => {
    render(<ReportsModal {...defaultProps} />)
    await userEvent.click(screen.getByLabelText(/planning readout/i))
    await userEvent.click(screen.getByLabelText(/pdf/i))
    await userEvent.click(screen.getByLabelText(/display ids/i)) // turn off
    await userEvent.click(screen.getByRole('button', { name: /export/i }))

    await waitFor(() =>
      expect(pisService.downloadPIReport).toHaveBeenCalledWith(
        'pi-123',
        'Q1 2026',
        expect.objectContaining({ reportType: 'readout', format: 'pdf', showIds: false }),
      ),
    )

    const saved = JSON.parse(localStorage.getItem('pi-export-report-options') ?? '{}')
    expect(saved.reportType).toBe('readout')
    expect(saved.format).toBe('pdf')
    expect(saved.showIds).toBe(false)
  })

  it('Cancel button calls onClose without triggering export', async () => {
    render(<ReportsModal {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(defaultProps.onClose).toHaveBeenCalled()
    expect(pisService.downloadPIReport).not.toHaveBeenCalled()
  })

  it('shows error toast when export fails', async () => {
    const { toast } = await import('@/stores/toastStore')
    vi.mocked(pisService.downloadPIReport).mockRejectedValueOnce(new Error('Network error'))
    render(<ReportsModal {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /export/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Report export failed'))
  })
})
