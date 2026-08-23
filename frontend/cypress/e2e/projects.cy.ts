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

// Export and import move a whole project in bulk, and the import rebuilds every
// ID on the way in — the kind of thing that breaks silently. The round-trip is
// driven end to end: what the export actually returned is what gets uploaded.
describe('Project JSON export and import', () => {
  let projectId: string

  const projectRow = (name: string) => cy.contains('li', name)

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Portable' }).then((res) => {
      projectId = res.body.system_id
      cy.request('POST', `/api/v1/projects/${projectId}/features`, {
        title: 'Exported Feature',
        id: 404,
      }).then((fRes) => {
        cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
          title: 'Exported Story',
          parent_feature_system_id: fRes.body.system_id,
          item_type: 'story',
        })
      })
      cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Exported PI' }).then((piRes) => {
        cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Exported Lane' })
      })
    })
    cy.reload()
  })

  // The button builds a blob and clicks a synthetic <a download>, which the
  // browser handles outside the page — so the request is what there is to
  // observe, and its body is what the import half consumes.
  function exportProject() {
    cy.intercept('GET', '/api/v1/projects/*/export').as('exportProject')
    projectRow('Portable').contains('button', /^Export$/).click()
    return cy.wait('@exportProject').its('response')
  }

  it('exports the project as JSON carrying its contents', () => {
    exportProject().then((response) => {
      expect(response?.statusCode).to.equal(200)
      expect(response?.headers['content-disposition']).to.match(/filename="?Portable_\d{4}-\d{2}-\d{2}\.json/)

      const payload = response?.body
      expect(payload.project.name).to.equal('Portable')
      expect(payload.project.features.map((f: { title: string }) => f.title)).to.include('Exported Feature')
      expect(payload.project.pis.map((p: { name: string }) => p.name)).to.include('Exported PI')
    })
  })

  it('re-imports an exported file as a second, independent project', () => {
    exportProject().then((response) => {
      cy.get('input[aria-label="Import project file"]').selectFile(
        {
          contents: Cypress.Buffer.from(JSON.stringify(response?.body)),
          fileName: 'Portable.json',
          mimeType: 'application/json',
        },
        { force: true },
      )
    })

    // The name collides with the original, so the backend disambiguates it.
    cy.contains('li', 'Portable (imported)').should('be.visible')
    cy.contains('li', /^Portable/).should('exist')

    cy.openProject('Portable (imported)')
    cy.contains('[404]').should('be.visible')
    cy.contains('Exported Feature').should('be.visible')
    cy.openPI('Exported PI')
    cy.contains('Exported Lane').should('be.visible')
  })

  it('reports a malformed import file instead of failing silently', () => {
    cy.get('input[aria-label="Import project file"]').selectFile(
      {
        contents: Cypress.Buffer.from('this is not json'),
        fileName: 'broken.json',
        mimeType: 'application/json',
      },
      { force: true },
    )

    cy.contains(/Import failed|Expecting value/i).should('be.visible')
  })
})
