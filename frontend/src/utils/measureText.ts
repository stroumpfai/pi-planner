let measurer: HTMLDivElement | null = null

function getMeasurer(): HTMLDivElement {
  if (!measurer) {
    measurer = document.createElement('div')
    measurer.style.position = 'absolute'
    measurer.style.top = '-9999px'
    measurer.style.left = '-9999px'
    measurer.style.visibility = 'hidden'
    measurer.style.whiteSpace = 'nowrap'
    document.body.appendChild(measurer)
  }
  return measurer
}

export function measureTextWidth(text: string, className: string): number {
  const el = getMeasurer()
  el.className = className
  el.textContent = text
  return el.getBoundingClientRect().width
}
