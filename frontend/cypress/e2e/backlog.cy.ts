describe('Core backlog journey', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Backlog Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  // Opens the project and takes the edit lock through the UI. Both steps matter:
  // there is no URL routing, and `isEditing` is client-side state that an API-only
  // lock acquisition never sets, which leaves every write control disabled.
  function openBacklogAsEditor() {
    cy.openProject('Backlog Test')
    cy.enterEditMode()
  }

  /** Feature rows are divs; the expand chevron is the row's first button. */
  function expandFeature(title: string) {
    cy.contains(title).should('be.visible')
    cy.get('button[aria-label="Expand"]').first().click()
  }

  it('creates a feature and it appears with [id] Title format', () => {
    openBacklogAsEditor()
    cy.contains('button', /\+ feature/i).click()
    cy.get('input[name="title"]').type('Auth Feature')
    cy.get('input[name="id"]').type('101')
    cy.get('button[type="submit"]').click()
    cy.contains('[101]').should('be.visible')
    cy.contains('Auth Feature').should('be.visible')
  })

  it('adds a PBI to a feature and it appears listed under it', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature' })
    openBacklogAsEditor()
    expandFeature('Auth Feature')
    cy.contains('button', /^\+ PBI$/).click()
    cy.get('input[name="title"]').type('Login form')
    cy.get('button[type="submit"]').click()
    cy.contains('Login form').should('be.visible')
  })

  it('adds a Bug-type PBI and it appears with Bug label', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature' })
    openBacklogAsEditor()
    expandFeature('Auth Feature')
    cy.contains('button', /^\+ Bug$/).click()
    cy.get('input[name="title"]').type('Login crash')
    cy.get('button[type="submit"]').click()
    cy.contains('Login crash').should('be.visible')
    cy.contains(/bug/i).should('be.visible')
  })

  it('edits feature title and user_id — changes persist after reload', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Original Title' })
    openBacklogAsEditor()
    cy.contains('Original Title').should('be.visible')
    cy.get('button[aria-label="Edit"]').first().click({ force: true })
    cy.get('input[name="title"]').clear().type('Updated Title')
    cy.get('input[name="id"]').type('202')
    cy.get('button[type="submit"]').click()
    cy.contains('Updated Title').should('be.visible')
    // A reload drops the uiStore navigation, so re-open the project to verify
    // the change was persisted rather than only held in the client cache.
    cy.openProject('Backlog Test')
    cy.contains('Updated Title').should('be.visible')
    cy.contains('[202]').should('be.visible')
  })

  it('deletes a PBI and then a feature — both disappear', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'To Delete Feature' }).then((featureRes) => {
      cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
        title: 'PBI to delete',
        parent_feature_system_id: featureRes.body.system_id,
        item_type: 'story',
      })
    })
    openBacklogAsEditor()
    expandFeature('To Delete Feature')
    cy.contains('PBI to delete').should('be.visible')

    // The PBI row's delete button is the second one on the page: the feature row
    // owns the first. Scope by row text to stay unambiguous.
    cy.contains('div', 'PBI to delete').find('button[aria-label="Delete"]').first().click({ force: true })
    cy.get('[role="dialog"]').contains('button', /^Delete$/).click()
    cy.contains('PBI to delete').should('not.exist')

    cy.get('button[aria-label="Delete"]').first().click({ force: true })
    cy.get('[role="dialog"]').contains('button', /^Delete$/).click()
    cy.contains('To Delete Feature').should('not.exist')
  })

  // Clearing is bulk and permanent, and the two radio options differ in exactly
  // one way: whether features already placed in a PI are spared.
  describe('Clear features', () => {
    beforeEach(() => {
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Backlog One' })
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Backlog Two' }).then((fRes) => {
        cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
          title: 'Child Story',
          parent_feature_system_id: fRes.body.system_id,
          item_type: 'story',
        })
      })
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Planned Feature' }).then((fRes) => {
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
    })

    function openClearDialog() {
      openBacklogAsEditor()
      cy.contains('button', /^Clear$/).click()
      return cy.get('[role="dialog"]')
    }

    it('is offered only to the editor holding the lock', () => {
      cy.openProject('Backlog Test')
      cy.contains('button', /^Clear$/).should('be.disabled')
    })

    it('deletes the backlog features and keeps the ones in a PI', () => {
      openClearDialog().within(() => {
        cy.contains('label', 'Backlog only').should('contain', '2 features')
        cy.contains('label', 'Everything').should('contain', '3 features')
        cy.contains('button', /^Delete$/).click()
      })

      cy.contains('Deleted 2 backlog features').should('be.visible')
      cy.contains('Backlog One').should('not.exist')
      cy.contains('Backlog Two').should('not.exist')
      // The PBI under a cleared feature goes with it.
      cy.contains('Child Story').should('not.exist')

      // The PI feature survives, and its board still shows it.
      cy.openPI('Q1-2026')
      cy.contains('Planned Feature').should('be.visible')
    })

    it('deletes every feature, in a PI or not, when Everything is chosen', () => {
      openClearDialog().within(() => {
        cy.contains('label', 'Everything').click()
        cy.contains('button', /^Delete$/).click()
      })

      cy.contains('Deleted 3 features').should('be.visible')

      cy.openPI('Q1-2026')
      cy.contains('Planned Feature').should('not.exist')
      // The board structure is kept — only the work is gone.
      cy.contains('Team A').should('be.visible')
    })

    it('cancelling changes nothing', () => {
      openClearDialog().within(() => {
        cy.contains('button', /^Cancel$/).click()
      })

      cy.get('[role="dialog"]').should('not.exist')
      cy.contains('Backlog One').should('be.visible')
    })
  })
})
