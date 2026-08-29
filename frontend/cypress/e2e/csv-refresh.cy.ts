// Importing a CSV into a project that already holds data — the workflow the
// importer is actually used for now, and the one no spec covered.
//
// `csv-import.cy.ts` imports into an empty project; `feature-split.cy.ts` plans on
// a board. Neither crosses into the other, and every defect found in the CSV
// review lived at that crossing: a 500 deleting a planned feature, continuations
// drifting from the source, partial files orphaning, silent parent changes, a
// retyped row aborting the file.
describe('CSV refresh of a project that already has data', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Refresh Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  // ── Helpers ────────────────────────────────────────────────────────────────

  const HEADER = 'Work Item Type,Title 1,ID,Effort,Parent,State'

  function upload(csv: string) {
    cy.get('input[type="file"]').selectFile(
      { contents: Cypress.Buffer.from(`${HEADER}\n${csv}`), fileName: 'refresh.csv', mimeType: 'text/csv' },
      { force: true },
    )
    // The file is read asynchronously; wait for the preview before acting on it.
    cy.contains('Rows in file').should('be.visible')
  }

  /** Confirm from the preview. `viaReconcile` when Removed rows matched something. */
  function confirmImport({ viaReconcile = false } = {}) {
    if (viaReconcile) {
      cy.contains('button', /^Next$/).click()
      cy.contains(/removed items already in the project/i).should('be.visible')
    }
    cy.contains('button', /^Confirm Import$/).click()
    cy.contains(/import complete/i).should('be.visible')
    cy.get('[role="dialog"]').contains('button', /^Close$/).click()
    cy.get('[role="dialog"]').should('not.exist')
  }

  /** Tick an opt-in by the wording of its label, so the panels stay distinguishable. */
  function tick(label: RegExp) {
    cy.contains('label', label).find('input[type="checkbox"]').check()
  }

  /** Stories are only rendered once their feature row is expanded. */
  function expandFeature(title: string) {
    cy.contains('span', title).parent().find('button[aria-label="Expand"]').click()
  }

  function openBacklogAsEditor() {
    cy.openProject('Refresh Test')
    cy.enterEditMode()
  }

  /** Seed through the API — these journeys are about the import, not the setup. */
  function seedFeature(title: string, id: number) {
    return cy.request('POST', `/api/v1/projects/${projectId}/features`, { title, id })
  }
  function seedStory(title: string, id: number, parent: string) {
    return cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
      title, id, parent_feature_system_id: parent, item_type: 'story',
    })
  }

  // ── The refresh journey ────────────────────────────────────────────────────

  it('applies a rename and adds a new story on re-import', () => {
    seedFeature('Auth', 101).then((f) => seedStory('Login form', 201, f.body.system_id))
    openBacklogAsEditor()

    upload([
      'Feature,Auth & SSO,101,,,',
      'Product Backlog Item,Login form,201,3,101,',
      'Product Backlog Item,Password reset,202,5,101,',
    ].join('\n'))
    confirmImport()

    cy.contains('Auth & SSO').should('be.visible')
    cy.contains('Auth').should('not.contain.text', 'Unassigned')
    expandFeature('Auth & SSO')
    cy.contains('Login form').should('exist')
    cy.contains('Password reset').should('exist')
  })

  it('keeps a Removed item that already exists unless it is ticked', () => {
    seedFeature('Auth', 101)
    openBacklogAsEditor()

    upload('Feature,Auth,101,,,Removed')
    confirmImport({ viaReconcile: true })

    cy.contains('Auth').should('be.visible')
  })

  it('deletes a Removed item once it is ticked', () => {
    seedFeature('Auth', 101)
    openBacklogAsEditor()

    upload('Feature,Auth,101,,,Removed')
    cy.contains('button', /^Next$/).click()
    cy.contains('label', /^Remove$/).find('input[type="checkbox"]').check()
    cy.contains(/will delete/i).should('be.visible')
    cy.contains('button', /^Confirm Import$/).click()
    cy.contains(/import complete/i).should('be.visible')
    cy.get('[role="dialog"]').contains('button', /^Close$/).click()

    cy.contains('No features in the backlog').should('be.visible')
  })

  // Before the fix this was a 500: PBI.group_id and Group.story_system_id are
  // mutual foreign keys, and a Feature cascades to both in one flush.
  it('removes a feature that is planned on a board with a story in a sprint', () => {
    seedFeature('Auth', 101).then((f) => {
      const featureId = f.body.system_id
      seedStory('Login form', 201, featureId).then((s) => {
        cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'PI-One' }).then((pi) => {
          cy.request('POST', `/api/v1/pis/${pi.body.system_id}/swimlines`, { name: 'Team A' }).then((sl) => {
            cy.request('PATCH', `/api/v1/features/${featureId}`, {
              location: 'pi', pi_id: pi.body.system_id, swimlane_id: sl.body.system_id,
            })
            cy.request('POST', `/api/v1/pbis/${s.body.system_id}/place`, { sprint_index: 0 })
          })
        })
      })
    })
    openBacklogAsEditor()

    upload('Feature,Auth,101,,,Removed')
    cy.contains('button', /^Next$/).click()
    // The reconcile row has to name the board it is on and what goes with it.
    cy.contains(/Feature on PI-One/).should('be.visible')
    cy.contains(/takes.*1 story/).should('be.visible')
    cy.contains('label', /^Remove$/).find('input[type="checkbox"]').check()
    cy.contains('button', /^Confirm Import$/).click()

    cy.contains(/import failed/i).should('not.exist')
    cy.contains(/import complete/i).should('be.visible')
    cy.get('[role="dialog"]').contains('button', /^Close$/).click()

    cy.openPI('PI-One')
    cy.contains('Auth').should('not.exist')
  })

  // Only the lineage root carries the ID, so nothing in the file names the
  // continuation — it has to be reached by walking the lineage.
  it('carries a rename into the later PI of a split feature', () => {
    seedFeature('Auth', 101).then((f) => {
      const featureId = f.body.system_id
      seedStory('Stays here', 201, featureId)
      seedStory('Carried over', 202, featureId).then((carried) => {
        cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'PI-One' }).then((pi1) => {
          cy.request('POST', `/api/v1/pis/${pi1.body.system_id}/swimlines`, { name: 'Team A' }).then((sl1) => {
            cy.request('PATCH', `/api/v1/features/${featureId}`, {
              location: 'pi', pi_id: pi1.body.system_id, swimlane_id: sl1.body.system_id,
            })
            cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'PI-Two' }).then((pi2) => {
              cy.request('POST', `/api/v1/pis/${pi2.body.system_id}/swimlines`, { name: 'Team A' }).then((sl2) => {
                cy.request('POST', `/api/v1/features/${featureId}/split`, {
                  target_pi_id: pi2.body.system_id,
                  target_swimline_id: sl2.body.system_id,
                  pbi_ids: [carried.body.system_id],
                })
              })
            })
          })
        })
      })
    })
    openBacklogAsEditor()

    upload('Feature,Auth & SSO,101,,,')
    confirmImport()

    cy.openPI('PI-One')
    cy.contains('Auth & SSO').should('be.visible')
    cy.openPI('PI-Two')
    cy.contains('Auth & SSO').should('be.visible')
    cy.contains('Auth').should('not.contain.text', 'Auth,')
  })

  // ── C1: a Parent the file does not list ────────────────────────────────────

  it('links a partial file to a parent that exists only in the project', () => {
    seedFeature('Auth', 101)
    openBacklogAsEditor()

    // No Feature row at all — the incremental export ADO produces mid-sprint.
    upload('Product Backlog Item,Found mid-sprint,301,3,101,')
    cy.contains('button', /^Confirm Import$/).click()
    cy.contains(/import complete/i).should('be.visible')
    cy.contains(/linked to a feature already in the project/i).should('be.visible')
    cy.get('[role="dialog"]').contains('button', /^Close$/).click()

    cy.contains('Unassigned').should('not.exist')
    expandFeature('Auth')
    cy.contains('Found mid-sprint').should('exist')
  })

  // A Parent column holding titles rather than IDs used to import cleanly and pile
  // every story into "Unassigned". The file is now rejected instead.
  it('rejects a Parent that names no ID rather than orphaning the story', () => {
    seedFeature('Auth', 101)
    openBacklogAsEditor()

    cy.get('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.from(`${HEADER}\nProduct Backlog Item,Login form,201,3,Auth,`),
        fileName: 'refresh.csv',
        mimeType: 'text/csv',
      },
      { force: true },
    )
    cy.contains(/Parent "Auth" does not name an ID/).should('be.visible')
    cy.contains('button', /^Confirm Import$/).should('be.disabled')
  })

  // ── C2: a Parent that has changed ──────────────────────────────────────────

  it('leaves a changed parent alone unless the move is ticked', () => {
    seedFeature('Auth', 101).then((f) => seedStory('Login form', 201, f.body.system_id))
    seedFeature('Payments', 102)
    openBacklogAsEditor()

    upload('Product Backlog Item,Login form,201,3,102,')
    cy.contains(/1 story has moved to a different feature/i).should('be.visible')
    confirmImport()

    expandFeature('Auth')
    cy.contains('Login form').should('exist')
  })

  it('moves a story to the feature the file names once the move is ticked', () => {
    seedFeature('Auth', 101).then((f) => seedStory('Login form', 201, f.body.system_id))
    seedFeature('Payments', 102)
    openBacklogAsEditor()

    upload('Product Backlog Item,Login form,201,3,102,')
    tick(/moved to a different feature/i)
    confirmImport()

    expandFeature('Payments')
    cy.contains('Login form').should('exist')
  })

  // ── C6: a work item type that has changed ──────────────────────────────────

  it('promotes a story to a feature once the change is ticked', () => {
    seedFeature('Auth', 101).then((f) => seedStory('Password reset', 201, f.body.system_id))
    openBacklogAsEditor()

    upload('Feature,Account recovery,201,,,')
    cy.contains(/1 story is a feature in this file/i).should('be.visible')
    tick(/is a feature in this file/i)
    confirmImport()

    // A promoted item is a top-level feature: visible without expanding anything.
    cy.contains('Account recovery').should('be.visible')
    expandFeature('Auth')
    cy.contains('Password reset').should('not.exist')
  })

  it('reports a feature arriving as a story without converting it', () => {
    seedFeature('Auth', 101)
    openBacklogAsEditor()

    upload('Product Backlog Item,Auth is now a story,101,3,,')
    cy.contains(/1 feature is a story in this file/i).should('be.visible')
    cy.contains(/Not converted/i).should('be.visible')
    cy.get('input[type="checkbox"]').should('not.exist')
    confirmImport()

    // Untouched: still a feature, still under its own title.
    cy.contains('Auth').should('be.visible')
    cy.contains('Auth is now a story').should('not.exist')
  })

  // The finding this replaced: one retyped row used to abort the whole file.
  it('imports the rest of the file around a type change it will not apply', () => {
    seedFeature('Auth', 101)
    openBacklogAsEditor()

    upload([
      'Product Backlog Item,Auth is now a story,101,3,,',
      'Feature,Payments,102,,,',
      'Product Backlog Item,Checkout,301,5,102,',
    ].join('\n'))
    confirmImport()

    cy.contains('Payments').should('be.visible')
    cy.contains('Auth').should('be.visible')
    expandFeature('Payments')
    cy.contains('Checkout').should('exist')
  })
})
