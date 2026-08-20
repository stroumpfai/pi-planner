describe('Edit lock lifecycle', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Lock Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  it('Request Edit Mode → button becomes You • Editor and editing is enabled', () => {
    cy.openProject('Lock Test')
    cy.contains('button', /request edit mode/i).click()
    cy.contains(/you.*editor/i).should('be.visible')
    cy.contains('button', /\+ feature/i).should('not.be.disabled')
  })

  it('Release lock → button returns to Request Edit Mode', () => {
    cy.openProject('Lock Test')
    cy.contains('button', /request edit mode/i).click()
    cy.contains(/you.*editor/i).should('be.visible')
    cy.contains('button', /release/i).click()
    cy.contains('button', /request edit mode/i).should('be.visible')
    cy.contains('button', /\+ feature/i).should('be.disabled')
  })

  it('heartbeat fires keepalive after 1 minute', () => {
    cy.openProject('Lock Test')
    // Freeze time only after the page has loaded: a frozen clock stalls the
    // timers React Query needs to fetch the project list. The heartbeat interval
    // is created when isEditing flips true, which is still ahead of us here.
    cy.clock()
    cy.contains('button', /request edit mode/i).click()
    cy.contains(/you.*editor/i).should('be.visible')
    cy.intercept('POST', `/api/v1/projects/${projectId}/edit-lock/keepalive`).as('keepalive')
    cy.tick(61_000)
    cy.wait('@keepalive')
  })

  it('lock held by another user → Edit button shows Locked by and is not clickable', () => {
    // testuser2 is seeded alongside testuser by scripts/e2e.sh.
    cy.request('POST', '/api/v1/auth/logout')
    cy.request('POST', '/api/v1/auth/login', { username: 'testuser2', password: 'testpass' })
    cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
    cy.request('POST', '/api/v1/auth/logout')

    cy.login()
    cy.openProject('Lock Test')
    cy.contains(/locked by/i).should('be.visible')
    cy.contains('button', /request edit mode/i).should('not.exist')
  })
})
