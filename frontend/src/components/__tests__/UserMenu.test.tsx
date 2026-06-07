import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserMenu } from '../UserMenu'
import { useSettingsStore } from '@/stores/settingsStore'

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  useSettingsStore.setState({ showIds: true, showEffortUnit: true })
})

describe('UserMenu', () => {
  it('opens the menu and shows the Display section with toggles', async () => {
    render(<UserMenu displayName="Jane" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /jane/i }))
    expect(screen.getByText('Display')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /show ids/i })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /show effort unit/i })).toBeInTheDocument()
  })

  it('clicking Show IDs toggle updates the store', async () => {
    render(<UserMenu displayName="Jane" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /jane/i }))
    await userEvent.click(screen.getByRole('switch', { name: /show ids/i }))
    expect(useSettingsStore.getState().showIds).toBe(false)
  })

  it('clicking Show effort unit toggle updates the store', async () => {
    render(<UserMenu displayName="Jane" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /jane/i }))
    await userEvent.click(screen.getByRole('switch', { name: /show effort unit/i }))
    expect(useSettingsStore.getState().showEffortUnit).toBe(false)
  })

  it('clicking Change Password opens the change password modal', async () => {
    render(<UserMenu displayName="Jane" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /jane/i }))
    await userEvent.click(screen.getByRole('button', { name: /change password/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
