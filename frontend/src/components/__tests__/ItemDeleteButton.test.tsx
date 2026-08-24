import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ItemDeleteButton } from '../ItemDeleteButton'

const onActivate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ItemDeleteButton', () => {
  it('is labelled "Delete" and renders the trash icon', () => {
    render(<ItemDeleteButton onActivate={onActivate} />)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveAttribute('title', 'Delete')
    expect(button.querySelector('svg')).toBeInTheDocument()
  })

  it('calls onActivate when clicked', async () => {
    render(<ItemDeleteButton onActivate={onActivate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('lets the click bubble when it is not inside a drag handle', async () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <ItemDeleteButton onActivate={onActivate} />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onParentClick).toHaveBeenCalledTimes(1)
  })

  it('stops click and pointerdown from reaching a drag handle', async () => {
    const onParentClick = vi.fn()
    const onParentPointerDown = vi.fn()
    render(
      <div onClick={onParentClick} onPointerDown={onParentPointerDown}>
        <ItemDeleteButton withinDragHandle onActivate={onActivate} />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
    expect(onParentPointerDown).not.toHaveBeenCalled()
  })

  it('is a plain button, so it never submits a surrounding form', () => {
    render(<ItemDeleteButton onActivate={onActivate} />)
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('type', 'button')
  })
})
