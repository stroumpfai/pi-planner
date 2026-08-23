describe('Swimlane management', () => {
  let projectId: string
  let piId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Swimlane Test' }).then((res) => {
      projectId = res.body.system_id
      cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
        piId = piRes.body.system_id
      })
    })
  })

  function seedSwimlane(name: string) {
    cy.then(() => cy.request('POST', `/api/v1/pis/${piId}/swimlines`, { name }))
  }

  function openBoardAsEditor() {
    cy.openProject('Swimlane Test')
    cy.enterEditMode()
    cy.openPI('Q1-2026')
  }

  it('creates a swimlane from the board header', () => {
    openBoardAsEditor()
    cy.contains('button', /\+ add swimlane/i).click()
    cy.get('#swimlane-name').type('Team Alpha')
    cy.get('button[type="submit"]').click()
    cy.get('[role="dialog"]').should('not.exist')
    // Asserted with `exist` rather than `be.visible`: the title span combines
    // `truncate` (overflow: hidden) with a CSS-variable width, and Cypress's
    // visibility heuristic reports a false negative on the freshly created row
    // even though every ancestor measures non-zero and visible. The drop zone
    // below proves the swimlane actually rendered.
    cy.contains('span', 'Team Alpha').should('exist')
    cy.contains('Drop features here').should('be.visible')
  })

  it('renames a swimlane inline', () => {
    seedSwimlane('Team Alpha')
    openBoardAsEditor()
    cy.get('button[title="Rename swimlane"]').click()
    cy.focused().clear().type('Team Beta{enter}')
    cy.contains('Team Beta').should('be.visible')
    cy.contains('Team Alpha').should('not.exist')
  })

  it('deletes a swimlane and returns its features to the backlog', () => {
    cy.then(() => {
      cy.request('POST', `/api/v1/pis/${piId}/swimlines`, { name: 'Team Alpha' }).then((slRes) => {
        cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Stranded Feature' })
          .then((fRes) => {
            cy.request('PATCH', `/api/v1/features/${fRes.body.system_id}`, {
              location: 'pi', pi_id: piId, swimlane_id: slRes.body.system_id,
            })
          })
      })
    })
    openBoardAsEditor()
    cy.get('[data-testid="backlog-list"]').should('not.contain', 'Stranded Feature')

    cy.get('button[title="Delete swimlane"]').click()
    cy.get('[role="dialog"]').contains('button', /^Delete$/).click()
    cy.get('[role="dialog"]').should('not.exist')

    cy.contains('span', 'Team Alpha').should('not.exist')
    cy.get('[data-testid="backlog-list"]').should('contain', 'Stranded Feature')
  })

  it('collapses and expands every swimlane from the header', () => {
    seedSwimlane('Team Alpha')
    openBoardAsEditor()
    cy.contains('Drop features here').should('be.visible')

    cy.contains('button', /collapse all/i).click()
    cy.contains('Drop features here').should('not.exist')

    cy.contains('button', /expand all/i).click()
    cy.contains('Drop features here').should('be.visible')
  })

  it('hides the backlog column in focus mode', () => {
    seedSwimlane('Team Alpha')
    openBoardAsEditor()
    cy.get('[data-testid="backlog-panel"]').should('exist')

    cy.get('button[title="Enter focus mode"]').click()
    cy.get('[data-testid="backlog-panel"]').should('not.exist')

    cy.get('button[title="Exit focus mode"]').click()
    cy.get('[data-testid="backlog-panel"]').should('exist')
  })
})
