describe('PI planning journey', () => {
  let projectId: string

  beforeEach(() => {
    cy.request('POST', '/api/v1/test/reset')
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'PI Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  function goToPI() {
    cy.visit('/')
    cy.contains('PI Test').click()
    cy.url().should('include', projectId)
  }

  function acquireEditLock() {
    cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
    cy.reload()
  }

  it('creates a PI and it appears with Draft state badge', () => {
    goToPI()
    acquireEditLock()
    cy.contains('button', /\+ new pi/i).click()
    cy.get('input[name="name"]').type('Q1-2026')
    cy.get('button[type="submit"]').click()
    cy.contains('Q1-2026').should('be.visible')
    cy.contains(/draft/i).should('be.visible')
  })

  it('transitions PI from Draft to In Progress and badge updates', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' })
    goToPI()
    acquireEditLock()
    cy.contains('button', /start pi/i).click()
    cy.contains('button', /start pi/i).last().click() // confirm dialog
    cy.contains(/in progress/i).should('be.visible')
  })

  it('only one PI can be In Progress at a time', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' })
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q2-2026' })
    goToPI()
    acquireEditLock()
    // Start the first PI
    cy.contains('Q1-2026').closest('li').contains('button', /start pi/i).click()
    cy.contains('button', /start pi/i).last().click()
    cy.contains(/in progress/i).should('be.visible')
    // Attempt to start the second PI
    cy.contains('Q2-2026').closest('li').contains('button', /start pi/i).click()
    cy.contains('button', /start pi/i).last().click()
    cy.contains(/only one pi|already.*in progress|error/i).should('be.visible')
  })

  it('moves a feature from backlog into a swimlane', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature' })
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
      cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Team A' })
    })
    goToPI()
    acquireEditLock()
    // Find feature card in backlog and drop target (swimlane)
    cy.contains('Auth Feature').realMouseDown()
    cy.contains('Team A').realMouseMove(0, 0).realMouseUp()
    cy.contains('Team A').closest('[data-swimlane]').contains('Auth Feature').should('be.visible')
  })

  it('creates a group in a swimlane and assigns PBIs', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Feature X' }).then((fRes) => {
      cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
        title: 'Story 1',
        parent_feature_system_id: fRes.body.system_id,
        item_type: 'story',
      })
    })
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
      cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Team A' })
    })
    goToPI()
    acquireEditLock()
    cy.contains('button', /create group/i).first().click()
    cy.get('input[name="name"]').type('Sprint Group 1')
    cy.contains('Story 1').click()
    cy.get('button[type="submit"]').click()
    cy.contains('Sprint Group 1').should('be.visible')
  })
})
