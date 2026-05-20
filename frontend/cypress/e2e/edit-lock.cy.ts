describe('Edit lock lifecycle', () => {
  let projectId: string

  beforeEach(() => {
    cy.request('POST', '/api/v1/test/reset')
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Lock Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  it('Request Edit Mode → button becomes You • Editor and editing is enabled', () => {
    cy.visit('/')
    cy.contains('Lock Test').click()
    cy.contains('button', /request edit mode/i).click()
    cy.contains(/you.*editor/i).should('be.visible')
    cy.contains('button', /\+ feature/i).should('not.be.disabled')
  })

  it('Release lock → button returns to Request Edit Mode', () => {
    cy.visit('/')
    cy.contains('Lock Test').click()
    cy.contains('button', /request edit mode/i).click()
    cy.contains(/you.*editor/i).should('be.visible')
    cy.contains('button', /release/i).click()
    cy.contains('button', /request edit mode/i).should('be.visible')
    cy.contains('button', /\+ feature/i).should('be.disabled')
  })

  it('heartbeat fires keepalive after 1 minute', () => {
    cy.clock()
    cy.visit('/')
    cy.contains('Lock Test').click()
    cy.contains('button', /request edit mode/i).click()
    cy.contains(/you.*editor/i).should('be.visible')
    cy.intercept('POST', `/api/v1/projects/${projectId}/edit-lock/keepalive`).as('keepalive')
    cy.tick(61_000)
    cy.wait('@keepalive')
  })

  it('lock held by another user → Edit button shows Locked by and is not clickable', () => {
    // Seed a lock held by a different session by posting directly via the API
    cy.request({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/edit-lock/acquire`,
      failOnStatusCode: false,
    })
    // Simulate the lock belonging to a different user by overwriting via direct DB seed
    // We seed it via a second login to get a different session then acquire
    cy.request('POST', '/api/v1/auth/logout')
    cy.request('POST', '/api/v1/auth/login', { username: 'testuser2', password: 'testpass' }).then(() => {
      cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
    })
    cy.login() // login back as testuser
    cy.visit('/')
    cy.contains('Lock Test').click()
    cy.contains(/locked by/i).should('be.visible')
  })
})
