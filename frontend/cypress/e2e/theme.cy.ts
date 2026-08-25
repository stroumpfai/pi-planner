// Theme switching is wiring across three layers that only a real browser puts
// together: the picker writes the store, useTheme toggles `dark` on <html>, and
// Tailwind's class strategy plus the CSS variables in styles/global.css repaint.
// The hook's logic is unit-tested in src/hooks/__tests__/useTheme.test.tsx; this
// spec is here for the parts a jsdom test structurally cannot see.
const LIGHT_CANVAS = 'rgb(240, 244, 248)'
const DARK_CANVAS = 'rgb(30, 36, 50)'
const SCHEME_KEY = 'pi-planner:color-scheme'

describe('Theme switching', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
  })

  function openUserMenu() {
    cy.contains('button', 'Test User').click()
    cy.contains('Theme').should('be.visible')
  }

  it('switches to dark and repaints the app', () => {
    cy.get('html').should('not.have.class', 'dark')
    cy.get('header').should('have.css', 'background-color', LIGHT_CANVAS)

    openUserMenu()
    cy.contains('button', /^Dark$/).click()

    cy.get('html').should('have.class', 'dark')
    cy.get('header').should('have.css', 'background-color', DARK_CANVAS)
    cy.window().its('localStorage').invoke('getItem', SCHEME_KEY).should('eq', 'dark')
  })

  it('switches back to light and removes the dark class', () => {
    openUserMenu()
    cy.contains('button', /^Dark$/).click()
    cy.get('html').should('have.class', 'dark')

    cy.contains('button', /^Light$/).click()

    cy.get('html').should('not.have.class', 'dark')
    cy.get('header').should('have.css', 'background-color', LIGHT_CANVAS)
    cy.window().its('localStorage').invoke('getItem', SCHEME_KEY).should('eq', 'light')
  })

  // Safe to reload here: this journey never leaves the project list, which is
  // where a reload drops you anyway (the active project lives in uiStore).
  it('keeps the chosen scheme across a reload', () => {
    openUserMenu()
    cy.contains('button', /^Dark$/).click()
    cy.get('html').should('have.class', 'dark')

    cy.reload()

    cy.get('html').should('have.class', 'dark')
    cy.get('header').should('have.css', 'background-color', DARK_CANVAS)
  })

  // With nothing stored the store defaults to `system`, so the app has to take
  // its scheme from the OS rather than from a click.
  it('follows the OS preference when no scheme has been chosen', () => {
    cy.visit('/', {
      onBeforeLoad(win) {
        cy.stub(win, 'matchMedia').callsFake((query: string) => ({
          matches: query.includes('prefers-color-scheme: dark'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }))
      },
    })

    cy.get('html').should('have.class', 'dark')
    cy.get('header').should('have.css', 'background-color', DARK_CANVAS)
    cy.window().its('localStorage').invoke('getItem', SCHEME_KEY).should('be.null')
  })
})
