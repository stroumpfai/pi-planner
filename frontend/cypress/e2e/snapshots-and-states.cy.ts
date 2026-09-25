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
    cy.contains('li', 'Snapshot Test').find('button[aria-label="Snapshots"]').click()
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
    cy.contains('li', 'States Test').find('button[aria-label="Edit"]').click()
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

describe('Done-ness and completion dates', () => {
  let projectId: string
  let doneStateId: string

  // Setup writes need the edit lock; it is released again so the UI can take it
  // through cy.enterEditMode(), which is what sets the client-side isEditing flag.
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Done Test' }).then((res) => {
      projectId = res.body.system_id
      cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
      cy.request('POST', `/api/v1/projects/${projectId}/states/`, {
        item_type: 'story', value: 'Ready for Test',
      })
      cy.request('POST', `/api/v1/projects/${projectId}/states/`, {
        item_type: 'story', value: 'Done',
      }).then((stateRes) => {
        doneStateId = stateRes.body.system_id
      })
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Checkout' })
        .then((featureRes) => {
          cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
            title: 'Pay by card', parent_feature_system_id: featureRes.body.system_id,
          })
        })
    })
  })

  function storyStates() {
    return cy.get('[data-testid="state-list-story"]')
  }

  it('marks a State as done, never guessing from its name', () => {
    cy.visit('/')
    cy.contains('li', 'Done Test').find('button[aria-label="Edit"]').click()
    cy.contains('button', /manage states/i).click()

    // Imported or typed, a State called "Done" starts uncategorised (ADR 0006).
    storyStates().find('select[aria-label="Category of Done"]').should('have.value', '')
    cy.intercept('PATCH', '**/states/*').as('categorise')
    storyStates().find('select[aria-label="Category of Done"]').select('done')
    cy.wait('@categorise').its('response.statusCode').should('eq', 200)
    storyStates().find('select[aria-label="Category of Ready for Test"]').should('have.value', '')

    cy.then(() => {
      cy.request(`/api/v1/projects/${projectId}/states/`).then((res) => {
        const done = res.body.find((s: { value: string }) => s.value === 'Done')
        expect(done.category).to.eq('done')
      })
    })
  })

  it('dates a story when it moves into a done State', () => {
    cy.then(() => {
      cy.request('PATCH', `/api/v1/projects/${projectId}/states/${doneStateId}`, { category: 'done' })
      cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/release`)
    })
    cy.openProject('Done Test')
    cy.enterEditMode()
    cy.contains('Checkout').should('be.visible')
    cy.get('button[aria-label="Expand"]').first().click()
    cy.contains('div', 'Pay by card').find('button[aria-label="Edit"]').first().click({ force: true })

    cy.get('[role="dialog"]').within(() => {
      cy.get('#pbi-completed-on').should('be.disabled')
      cy.get('[data-testid="state-select"]').select('Done')
      cy.get('#pbi-completed-on').should('not.be.disabled').and('not.have.value', '')
      cy.intercept('PATCH', '**/api/v1/pbis/*').as('save')
      cy.intercept('GET', '**/pbis?feature_id=*').as('refetch')
      cy.get('button[type="submit"]').click()
    })
    cy.get('[role="dialog"]').should('not.exist')
    cy.wait('@save').its('response.body.completed_on').should('match', /^\d{4}-\d{2}-\d{2}$/)
    cy.wait('@refetch')

    // The server stamps the date; the reopened modal shows exactly what it stored.
    cy.request(`/api/v1/projects/${projectId}/pbis`).then((res) => {
      const iso: string = res.body[0].completed_on
      expect(iso).to.match(/^\d{4}-\d{2}-\d{2}$/)
      const [y, m, d] = iso.split('-')
      cy.contains('div', 'Pay by card').find('button[aria-label="Edit"]').first().click({ force: true })
      cy.get('[role="dialog"]').find('#pbi-completed-on').should('have.value', `${d}.${m}.${y}`)
    })
  })
})
