import { useEffect, useState } from 'react'
import { fromInputDate, toInputDate } from '@/utils/dates'

interface Props {
  readonly id: string
  readonly value: string        // ISO YYYY-MM-DD or empty
  readonly onChange: (iso: string) => void  // emits ISO or empty string
  readonly className?: string
}

export function DateInput({ id, value, onChange, className }: Props) {
  const [display, setDisplay] = useState(() => toInputDate(value))

  useEffect(() => {
    setDisplay(toInputDate(value))
  }, [value])

  function handleBlur() {
    if (!display) {
      onChange('')
      return
    }
    const iso = fromInputDate(display)
    if (iso) {
      onChange(iso)
      setDisplay(toInputDate(iso))
    } else {
      // Invalid input — reset to the last valid value
      setDisplay(toInputDate(value))
    }
  }

  return (
    <input
      id={id}
      type="text"
      placeholder="dd.mm.yyyy"
      value={display}
      onChange={(e) => setDisplay(e.target.value)}
      onBlur={handleBlur}
      className={className}
    />
  )
}
