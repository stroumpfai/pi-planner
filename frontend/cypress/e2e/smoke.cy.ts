describe('Smoke test', () => {
  it('loads the home page', () => {
    cy.visit('/')
    cy.contains('PI Planning').should('be.visible')
  })
})
