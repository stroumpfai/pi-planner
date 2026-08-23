describe('Project snapshots', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Snapshot Test' }).then((res) => {
      projectId = res.body.system_id
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Feature Before' })
    })
  })

  function openSnapshots() {
    cy.visit('/')
    cy.contains('li', 'Snapshot Test').contains('button', /^Snapshots$/).click()
    cy.get('[role="dialog"]').should('be.visible')
  }

  it('creates a named snapshot and lists it', () => {
    openSnapshots()
    cy.get('#snapshot-name').type('Before replanning')
    cy.contains('button', /create snapshot/i).click()
    cy.contains('Before replanning').should('be.visible')
  })

  it('restores a snapshot and the project returns to its captured contents', () => {
    cy.then(() => {
      cy.request('POST', `/api/v1/projects/${projectId}/snapshots`, { name: 'Baseline' })
      // Diverge from the snapshot: add a feature that the restore must remove.
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Feature After' })
    })

    cy.openProject('Snapshot Test')
    cy.contains('Feature After').should('be.visible')

    openSnapshots()
    cy.get('[role="dialog"]').contains('button', /^Restore$/).click()
    // The confirm dialog stacks on top of the snapshots modal, so both match
    // [role="dialog"] — the confirm is the last one and the only interactive one.
    cy.get('[role="dialog"]').last().contains('button', /^Restore$/).click()

    cy.openProject('Snapshot Test')
    cy.contains('Feature Before').should('be.visible')
    cy.contains('Feature After').should('not.exist')
  })
})

describe('Project State lists', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'States Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  function openStatesEditor() {
    cy.visit('/')
    cy.contains('li', 'States Test').contains('button', /^Edit$/).click()
    cy.contains('button', /manage states/i).click()
    cy.get('[data-testid="state-list-feature"]').should('be.visible')
  }

  it('adds a State to the feature list', () => {
    openStatesEditor()
    cy.get('[data-testid="state-list-feature"]').within(() => {
      cy.get('input[placeholder*="Add a Feature State"]').type('In Review')
      cy.contains('button', /^Add$/).click()
      cy.contains('In Review').should('be.visible')
    })
  })

  it('keeps the three item-type lists separate', () => {
    openStatesEditor()
    cy.get('[data-testid="state-list-feature"]').within(() => {
      cy.get('input[placeholder*="Add a Feature State"]').type('Feature Only{enter}')
    })
    cy.get('[data-testid="state-list-feature"]').should('contain', 'Feature Only')
    cy.get('[data-testid="state-list-story"]').should('not.contain', 'Feature Only')
    cy.get('[data-testid="state-list-bug"]').should('not.contain', 'Feature Only')
  })

  // Vocabulary is deliberate: a State that items reference must not vanish silently.
  it('refuses to delete a State that is in use', () => {
    cy.then(() => {
      // Creating a State is a write, so it needs the edit lock; the schema field
      // is `value`, not `name`.
      cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
      cy.request('POST', `/api/v1/projects/${projectId}/states/`, {
        item_type: 'feature', value: 'Committed',
      }).then((stateRes) => {
        cy.request('POST', `/api/v1/projects/${projectId}/features`, {
          title: 'Uses The State', state_id: stateRes.body.system_id,
        })
      })
    })

    openStatesEditor()
    cy.get('[data-testid="state-list-feature"]').within(() => {
      cy.contains('Committed').should('be.visible')
      cy.get('button[aria-label="Delete Committed"]').click({ force: true })
    })
    cy.contains(/in use|cannot|1 item/i).should('be.visible')
    cy.get('[data-testid="state-list-feature"]').should('contain', 'Committed')
  })
})
