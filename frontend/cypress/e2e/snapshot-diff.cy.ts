// The snapshot diff has no in-app UI — it is an API surface consumed by the MCP
// server, rendered server-side by services/snapshot_diff_html.py. Its semantics
// are covered thoroughly in backend/tests/integration/test_snapshot_diff.py, so
// this spec deliberately stays thin and only covers what pytest structurally
// cannot: that the page loads in a browser under plain session-cookie auth (the
// SPA catch-all does not swallow the path), and that the auto-refresh script —
// inert unless actually served over http — really re-fetches and swaps content.
describe('Snapshot diff page', () => {
  let projectId: string

  const diffUrl = (query = '') =>
    `/api/v1/projects/${projectId}/snapshots/diff/html${query}`

  const addFeature = (title: string) =>
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title })

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Diff Test' }).then((res) => {
      projectId = res.body.system_id
      addFeature('Feature Before')
      cy.request('POST', `/api/v1/projects/${projectId}/snapshots`, { name: 'Baseline' })
    })
  })

  it('renders the diff in a browser for a logged-in editor', () => {
    addFeature('Feature After')

    cy.then(() => cy.visit(diffUrl()))

    cy.contains('h1', 'Changes since snapshot').should('be.visible')
    cy.contains('Baseline').should('be.visible')
    cy.contains('.badge', 'Whole project').should('be.visible')
    cy.contains('h2', 'Features').should('be.visible')
    cy.get('.row.added .name').should('contain', 'Feature After')
    cy.get('.row').should('not.contain', 'Feature Before') // unchanged, so absent
  })

  it('says so when nothing has changed since the snapshot', () => {
    cy.then(() => cy.visit(diffUrl()))

    cy.contains('No changes since this snapshot.').should('be.visible')
    cy.get('.row').should('not.exist')
  })

  // refresh_seconds arms a setInterval that re-fetches the page and swaps the
  // body in place. It short-circuits on non-http protocols, so a browser is the
  // only place it runs at all.
  it('picks up later changes through the auto-refresh script', () => {
    addFeature('Feature After')

    cy.then(() => cy.visit(diffUrl('?refresh_seconds=1')))
    cy.get('.row.added .name').should('contain', 'Feature After')

    addFeature('Added While Watching')

    // No reload — the page has to bring this in on its own.
    cy.contains('.row.added .name', 'Added While Watching', { timeout: 15000 })
      .should('be.visible')
  })
})
