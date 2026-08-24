import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ItemEditButton } from '../ItemEditButton'

const onActivate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ItemEditButton', () => {
  it('is labelled "Edit" and shows a pencil when the user can edit', () => {
    render(<ItemEditButton editable onActivate={onActivate} />)
    const button = screen.getByRole('button', { name: 'Edit' })
    expect(button).toHaveAttribute('title', 'Edit')
    expect(button).toHaveTextContent('✎')
  })

  it('is labelled "View details" and shows an eye when the user cannot edit', () => {
    render(<ItemEditButton editable={false} onActivate={onActivate} />)
    const button = screen.getByRole('button', { name: 'View details' })
    expect(button).toHaveAttribute('title', 'View details')
    expect(button.querySelector('svg')).toBeInTheDocument()
  })

  it('calls onActivate when clicked', async () => {
    render(<ItemEditButton editable onActivate={onActivate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('lets the click bubble when it is not inside a drag handle', async () => {
    const onParentClick = vi.fn()
    render(
      <button type="button" onClick={onParentClick}>
        <ItemEditButton editable onActivate={onActivate} />
      </button>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onParentClick).toHaveBeenCalledTimes(1)
  })

  it('stops click and pointerdown from reaching a drag handle', async () => {
    const onParentClick = vi.fn()
    const onParentPointerDown = vi.fn()
    render(
      <div onClick={onParentClick} onPointerDown={onParentPointerDown}>
        <ItemEditButton editable withinDragHandle onActivate={onActivate} />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
    expect(onParentPointerDown).not.toHaveBeenCalled()
  })

  it('is a plain button, so it never submits a surrounding form', () => {
    render(<ItemEditButton editable onActivate={onActivate} />)
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('type', 'button')
  })
})
