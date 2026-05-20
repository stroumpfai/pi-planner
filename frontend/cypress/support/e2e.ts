import 'cypress-real-events'

Cypress.Commands.add('login', (username = 'testuser', password = 'testpass') => {
  cy.request('POST', '/api/v1/auth/login', { username, password })
  cy.visit('/')
})
