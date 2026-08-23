describe('User management and RBAC', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'RBAC Test' }).then((res) => {
      projectId = res.body.system_id
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Existing Feature' })
    })
  })

  function openUserManagement() {
    cy.visit('/')
    cy.get('button[title="Manage users"]').click()
    cy.get('[role="dialog"]').should('be.visible')
  }

  it('admin can open user management and sees the seeded accounts', () => {
    openUserManagement()
    cy.get('[role="dialog"]').within(() => {
      cy.contains('testuser').should('be.visible')
      cy.contains('testuser2').should('be.visible')
    })
  })

  it('admin creates a reader account', () => {
    openUserManagement()
    cy.get('[role="dialog"]').within(() => {
      cy.contains('button', /add user/i).click()
      cy.get('#new-user-username').type('newreader')
      cy.get('#new-user-display-name').type('New Reader')
      cy.get('#new-user-role').select('reader')
      cy.get('#new-user-password').type('correct-horse-battery')
      cy.get('#new-user-confirm-password').type('correct-horse-battery')
      cy.contains('button', /create user/i).click()
      cy.contains('newreader').should('be.visible')
    })
  })

  it('rejects a password that violates the policy', () => {
    openUserManagement()
    cy.get('[role="dialog"]').within(() => {
      cy.contains('button', /add user/i).click()
      cy.get('#new-user-username').type('weakuser')
      cy.get('#new-user-password').type('password')       // too short + blocklisted
      cy.get('#new-user-confirm-password').type('password')
      cy.contains('button', /create user/i).click()
    })
    cy.contains(/at least 12|too common|password/i).should('be.visible')
  })

  // The single-writer rule is enforced per role: a reader can never take the lock.
  it('a reader sees the board read-only and cannot request the edit lock', () => {
    cy.request('POST', '/api/v1/users/', {
      username: 'readonly',
      display_name: 'Read Only',
      password: 'correct-horse-battery',
      role: 'reader',
    })
    cy.request('POST', '/api/v1/auth/logout')
    cy.login('readonly', 'correct-horse-battery')

    cy.openProject('RBAC Test')
    cy.contains('Existing Feature').should('be.visible')
    cy.contains('button', /request edit mode/i).should('not.exist')
    cy.contains('button', /\+ feature/i).should('be.disabled')
    cy.get('button[title="Manage users"]').should('not.exist')
  })

  it('an editor can take the lock but cannot manage users', () => {
    cy.request('POST', '/api/v1/auth/logout')
    cy.login('testuser2', 'testpass')   // seeded with the editor role

    cy.openProject('RBAC Test')
    cy.get('button[title="Manage users"]').should('not.exist')
    cy.enterEditMode()
    cy.contains('button', /\+ feature/i).should('not.be.disabled')
  })
})
