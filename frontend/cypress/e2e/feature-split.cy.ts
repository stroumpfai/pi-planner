// Splitting carries selected PBIs into another PI as a *continuation* of the same
// feature, and cancelling reverses it. Both move data between PIs and neither had
// a browser-level test — the layer that proves the modal, the lineage badge and
// the cancel guard are actually wired to the split and cancel endpoints.
describe('Feature split and continuation', () => {
  let projectId: string
  let originPiId: string
  let targetPiId: string
  let featureId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Split Test' }).then((res) => {
      projectId = res.body.system_id

      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Checkout' }).then((fRes) => {
        featureId = fRes.body.system_id
        for (const title of ['Cart page', 'Payment step']) {
          cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
            title,
            parent_feature_system_id: featureId,
            item_type: 'story',
          })
        }
      })

      cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'PI-One' }).then((piRes) => {
        originPiId = piRes.body.system_id
        cy.request('POST', `/api/v1/pis/${originPiId}/swimlines`, { name: 'Team A' }).then((slRes) => {
          cy.request('PATCH', `/api/v1/features/${featureId}`, {
            location: 'pi',
            pi_id: originPiId,
            swimlane_id: slRes.body.system_id,
          })
        })
      })

      cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'PI-Two' }).then((piRes) => {
        targetPiId = piRes.body.system_id
        cy.request('POST', `/api/v1/pis/${targetPiId}/swimlines`, { name: 'Team A' })
      })
    })
  })

  function openBoardAsEditor(piName: string) {
    cy.openProject('Split Test')
    cy.enterEditMode()
    cy.openPI(piName)
  }

  // Selecting PBIs is the same three-step affordance grouping uses: expand the
  // card, tick the rows, then act. The PBI label uses `display: contents`, so it
  // measures 0x0 and Cypress refuses an unforced click.
  function selectPbi(title: string) {
    cy.get('button[title="Select PBIs to group"]').first().click({ force: true })
    cy.contains(title).click({ force: true })
  }

  function splitTo(piName: string, swimlaneName: string) {
    cy.contains('button', /→ Move \d+ PBIs? to PI/).click()
    cy.get('[role="dialog"]').within(() => {
      cy.get('#split-target-pi').select(piName)
      cy.get('#split-target-swimline').select(swimlaneName)
      cy.contains('button', /^Move \d+ PBIs?$/).click()
    })
    cy.get('[role="dialog"]').should('not.exist')
  }

  it('splits a PBI into another PI and marks the lineage on both boards', () => {
    openBoardAsEditor('PI-One')
    selectPbi('Payment step')
    splitTo('PI-Two', 'Team A')

    // The origin gains a pointer to the target PI. (Splitting collapses the PBI
    // panel, so what it kept is asserted in the next test, not here.)
    cy.contains('⟲ also in').should('be.visible')
    cy.contains('button', 'PI-Two').should('be.visible')

    cy.openPI('PI-Two')
    cy.contains('Checkout').should('be.visible')
    cy.contains('⟲ also in').should('be.visible')
    cy.contains('button', 'PI-One').should('be.visible')
  })

  it('carries the split PBI into the continuation, and leaves the rest behind', () => {
    openBoardAsEditor('PI-One')
    selectPbi('Payment step')
    splitTo('PI-Two', 'Team A')

    cy.openPI('PI-Two')
    cy.get('button[title="Select PBIs to group"]').first().click({ force: true })
    // PBI labels use `display: contents`, so they measure 0x0 — assert existence,
    // never visibility.
    cy.contains('Payment step').should('exist')
    cy.contains('Cart page').should('not.exist')
  })

  it('cancels a continuation, returning the PBI to the origin feature', () => {
    openBoardAsEditor('PI-One')
    selectPbi('Payment step')
    splitTo('PI-Two', 'Team A')

    cy.openPI('PI-Two')
    cy.contains('button', /✕ cancel/).click()
    cy.get('[role="dialog"]').contains('button', /^Cancel continuation$/).click()

    // The continuation is gone from the target board…
    cy.contains('Checkout').should('not.exist')

    // …and its PBI is back with the origin feature.
    cy.openPI('PI-One')
    cy.contains('⟲ also in').should('not.exist')
    cy.get('button[title="Select PBIs to group"]').first().click({ force: true })
    cy.contains('Payment step').should('exist')
    cy.contains('Cart page').should('exist')
  })

  it('offers no cancel on the origin feature — only the continuation can be undone', () => {
    openBoardAsEditor('PI-One')
    selectPbi('Payment step')
    splitTo('PI-Two', 'Team A')

    cy.contains('⟲ also in').should('be.visible')
    cy.contains('button', /✕ cancel/).should('not.exist')
  })
})
