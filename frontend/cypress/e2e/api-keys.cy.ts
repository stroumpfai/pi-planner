// The whole key lifecycle in one journey. `cy.resetDb()` clears project data but
// NOT users or api_keys, so this spec must name its key uniquely and revoke it at
// the end — otherwise it leaks into every later spec in the same run.
describe('API key management', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.visit('/')
    cy.get('button[title="Manage users"]').click()
    cy.get('[role="dialog"]').should('be.visible')
    cy.get('[role="dialog"]').contains('button', /^API Keys$/).click()
  })

  it('issues, reveals, cycles and revokes a key for an admin', () => {
    // Held in a closure, not a Cypress alias: `.invoke()` is a query, so an alias
    // over it would re-read the live DOM and compare the new token to itself.
    let firstToken = ''

    // Each user gets their own "+ Issue Key" button next to their name.
    cy.contains('Test User (testuser)').siblings('button').click()

    cy.get('#key-name-testuser').type('E2E Key')
    cy.get('#key-purpose-testuser').type('Cypress journey')
    cy.get('#key-expires-testuser').select('30')
    cy.contains('button', /^Issue Key$/).click()

    // The secret is shown exactly once, in a panel that only its own button closes.
    cy.contains('API Key Created').should('be.visible')
    cy.get('[role="dialog"]').last().find('code').invoke('text').then((t) => {
      firstToken = t
    })
    cy.contains('button', /copied it/i).click()
    cy.contains('API Key Created').should('not.exist')

    cy.contains('E2E Key').should('be.visible')
    cy.contains('Cypress journey').should('be.visible')
    cy.contains(/Expires: /).should('be.visible')

    // Cycling issues a replacement under the same name and revokes the original.
    cy.contains('button', /^Cycle$/).click()
    cy.get('[role="dialog"]').last().contains('button', /^Cycle Key$/).click()
    cy.contains('API Key Created').should('be.visible')
    cy.get('[role="dialog"]').last().find('code').invoke('text').then((cycledToken) => {
      expect(cycledToken).to.not.equal(firstToken)
    })
    cy.contains('button', /copied it/i).click()
    cy.contains('E2E Key').should('be.visible')

    cy.contains('button', /^Revoke$/).click()
    cy.get('[role="dialog"]').last().contains('button', /^Revoke$/).click()

    cy.contains('Revoked key "E2E Key"').should('be.visible')
    // Scoped to the modal — the success toast also carries the key's name.
    cy.get('[role="dialog"]').contains('E2E Key').should('not.exist')
    cy.get('[role="dialog"]').contains('No keys').should('be.visible')
  })
})
