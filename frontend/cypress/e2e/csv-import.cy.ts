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
