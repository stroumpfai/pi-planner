// SSE specs are slower — give them more time
Cypress.config('defaultCommandTimeout', 10000)

describe('Real-time SSE updates', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.request('POST', '/api/v1/auth/login', { username: 'testuser', password: 'testpass' })
    cy.request('POST', '/api/v1/projects/', { name: 'SSE Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  // "Session A" is a second real user (testuser2, seeded by scripts/e2e.sh). It has
  // to be a different account: the lock indicator only reads "Locked by" when the
  // holder is somebody else. cy.request shares the browser's cookie jar, so each
  // Session A action logs in, acts, and logs the browser back in as testuser.
  function asSessionA(action: () => void) {
    cy.request('POST', '/api/v1/auth/login', { username: 'testuser2', password: 'testpass' })
    action()
    cy.request('POST', '/api/v1/auth/login', { username: 'testuser', password: 'testpass' })
  }

  it('Session A creates a feature → Session B receives SSE and sees it without reload', () => {
    cy.openProject('SSE Test')

    asSessionA(() => {
      cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'SSE Feature' })
    })

    // Session B never reloads — the row arrives over the event stream.
    cy.contains('SSE Feature').should('be.visible')
  })

  it('Session A releases lock → Session B lock indicator updates', () => {
    asSessionA(() => {
      cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
    })

    cy.openProject('SSE Test')
    cy.contains(/locked by/i).should('be.visible')

    asSessionA(() => {
      cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/release`)
    })

    cy.contains('button', /request edit mode/i).should('be.visible')
  })

  // An import is one transaction and arrives as one event, so this is the only
  // thing telling a reader their board just moved under them.
  it('Session A imports a CSV → Session B sees the items and is told who did it', () => {
    cy.openProject('SSE Test')
    cy.contains('No features in the backlog').should('be.visible')

    asSessionA(() => {
      cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
      cy.request('POST', `/api/v1/projects/${projectId}/import/csv`, {
        rows: [
          { row_number: 2, item_type: 'feature', title: 'Imported Feature', user_id: 101 },
          { row_number: 3, item_type: 'story', title: 'Imported Story', user_id: 201, parent_id: 101 },
        ],
      })
    })

    // Session B never reloads: the feature and the notice both arrive over SSE.
    cy.contains('Imported Feature').should('be.visible')
    cy.contains(/testuser2 imported a CSV/i).should('be.visible')
  })
})
