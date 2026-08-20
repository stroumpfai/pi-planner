describe('Auth flow', () => {
  beforeEach(() => {
    cy.resetDb()
  })

  it('valid credentials → lands on project list', () => {
    cy.login()
    cy.contains('PI Planner').should('be.visible')
    cy.contains('button', /new project|create project/i).should('be.visible')
  })

  it('wrong password → error message shown, stays on login page', () => {
    cy.visit('/')
    cy.get('input[name="username"]').type('testuser')
    cy.get('input[name="password"]').type('wrongpassword')
    cy.get('button[type="submit"]').click()
    cy.contains('Invalid username or password.').should('be.visible')
    cy.get('button[type="submit"]').should('contain', 'Sign in')
  })

  // The app is a single view with no router: when there is no session, App renders
  // LoginPage in place rather than redirecting to a /login URL.
  it('no session → the app renders the login form instead of the project list', () => {
    cy.visit('/')
    cy.get('input[name="username"]').should('be.visible')
    cy.contains('button', /new project|create project/i).should('not.exist')
  })

  it('logout → session cleared and the login form comes back', () => {
    cy.login()
    cy.contains('PI Planner').should('be.visible')
    cy.contains('button', 'Sign out').click()
    cy.get('input[name="username"]').should('be.visible')
    cy.contains('button', /new project|create project/i).should('not.exist')
  })
})
