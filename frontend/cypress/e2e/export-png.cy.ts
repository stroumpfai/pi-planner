describe('PNG export modal', () => {
  let projectId: string
  let piId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'PNG Export Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  function setupPI() {
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, {
      name: 'Export PI',
      state: 'draft',
    }).then((res) => {
      piId = res.body.system_id

      // Create a swimline and place a PBI so the PNG has content
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
    cy.contains('PNG Export Test').click()
    cy.url().should('include', projectId)
    cy.contains('Export PI').click()
    cy.url().should('include', piId)
  }

  it('opens the export modal when clicking Export PNG', () => {
    setupPI()
    goToBoard()
    cy.contains('button', 'Export PNG').click()
    cy.contains('Export PNG').should('be.visible')  // modal title
    cy.get('#export-pi-effort').should('not.be.checked')
    cy.get('#export-sprint-effort').should('not.be.checked')
    cy.get('#export-swimlane-effort').should('not.be.checked')
    cy.get('#export-events').should('not.be.checked')
    cy.get('#export-swimlane-center').should('not.be.checked')
    cy.get('#export-date').should('not.be.checked')
  })

  it('sends correct query params when options are toggled', () => {
    setupPI()
    goToBoard()

    cy.intercept('GET', '/api/v1/pis/*/export/png*').as('pngExport')

    cy.contains('button', 'Export PNG').click()
    cy.get('#export-events').click()
    cy.get('#export-sprint-effort').click()
    cy.contains('button', 'Export').last().click()

    cy.wait('@pngExport').its('request.url').should((url) => {
      expect(url).to.include('show_events=true')
      expect(url).to.include('show_sprint_effort=true')
      expect(url).to.include('show_pi_effort=false')
    })
  })

  it('persists toggle settings across modal re-opens', () => {
    setupPI()
    goToBoard()

    cy.intercept('GET', '/api/v1/pis/*/export/png*').as('pngExport')

    // First export: enable PI effort and export date
    cy.contains('button', 'Export PNG').click()
    cy.get('#export-pi-effort').click()
    cy.get('#export-date').click()
    cy.contains('button', 'Export').last().click()
    cy.wait('@pngExport')

    // Re-open modal and verify settings were saved
    cy.contains('button', 'Export PNG').click()
    cy.get('#export-pi-effort').should('be.checked')
    cy.get('#export-date').should('be.checked')
    cy.get('#export-events').should('not.be.checked')
  })

  it('Cancel closes the modal without triggering a download', () => {
    setupPI()
    goToBoard()

    cy.intercept('GET', '/api/v1/pis/*/export/png*').as('pngExport')

    cy.contains('button', 'Export PNG').click()
    cy.contains('button', 'Cancel').click()

    // Modal should be gone
    cy.get('#export-pi-effort').should('not.exist')

    // No export request made
    cy.get('@pngExport.all').should('have.length', 0)
  })
})
