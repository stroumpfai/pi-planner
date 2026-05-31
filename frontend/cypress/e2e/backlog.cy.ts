describe('Core backlog journey', () => {
  let projectId: string

  beforeEach(() => {
    cy.request('POST', '/api/v1/test/reset')
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Backlog Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  function acquireEditLock() {
    cy.request('POST', `/api/v1/projects/${projectId}/edit-lock/acquire`)
    cy.reload()
  }

  it('creates a feature and it appears with [id] Title format', () => {
    acquireEditLock()
    cy.contains('button', /request edit mode/i).click()
    cy.contains('button', /\+ feature/i).click()
    cy.get('input[name="title"]').type('Auth Feature')
    cy.get('input[name="id"]').type('101')
    cy.get('button[type="submit"]').click()
    cy.contains('[101]').should('be.visible')
    cy.contains('Auth Feature').should('be.visible')
  })

  it('adds a PBI to a feature and it appears listed under it', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature' }).then(() => {
      acquireEditLock()
      cy.contains('Auth Feature').should('be.visible')
      cy.contains('Auth Feature').closest('[data-feature-row], li').find('button[aria-label*="expand" i], button').first().click()
      cy.contains('button', /\+ pbi|\+ story/i).click()
      cy.get('input[name="title"]').type('Login form')
      cy.get('button[type="submit"]').click()
      cy.contains('Login form').should('be.visible')
    })
  })

  it('adds a Bug-type PBI and it appears with Bug label', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature' })
    acquireEditLock()
    cy.contains('Auth Feature').closest('[data-feature-row], li').find('button').first().click()
    cy.contains('button', /\+ bug/i).click()
    cy.get('input[name="title"]').type('Login crash')
    cy.get('button[type="submit"]').click()
    cy.contains('Login crash').should('be.visible')
    cy.contains(/bug/i).should('be.visible')
  })

  it('edits feature title and user_id — changes persist after reload', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Original Title' }).then(() => {
      acquireEditLock()
      cy.contains('Original Title').closest('[data-feature-row], li').find('button[aria-label*="edit" i], button').first().click()
      cy.get('input[name="title"]').clear().type('Updated Title')
      cy.get('input[name="id"]').type('202')
      cy.get('button[type="submit"]').click()
      cy.contains('Updated Title').should('be.visible')
      cy.reload()
      cy.contains('Updated Title').should('be.visible')
      cy.contains('[202]').should('be.visible')
    })
  })

  it('deletes a PBI and then a feature — both disappear', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'To Delete Feature' }).then((featureRes) => {
      cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
        title: 'PBI to delete',
        parent_feature_system_id: featureRes.body.system_id,
        item_type: 'story',
      })
      acquireEditLock()
      cy.contains('To Delete Feature').closest('[data-feature-row], li').find('button').first().click()
      cy.contains('PBI to delete').closest('li, [data-pbi]').find('button[aria-label*="delete" i]').click()
      cy.contains('button', /confirm|delete/i).last().click()
      cy.contains('PBI to delete').should('not.exist')
      cy.contains('To Delete Feature').closest('[data-feature-row], li').find('button[aria-label*="delete" i]').click()
      cy.contains('button', /confirm|delete/i).last().click()
      cy.contains('To Delete Feature').should('not.exist')
    })
  })
})
