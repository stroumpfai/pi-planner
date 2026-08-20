describe('Reports export modal', () => {
  let projectId: string
  let piId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Report Export Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  function setupPI() {
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, {
      name: 'Report PI',
      state: 'draft',
    }).then((res) => {
      piId = res.body.system_id

      cy.request('POST', `/api/v1/pis/${piId}/swimlines`, { name: 'Team Alpha' }).then((slRes) => {
        const slId = slRes.body.system_id
        cy.request('POST', `/api/v1/projects/${projectId}/features`, {
          title: 'Feature A',
        }).then((fRes) => {
          const fId = fRes.body.system_id
          cy.request('PATCH', `/api/v1/features/${fId}`, {
            location: 'pi',
            pi_id: piId,
            swimlane_id: slId,
          })
          cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
            title: 'Story 1',
            effort: 5,
            parent_feature_system_id: fId,
          }).then((pbiRes) => {
            cy.request('POST', `/api/v1/pbis/${pbiRes.body.system_id}/place`, {
              sprint_index: 0,
            })
          })
        })
      })
    })
  }

  function goToBoard() {
    cy.visit('/')
    cy.contains('Report Export Test').click()
    cy.url().should('include', projectId)
    cy.contains('Report PI').click()
    cy.url().should('include', piId)
  }

  it('opens the reports modal with default selections', () => {
    setupPI()
    goToBoard()
    cy.contains('button', 'Reports').click()
    cy.contains('Export report').should('be.visible') // modal title
    cy.get('#report-type-readiness').should('be.checked')
    cy.get('#report-type-readout').should('not.be.checked')
    cy.get('#report-type-breakdown').should('not.be.checked')
    cy.get('#report-fmt-markdown').should('be.checked')
    cy.get('#report-fmt-pdf').should('not.be.checked')
    cy.get('#report-show-ids').should('be.checked')
    // The breakdown-only toggles stay hidden until that report is selected.
    cy.get('#report-show-states').should('not.exist')
    cy.get('#report-include-unplaced').should('not.exist')
  })

  it('sends correct query params for a sprint breakdown with states and unplaced off', () => {
    setupPI()
    goToBoard()

    cy.intercept('GET', '/api/v1/pis/*/report*').as('report')

    cy.contains('button', 'Reports').click()
    cy.get('#report-type-breakdown').click()
    cy.get('#report-show-states').should('be.checked').click() // turn off
    cy.get('#report-include-unplaced').should('be.checked').click() // turn off
    cy.contains('button', 'Export').last().click()

    cy.wait('@report').its('request.url').should((url) => {
      expect(url).to.include('report_type=breakdown')
      expect(url).to.include('fmt=markdown')
      expect(url).to.include('show_ids=true')
      expect(url).to.include('show_states=false')
      expect(url).to.include('include_unplaced=false')
    })
  })

  it('sends correct query params for a readout PDF with IDs hidden', () => {
    setupPI()
    goToBoard()

    cy.intercept('GET', '/api/v1/pis/*/report*').as('report')

    cy.contains('button', 'Reports').click()
    cy.get('#report-type-readout').click()
    cy.get('#report-fmt-pdf').click()
    cy.get('#report-show-ids').click() // turn off
    cy.contains('button', 'Export').last().click()

    cy.wait('@report').its('request.url').should((url) => {
      expect(url).to.include('report_type=readout')
      expect(url).to.include('fmt=pdf')
      expect(url).to.include('show_ids=false')
    })
  })

  it('persists selections across modal re-opens', () => {
    setupPI()
    goToBoard()

    cy.intercept('GET', '/api/v1/pis/*/report*').as('report')

    cy.contains('button', 'Reports').click()
    cy.get('#report-type-readout').click()
    cy.get('#report-fmt-pdf').click()
    cy.contains('button', 'Export').last().click()
    cy.wait('@report')

    cy.contains('button', 'Reports').click()
    cy.get('#report-type-readout').should('be.checked')
    cy.get('#report-fmt-pdf').should('be.checked')
  })

  it('Cancel closes the modal without triggering a download', () => {
    setupPI()
    goToBoard()

    cy.intercept('GET', '/api/v1/pis/*/report*').as('report')

    cy.contains('button', 'Reports').click()
    cy.contains('button', 'Cancel').click()

    cy.get('#report-type-readiness').should('not.exist')
    cy.get('@report.all').should('have.length', 0)
  })
})
