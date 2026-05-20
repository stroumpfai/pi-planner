import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach } from 'vitest'
import { ToastContainer } from '../ToastContainer'
import { useToastStore } from '@/stores/toastStore'
import type { Toast } from '@/stores/toastStore'

beforeEach(() => useToastStore.setState({ toasts: [] }))

const makeToast = (overrides: Partial<Toast> = {}): Toast => ({
  id: 't-1',
  message: 'Something happened',
  variant: 'info',
  ...overrides,
})

describe('ToastContainer', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the toast message when one toast is present', () => {
    useToastStore.setState({ toasts: [makeToast({ message: 'Saved!' })] })
    render(<ToastContainer />)
    expect(screen.getByText('Saved!')).toBeInTheDocument()
  })

  it('renders all toasts when multiple are present', () => {
    useToastStore.setState({
      toasts: [
        makeToast({ id: 't-1', message: 'First' }),
        makeToast({ id: 't-2', message: 'Second' }),
      ],
    })
    render(<ToastContainer />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('calls dismiss when the dismiss button is clicked', async () => {
    const dismiss = vi.fn()
    useToastStore.setState({ toasts: [makeToast()], dismiss })
    render(<ToastContainer />)
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(dismiss).toHaveBeenCalledWith('t-1')
  })
})
