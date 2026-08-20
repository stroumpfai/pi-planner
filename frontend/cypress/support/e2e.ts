import 'cypress-real-events'

Cypress.Commands.add('login', (username = 'testuser', password = 'testpass') => {
  cy.request('POST', '/api/v1/auth/login', { username, password })
  cy.visit('/')
})

// The reset endpoint requires an authenticated editor/admin, so log in first,
// then clear cookies so each test starts from a logged-out state.
Cypress.Commands.add('resetDb', () => {
  cy.request('POST', '/api/v1/auth/login', { username: 'testuser', password: 'testpass' })
  cy.request('POST', '/api/v1/test/reset')
  cy.clearCookies()
})

// The app has no URL routing — the active project and PI live in uiStore, so
// navigation has to be clicked and there is no URL to assert on. A reload drops
// you back to the project list, so never reload mid-journey.
Cypress.Commands.add('openProject', (name: string) => {
  cy.visit('/')
  cy.contains(name).click()
  cy.contains('button', 'Backlog').should('be.visible')
})

// force: true because Radix briefly puts `pointer-events: none` on <body> (its
// dialog scroll lock) around this transition, which makes an unforced click flaky.
Cypress.Commands.add('openPI', (name: string) => {
  cy.contains('button', name).click({ force: true })
  cy.get('[data-testid="backlog-panel"]').should('be.visible')
})

// `isEditing` is client-side authStore state, set only by the acquire mutation's
// onSuccess. Acquiring the lock over the API leaves every write control disabled
// and makes drag-and-drop drops no-ops, so edit mode must be entered by clicking.
Cypress.Commands.add('enterEditMode', () => {
  cy.contains('button', 'Request Edit Mode').click()
  cy.contains('You • Editor').should('be.visible')
})
