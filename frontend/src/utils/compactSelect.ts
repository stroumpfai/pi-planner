import type { CSSProperties } from 'react'

/**
 * A select shrunk below the size the forms plugin draws it at.
 *
 * The plugin renders the chevron as a **background image** — 1.5em at
 * `right 0.5rem` — and reserves 2.5rem of padding to keep the text off it.
 * Overriding the padding alone is what put the arrow on top of the text: the
 * chevron kept its 1.5em while the room for it halved.
 *
 * So the two live in one object and the padding is derived from the chevron.
 * Splitting them across an inline style and a Tailwind class is precisely how
 * they came apart, and a class cannot be read back by a test to catch it.
 *
 * Shared by the two places a select has to fit a column rather than a form: the
 * absence grid's month jump and the meeting matrix's sprint picker. Both sit in
 * headers a few characters wide, where 2.5rem of reserved padding is most of the
 * control.
 */
const CHEVRON_EM = 1

export const COMPACT_SELECT: CSSProperties = {
  backgroundSize: `${CHEVRON_EM}em ${CHEVRON_EM}em`,
  backgroundPosition: 'right 0.125rem center',
  paddingRight: `${CHEVRON_EM + 0.375}em`,
}
