import { vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimelineMinimap } from '../TimelineMinimap'
import type { YearMonth } from '@/utils/timelineMonths'

/** A 1200px track: 100px a month over a twelve-month strip. */
const TRACK_WIDTH = 1200

function withTrackWidth(width: number) {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    return { ...original.call(this), width, left: 0, right: width } as DOMRect
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

const JANUARY: YearMonth = { year: 2026, month: 1 }

function draw(onFrameStart: (month: YearMonth) => void, frameStart: YearMonth = JANUARY) {
  return render(
    <TimelineMinimap
      windowStart={JANUARY}
      frameStart={frameStart}
      frameMonths={6}
      density={[0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]}
      describeDensity={(value) => (value ? `${value} half-days` : 'nothing entered')}
      onFrameStart={onFrameStart}
      stripMonths={12}
      onStripMonths={() => {}}
    />,
  )
}

describe('TimelineMinimap', () => {
  beforeAll(() => {
    // jsdom ships no PointerEvent, and without one the fired events carry no
    // clientX — which is the only thing this component reads off them.
    if (typeof window.PointerEvent === 'undefined') {
      window.PointerEvent = class extends MouseEvent {} as unknown as typeof PointerEvent
    }
  })

  it('reads a bar aloud with what its month holds', async () => {
    const onFrameStart = vi.fn()
    draw(onFrameStart)

    expect(screen.getByRole('button', { name: 'Show Feb 2026 — 4 half-days' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Mar 2026 — nothing entered' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Show Sep 2026/ }))
    expect(onFrameStart).toHaveBeenCalledWith({ year: 2026, month: 9 })
  })

  it('clicks through the frame to the month under it', () => {
    // The frame covers half the strip. Without this the six months it sits on
    // are the only ones a mouse cannot reach: their bars are behind it, and the
    // reader would have to drag the frame away before being allowed to click.
    const restore = withTrackWidth(TRACK_WIDTH)
    try {
      const onFrameStart = vi.fn()
      draw(onFrameStart)
      const frame = screen.getByRole('button', { name: /Showing Jan 2026 to Jun 2026/ })

      // 350px into a 100px-a-month track is April — the fourth month, under the
      // frame's middle.
      fireEvent.pointerDown(frame, { clientX: 350 })
      fireEvent.pointerUp(window, { clientX: 350 })

      expect(onFrameStart).toHaveBeenCalledWith({ year: 2026, month: 4 })
    } finally {
      restore()
    }
  })

  it('treats a press that travels as a drag, and moves the frame instead', () => {
    const restore = withTrackWidth(TRACK_WIDTH)
    try {
      const onFrameStart = vi.fn()
      draw(onFrameStart)
      const frame = screen.getByRole('button', { name: /Showing Jan 2026 to Jun 2026/ })

      fireEvent.pointerDown(frame, { clientX: 350 })
      fireEvent.pointerMove(window, { clientX: 750 })
      fireEvent.pointerUp(window, { clientX: 750 })

      // The pointer holds the frame's middle, not its left edge: 750px is
      // seven and a half months along, so a six-month frame centred there
      // starts in June. The release adds no second call — a drag is not also a
      // click on where it ended.
      expect(onFrameStart).toHaveBeenCalledTimes(1)
      expect(onFrameStart).toHaveBeenCalledWith({ year: 2026, month: 6 })
    } finally {
      restore()
    }
  })

  it('ignores the wobble in a click, rather than nudging the frame', () => {
    const restore = withTrackWidth(TRACK_WIDTH)
    try {
      const onFrameStart = vi.fn()
      draw(onFrameStart)
      const frame = screen.getByRole('button', { name: /Showing Jan 2026 to Jun 2026/ })

      fireEvent.pointerDown(frame, { clientX: 350 })
      fireEvent.pointerMove(window, { clientX: 352 })
      fireEvent.pointerUp(window, { clientX: 352 })

      // Two pixels is a hand, not an intention: still a click on April.
      expect(onFrameStart).toHaveBeenCalledTimes(1)
      expect(onFrameStart).toHaveBeenCalledWith({ year: 2026, month: 4 })
    } finally {
      restore()
    }
  })

  it('walks the frame a month at a time from the keyboard', () => {
    const onFrameStart = vi.fn()
    draw(onFrameStart, { year: 2026, month: 3 })
    const frame = screen.getByRole('button', { name: /Showing Mar 2026 to Aug 2026/ })

    fireEvent.keyDown(frame, { key: 'ArrowLeft' })
    expect(onFrameStart).toHaveBeenCalledWith({ year: 2026, month: 2 })

    fireEvent.keyDown(frame, { key: 'ArrowRight' })
    expect(onFrameStart).toHaveBeenCalledWith({ year: 2026, month: 4 })
  })
})
