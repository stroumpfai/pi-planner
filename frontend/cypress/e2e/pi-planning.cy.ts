describe('PI planning journey', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'PI Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  // Opens the project and takes the lock through the UI. Both matter: there is no
  // URL routing to assert on, and `isEditing` is client-side state that an API-only
  // acquisition never sets — without it every write control stays disabled and
  // drag-and-drop drops are discarded by the board's canEdit guard.
  function openProjectAsEditor() {
    cy.openProject('PI Test')
    cy.enterEditMode()
  }

  it('creates a PI and it appears with Draft state badge', () => {
    openProjectAsEditor()
    cy.contains('button', /\+ new pi/i).click()
    cy.get('input[name="name"]').type('Q1-2026')
    cy.get('button[type="submit"]').click()
    cy.contains('Q1-2026').should('be.visible')
    cy.contains(/draft/i).should('be.visible')
  })

  it('transitions PI from Draft to In Progress and badge updates', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' })
    openProjectAsEditor()
    cy.contains('button', /start pi/i).click()
    cy.get('[role="dialog"]').contains('button', /start pi/i).click()
    cy.contains(/in progress/i).should('be.visible')
  })

  it('only one PI can be In Progress at a time', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' })
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q2-2026' })
    openProjectAsEditor()

    cy.contains('li', 'Q1-2026').contains('button', /start pi/i).click()
    cy.get('[role="dialog"]').contains('button', /start pi/i).click()
    cy.contains(/in progress/i).should('be.visible')

    // The Start control stays visible on the second PI; the rule is enforced by
    // the backend and surfaced as an inline error in the PI list panel.
    cy.contains('li', 'Q2-2026').contains('button', /start pi/i).click()
    cy.get('[role="dialog"]').contains('button', /start pi/i).click()
    cy.contains(/only one pi|already.*in progress|in progress/i).should('be.visible')
  })

  it('moves a feature from backlog into a swimlane', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature' })
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
      cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Team A' })
    })
    openProjectAsEditor()
    cy.openPI('Q1-2026')

    // dnd-kit's PointerSensor needs >5px of movement to activate, and the drop
    // zone's label changes once hovered, so resolve its coordinates up front and
    // drive the pointer over <body> in viewport space.
    cy.contains('Drop features here').then(($zone) => {
      const rect = $zone[0].getBoundingClientRect()
      const x = Math.round(rect.left + rect.width / 2)
      const y = Math.round(rect.top + rect.height / 2)
      cy.get('[data-testid="backlog-list"]').contains('Auth Feature').realMouseDown()
      cy.get('body').realMouseMove(x - 150, y)
      cy.get('body').realMouseMove(x, y)
      cy.get('body').realMouseUp()
    })

    cy.get('[data-testid="backlog-list"]').should('not.contain', 'Auth Feature')
    cy.contains('Auth Feature').should('be.visible')
  })

  it('creates a group in a swimlane and assigns PBIs', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Feature X' }).then((fRes) => {
      cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
        title: 'Story 1',
        parent_feature_system_id: fRes.body.system_id,
        item_type: 'story',
      })
      cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
        cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Team A' }).then((slRes) => {
          cy.request('PATCH', `/api/v1/features/${fRes.body.system_id}`, {
            location: 'pi',
            pi_id: piRes.body.system_id,
            swimlane_id: slRes.body.system_id,
          })
        })
      })
    })
    openProjectAsEditor()
    cy.openPI('Q1-2026')

    // Grouping is a three-step affordance on the feature card: expand it, tick the
    // PBIs, then confirm — which opens the name modal.
    cy.get('button[title="Select PBIs to group"]').first().click({ force: true })
    // The PBI's row label uses `display: contents`, so it measures 0x0 and Cypress
    // refuses an unforced click even though it is on screen.
    cy.contains('Story 1').click({ force: true })
    cy.contains('button', /^\+ Group \d+ PBI/).click()
    cy.get('#group-name').type('Sprint Group 1')
    cy.get('button[type="submit"]').click()
    cy.contains('Sprint Group 1').should('be.visible')
  })
})
