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
