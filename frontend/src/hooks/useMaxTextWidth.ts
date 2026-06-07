import { useLayoutEffect, useState } from 'react'
import { measureTextWidth } from '@/utils/measureText'

export function useMaxTextWidth(texts: string[], className: string, maxWidth: number): number {
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const widest = texts.reduce((max, text) => Math.max(max, measureTextWidth(text, className)), 0)
    setWidth(Math.min(widest, maxWidth))
  }, [texts, className, maxWidth])

  return width
}
