describe('Project CRUD', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    // Acquire edit mode (admin user)
    cy.request('POST', '/api/v1/auth/login', { username: 'testuser', password: 'testpass' })
  })

  it('creates a project and it appears in the list', () => {
    cy.contains('button', /new project|create project/i).click()
    cy.get('input[name="name"]').type('My Project')
    cy.get('button[type="submit"]').click()
    cy.contains('My Project').should('be.visible')
  })

  it('renames a project and new name is reflected', () => {
    cy.request('POST', '/api/v1/projects/', { name: 'Original Name' })
    cy.reload()
    cy.contains('Original Name').should('be.visible')
    cy.contains('Original Name').closest('li, [data-testid]').find('button, [aria-label*="edit" i]').first().click()
    cy.get('input[name="name"]').clear().type('Renamed Project')
    cy.get('button[type="submit"]').click()
    cy.contains('Renamed Project').should('be.visible')
    cy.contains('Original Name').should('not.exist')
  })

  it('deletes a project with confirmation and it disappears from the list', () => {
    cy.request('POST', '/api/v1/projects/', { name: 'To Delete' })
    cy.reload()
    cy.contains('To Delete').should('be.visible')
    cy.contains('To Delete').closest('li, [data-testid]').find('button, [aria-label*="delete" i]').first().click()
    cy.contains('button', /confirm|delete/i).last().click()
    cy.contains('To Delete').should('not.exist')
  })

  it('duplicate project name shows inline error', () => {
    cy.request('POST', '/api/v1/projects/', { name: 'Existing Project' })
    cy.reload()
    cy.contains('button', /new project|create project/i).click()
    cy.get('input[name="name"]').type('Existing Project')
    cy.get('button[type="submit"]').click()
    cy.contains(/already exists|name.*taken|duplicate/i).should('be.visible')
  })
})
