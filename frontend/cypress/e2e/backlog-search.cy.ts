describe('Backlog search in the PI view', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Search Test' }).then((res) => {
      projectId = res.body.system_id
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature', id: 101 })
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Billing Feature', id: 202 })
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Reporting Feature', id: 303 })
      cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
        cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Team A' })
      })
    })
  })

  // The app has no URL routing — navigation is driven by uiStore, so we click through:
  // project list -> project -> the PI in the left-hand PI list panel.
  function goToPI() {
    cy.visit('/')
    cy.contains('Search Test').click()
    cy.contains('button', 'Q1-2026').click()
    cy.get('[data-testid="backlog-panel"]').should('be.visible')
  }

  // Must be clicked in the UI: `isEditing` lives in the client-side authStore and is
  // only set by the acquire mutation's onSuccess, so a bare API call leaves the board
  // read-only and silently drops every drop.
  function enterEditMode() {
    cy.contains('button', 'Request Edit Mode').click()
    cy.contains('You • Editor').should('be.visible')
  }

  function openSearch() {
    cy.get('button[aria-label="Search backlog"]').click()
    return cy.get('input[aria-label="Search backlog by ID or title"]')
  }

  const backlog = () => cy.get('[data-testid="backlog-list"]')

  it('filters the backlog by title', () => {
    goToPI()
    backlog().should('contain', 'Auth Feature').and('contain', 'Billing Feature')
    openSearch().type('bill')
    backlog().should('contain', 'Billing Feature')
    backlog().should('not.contain', 'Auth Feature')
    backlog().should('not.contain', 'Reporting Feature')
  })

  it('filters the backlog by user id', () => {
    goToPI()
    openSearch().type('303')
    backlog().should('contain', 'Reporting Feature')
    backlog().should('not.contain', 'Auth Feature')
    backlog().should('not.contain', 'Billing Feature')
  })

  it('shows No matches when nothing matches', () => {
    goToPI()
    openSearch().type('zzzz')
    backlog().should('contain', 'No matches')
  })

  it('closes and clears the filter on Escape', () => {
    goToPI()
    openSearch().type('bill').type('{esc}')
    cy.get('input[aria-label="Search backlog by ID or title"]').should('not.exist')
    backlog()
      .should('contain', 'Auth Feature')
      .and('contain', 'Billing Feature')
      .and('contain', 'Reporting Feature')
  })

  it('drags a filtered feature into a swimlane and keeps the remaining list usable', () => {
    goToPI()
    enterEditMode()
    openSearch().type('auth')
    backlog().should('contain', 'Auth Feature').and('not.contain', 'Billing Feature')

    // dnd-kit's PointerSensor needs >5px of movement to activate, and the drop zone's
    // label changes once it is hovered, so resolve its coordinates up front and drive
    // the pointer over <body> in viewport space.
    cy.contains('Drop features here').then(($zone) => {
      const rect = $zone[0].getBoundingClientRect()
      const x = Math.round(rect.left + rect.width / 2)
      const y = Math.round(rect.top + rect.height / 2)
      backlog().contains('Auth Feature').realMouseDown()
      cy.get('body').realMouseMove(x - 150, y)
      cy.get('body').realMouseMove(x, y)
      cy.get('body').realMouseUp()
    })

    // The feature left the backlog but is still on the board, inside the swimlane.
    backlog().should('not.contain', 'Auth Feature')
    cy.contains('Auth Feature').should('be.visible')

    // The still-open search box keeps working on what is left.
    cy.get('input[aria-label="Search backlog by ID or title"]')
      .clear()
      .type('bill')
    backlog().should('contain', 'Billing Feature').and('not.contain', 'Reporting Feature')
  })
})
