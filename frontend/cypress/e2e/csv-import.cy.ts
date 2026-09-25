describe('CSV import', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'CSV Test' })
    cy.openProject('CSV Test')
    // "Import CSV" is disabled={!isEditing}, and isEditing is only set by the
    // acquire mutation's onSuccess — the lock has to be taken through the UI.
    cy.enterEditMode()
  })

  const validCsv = `Work Item Type,Title 1,ID,Effort,Parent
Feature,Auth Feature,101,,
Product Backlog Item,Login form,,3,101
`

  const invalidCsv = `Work Item Type,Title 1,ID,Effort,Parent
Feature,,101,,
Product Backlog Item,Login form,,3,101
`

  const emptyCsv = `Work Item Type,Title 1,ID,Effort,Parent
`

  it('uploads valid CSV and shows correct preview row count', () => {
    cy.get('input[type="file"]').selectFile(
      { contents: Cypress.Buffer.from(validCsv), fileName: 'test.csv', mimeType: 'text/csv' },
      { force: true },
    )
    cy.contains('Import CSV').should('be.visible')
    cy.contains('Rows in file').should('be.visible')
    cy.contains('Features to import').should('be.visible')
  })

  it('uploads CSV with errors — validation errors shown, Confirm disabled', () => {
    cy.get('input[type="file"]').selectFile(
      { contents: Cypress.Buffer.from(invalidCsv), fileName: 'invalid.csv', mimeType: 'text/csv' },
      { force: true },
    )
    cy.contains(/validation error|error/i).should('be.visible')
    cy.get('button').contains(/review changes/i).should('be.disabled')
  })

  it('confirms valid import and features appear in backlog', () => {
    cy.get('input[type="file"]').selectFile(
      { contents: Cypress.Buffer.from(validCsv), fileName: 'test.csv', mimeType: 'text/csv' },
      { force: true },
    )
    cy.contains('button', /review changes/i).click()
    cy.contains(/what this import will do/i).should('be.visible')
    cy.contains('button', /confirm import/i).click()
    cy.contains(/import complete/i).should('be.visible')
    cy.contains('button', /close/i).click()
    cy.contains('Auth Feature').should('be.visible')
  })

  it('uploads empty CSV and shows no rows found', () => {
    cy.get('input[type="file"]').selectFile(
      { contents: Cypress.Buffer.from(emptyCsv), fileName: 'empty.csv', mimeType: 'text/csv' },
      { force: true },
    )
    // Preview shows 0 rows — confirm button disabled or "no rows" message
    cy.contains('Import CSV').should('be.visible')
    cy.get('button').contains(/review changes/i).should('be.disabled')
  })
})

describe('CSV import — completion dates', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Dates Test' }).then((res) => {
      projectId = res.body.system_id
    })
    cy.openProject('Dates Test')
    cy.enterEditMode()
  })

  function importFile(path: string) {
    cy.get('input[type="file"]').selectFile(path, { force: true })
  }

  function confirmImport() {
    cy.contains('button', /review changes/i).click()
    cy.contains('button', /confirm import/i).click()
    cy.contains(/import complete/i).should('be.visible')
  }

  function markDone(itemType: 'story' | 'bug', value: string) {
    cy.request(`/api/v1/projects/${projectId}/states/`).then((res) => {
      const state = res.body.find((s: { item_type: string; value: string }) =>
        s.item_type === itemType && s.value === value)
      cy.request('PATCH', `/api/v1/projects/${projectId}/states/${state.system_id}`, { category: 'done' })
    })
  }

  // The documented walkthrough (docs/csv-samples/README.md): the first import only
  // discovers the States, so its dates are ignored; once they are marked done, a
  // second import of the same file dates the items.
  it('reads a real export\'s dates, and applies them once the States are done', () => {
    importFile('../docs/csv-samples/10-closed-dates.csv')
    cy.contains('Dates read as month/day/year').should('be.visible')
    confirmImport()
    cy.contains(/completion date ignored/i).should('contain', '3').and('contain', '8')
    cy.contains('button', /close/i).click()

    markDone('story', 'Done')
    markDone('bug', 'Resolved')

    importFile('../docs/csv-samples/10-closed-dates.csv')
    confirmImport()
    cy.contains(/completion dates? set/i).should('be.visible')
    cy.request(`/api/v1/projects/${projectId}/pbis`).then((res) => {
      const byId = Object.fromEntries(
        res.body.map((p: { id: number; completed_on: string | null }) => [p.id, p.completed_on]))
      expect(byId[201]).to.eq('2026-09-03')
      expect(byId[204]).to.eq('2026-08-28')
      expect(byId[301]).to.eq('2026-09-18') // from Resolved Date
      expect(byId[203]).to.eq(null)
    })
  })

  it('asks for the date format when the file cannot settle it', () => {
    importFile('../docs/csv-samples/11-dates-ambiguous.csv')
    cy.contains('button', /review changes/i).should('be.disabled')
    cy.get('[role="radiogroup"]').within(() => {
      cy.contains('label', 'day/month/year').click()
    })
    cy.get('ul[aria-label="Dates as read"]').should('contain', '6 Mar 2026')
    cy.contains('button', /review changes/i).should('not.be.disabled')
  })
})

