import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DateInput } from '../DateInput'

const onChange = vi.fn()

const defaultProps = { id: 'test-date', value: '', onChange }

/** DateInput is controlled by ISO but edited as dd.mm.yyyy; this mirrors a real parent. */
function ControlledHost({ initial }: { initial: string }) {
  const [iso, setIso] = useState(initial)
  return (
    <>
      <DateInput id="host-date" value={iso} onChange={(v) => { setIso(v); onChange(v) }} />
      <output>{iso || 'empty'}</output>
    </>
  )
}

const field = () => screen.getByRole('textbox')

beforeEach(() => vi.clearAllMocks())

describe('DateInput', () => {
  it('renders an ISO value as dd.mm.yyyy', () => {
    render(<DateInput {...defaultProps} value="2026-03-05" />)
    expect(field()).toHaveValue('05.03.2026')
  })

  it('renders empty for an empty value and shows the format as a placeholder', () => {
    render(<DateInput {...defaultProps} />)
    expect(field()).toHaveValue('')
    expect(field()).toHaveAttribute('placeholder', 'dd.mm.yyyy')
  })

  it('does not emit while the user is still typing', async () => {
    render(<DateInput {...defaultProps} />)
    await userEvent.type(field(), '05.03.2026')
    expect(field()).toHaveValue('05.03.2026')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits an ISO date on blur', async () => {
    render(<DateInput {...defaultProps} />)
    await userEvent.type(field(), '05.03.2026')
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith('2026-03-05')
  })

  it('normalises the display to dd.mm.yyyy after a valid blur', async () => {
    render(<ControlledHost initial="" />)
    await userEvent.type(field(), ' 05.03.2026 ')
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith('2026-03-05')
    expect(field()).toHaveValue('05.03.2026')
  })

  it('emits an empty string when the field is cleared and blurred', async () => {
    render(<DateInput {...defaultProps} value="2026-03-05" />)
    await userEvent.clear(field())
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('reverts to the last valid value when the input is unparseable', async () => {
    render(<DateInput {...defaultProps} value="2026-03-05" />)
    await userEvent.clear(field())
    await userEvent.type(field(), 'not a date')
    await userEvent.tab()
    expect(onChange).not.toHaveBeenCalled()
    expect(field()).toHaveValue('05.03.2026')
  })

  it('reverts to empty when an unparseable value is typed into a blank field', async () => {
    render(<DateInput {...defaultProps} />)
    await userEvent.type(field(), '5.3.26')   // wrong shape: needs dd.mm.yyyy
    await userEvent.tab()
    expect(onChange).not.toHaveBeenCalled()
    expect(field()).toHaveValue('')
  })

  it('re-syncs the display when the parent changes the value', () => {
    const { rerender } = render(<DateInput {...defaultProps} value="2026-03-05" />)
    expect(field()).toHaveValue('05.03.2026')
    rerender(<DateInput {...defaultProps} value="2026-12-31" />)
    expect(field()).toHaveValue('31.12.2026')
  })

  it('round-trips through a controlled parent', async () => {
    render(<ControlledHost initial="2026-01-15" />)
    expect(field()).toHaveValue('15.01.2026')

    await userEvent.clear(field())
    await userEvent.type(field(), '28.02.2026')
    await userEvent.tab()

    expect(screen.getByText('2026-02-28')).toBeInTheDocument()
    expect(field()).toHaveValue('28.02.2026')
  })

  it('applies the id and className it is given', () => {
    render(<DateInput {...defaultProps} className="custom-class" />)
    expect(field()).toHaveAttribute('id', 'test-date')
    expect(field()).toHaveClass('custom-class')
  })
})
