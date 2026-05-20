describe('Auth flow', () => {
  beforeEach(() => {
    cy.request('POST', '/api/v1/test/reset')
  })

  it('valid credentials → lands on project list', () => {
    cy.login()
    cy.url().should('include', '/')
    cy.contains('PI Planner').should('be.visible')
  })

  it('wrong password → error message shown, stays on login page', () => {
    cy.visit('/')
    cy.get('input[name="username"]').type('testuser')
    cy.get('input[name="password"]').type('wrongpassword')
    cy.get('button[type="submit"]').click()
    cy.contains(/invalid credentials|incorrect|wrong/i).should('be.visible')
    cy.url().should('match', /\/(login)?$/)
  })

  it('accessing protected route while logged out → redirected to login', () => {
    cy.visit('/projects/some-id')
    cy.url().should('include', '/login')
  })

  it('logout → cookie cleared and protected route redirects to login', () => {
    cy.login()
    cy.contains('PI Planner').should('be.visible')
    cy.request('POST', '/api/v1/auth/logout')
    cy.visit('/projects/some-id')
    cy.url().should('include', '/login')
  })
})
