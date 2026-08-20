describe('Project CRUD', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
  })

  // Project-level Edit/Delete are gated on role (canEdit), not on the edit lock,
  // so an admin sees them without requesting edit mode. The action labels are
  // matched with anchored regexes: the project-name button comes first in the DOM,
  // so a substring match on "Delete" would hit a project called "To Delete".
  const projectRow = (name: string) => cy.contains('li', name)

  it('creates a project and it appears in the list', () => {
    cy.contains('button', /new project|create project/i).click()
    cy.get('input[name="name"]').type('My Project')
    cy.get('button[type="submit"]').click()
    cy.contains('My Project').should('be.visible')
  })

  it('renames a project and new name is reflected', () => {
    cy.request('POST', '/api/v1/projects/', { name: 'Original Name' })
    cy.reload()
    projectRow('Original Name').contains('button', /^Edit$/).click()
    cy.get('input[name="name"]').clear().type('Renamed Project')
    cy.get('button[type="submit"]').click()
    cy.contains('Renamed Project').should('be.visible')
    cy.contains('Original Name').should('not.exist')
  })

  it('deletes a project with confirmation and it disappears from the list', () => {
    cy.request('POST', '/api/v1/projects/', { name: 'To Delete' })
    cy.reload()
    projectRow('To Delete').contains('button', /^Delete$/).click()
    cy.get('[role="dialog"]').contains('button', /^Delete$/).click()
    cy.contains('To Delete').should('not.exist')
  })

  it('duplicate project name shows inline error', () => {
    cy.request('POST', '/api/v1/projects/', { name: 'Existing Project' })
    cy.reload()
    cy.contains('button', /new project|create project/i).click()
    cy.get('input[name="name"]').type('Existing Project')
    cy.get('button[type="submit"]').click()
    cy.contains(/already exists|name.*taken|duplicate/i).should('be.visible')
  })
})

describe('Work-item deep links', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', {
      name: 'Linked Project',
      azure_devops_url: 'https://devops.example.com/Coll/Proj',
      work_item_path_template: '_workitems/edit/{id}',
    }).then((res) => {
      projectId = res.body.system_id
    })
  })

  it('configures the Azure DevOps preset via the edit modal', () => {
    cy.reload()
    cy.contains('li', 'Linked Project').contains('button', /^Edit$/).click()
    cy.get('select#edit-proj-link-preset').should('have.value', 'azure_devops')
  })

  it('shows a work-item link on the feature edit modal', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature', id: 101 })
    cy.openProject('Linked Project')
    cy.enterEditMode()
    cy.contains('Auth Feature').should('be.visible')
    // Feature rows are divs, not list items, and the edit affordance is revealed on
    // hover — force the click rather than relying on hover state.
    cy.get('button[aria-label="Edit"]').first().click({ force: true })
    cy.contains('a', '_workitems/edit/101')
      .should('have.attr', 'href', 'https://devops.example.com/Coll/Proj/_workitems/edit/101')
      .and('have.attr', 'target', '_blank')
  })
})
