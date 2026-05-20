// SSE specs are slower — give them more time
Cypress.config('defaultCommandTimeout', 10000)

describe('Real-time SSE updates', () => {
  let projectId: string

  beforeEach(() => {
    cy.request('POST', '/api/v1/test/reset')
    cy.request('POST', '/api/v1/auth/login', { username: 'testuser', password: 'testpass' })
    cy.request('POST', '/api/v1/projects/', { name: 'SSE Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  it('Session A creates a feature → Session B receives SSE and sees it without reload', () => {
    // Session B: open a read-only view (no edit lock)
    cy.session('reader', () => {
      cy.request('POST', '/api/v1/auth/login', { username: 'testuser', password: 'testpass' })
    })
    cy.visit('/')
    cy.contains('SSE Test').click()
    cy.url().should('include', projectId)

    // Session A: create a feature via API (simulates another editor)
    cy.request({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/edit-lock/acquire`,
    })
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'SSE Feature' })

    // Session B should see the new feature via SSE without reloading
    cy.contains('SSE Feature').should('be.visible')
  })

  it('Session A releases lock → Session B lock indicator updates', () => {
    // Session A acquires the lock
    cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)

    // Session B observes the lock indicator
    cy.visit('/')
    cy.contains('SSE Test').click()
    cy.contains(/locked by|you.*editor/i).should('be.visible')

    // Session A releases the lock
    cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/release`)

    // Session B should now see the lock available
    cy.contains('button', /request edit mode/i).should('be.visible')
  })
})
