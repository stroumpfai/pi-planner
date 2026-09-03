import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * The rendered width of an element, kept current as it resizes.
 *
 * Measured rather than assumed because the thing that depends on it — how many
 * months of density a strip can carry — is a question about pixels, and CSS has
 * no way to hand that answer back to the component that has to fetch the data
 * for them.
 *
 * `0` until the first layout, and `0` wherever there is no layout at all (jsdom,
 * a server render). Callers must read that as "not measured yet" and fall back
 * to a sensible default rather than to nothing, so the element is never
 * momentarily empty.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()

    // Guarded: jsdom has no ResizeObserver, and a one-off measurement is still
    // the right answer for a layout that never changes.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}
