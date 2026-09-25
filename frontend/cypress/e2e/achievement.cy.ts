/**
 * The team's Achievement view (spec/team-achievement.md §5).
 *
 * The journey: a team serves a project whose "Done" State is declared done; a
 * story completed inside the first sprint shows up in that sprint's column, and
 * one completed before the calendar begins shows up in the footer, never in a
 * column. Setup is over the API; the reading is done in the view.
 */

const achievementTab = (name: string) => cy.get('nav[aria-label="Team views"]').contains('button', name)

function seedAchievement() {
  cy.request('POST', '/api/v1/teams', { name: 'Platform' }).then((teamRes) => {
    const teamId = teamRes.body.system_id
    cy.request('POST', `/api/v1/teams/${teamId}/members`, {
      name: 'Marta Lindqvist', pattern: { effective_from: '2026-01-01' },
    })
    cy.request('POST', '/api/v1/projects/', { name: 'ISK Portal' }).then((projectRes) => {
      const pid = projectRes.body.system_id
      cy.request('POST', `/api/v1/projects/${pid}/pis`, { name: 'Q2-2026', start_date: '2026-04-06' })
        .then((piRes) => {
          cy.wrap(piRes.body.system_id).as('piId')
          cy.request('GET', `/api/v1/pis/${piRes.body.system_id}/sprints`).then((sprintRes) => {
            const first = sprintRes.body.find((s: { sprint_index: number }) => s.sprint_index === 0)
            cy.request('PATCH', `/api/v1/sprints/${first.system_id}`, {
              start_date: '2026-04-06', end_date: '2026-04-17',
            })
          })
        })
      cy.request('POST', `/api/v1/teams/${teamId}/projects`, {
        project_id: pid, available_source: 'factor', units_per_pd: 1.5,
      })

      // Item writes need the project's edit lock; released again at the end.
      cy.request('POST', `/api/v1/projects/${pid}/edit-lock/acquire`)
      cy.request('POST', `/api/v1/projects/${pid}/states/`, {
        item_type: 'story', value: 'Done', category: 'done',
      }).then((stateRes) => {
        const done = stateRes.body.system_id
        cy.request('POST', `/api/v1/projects/${pid}/features`, { title: 'Checkout' }).then((featureRes) => {
          const story = (title: string, effort: number, completedOn: string) =>
            cy.request('POST', `/api/v1/projects/${pid}/pbis`, {
              title, effort, parent_feature_system_id: featureRes.body.system_id, state_id: done,
            }).then((pbiRes) => {
              cy.request('PATCH', `/api/v1/pbis/${pbiRes.body.system_id}`, { completed_on: completedOn })
            })
          story('Pay by card', 5, '2026-04-10')
          story('Legacy cleanup', 3, '2026-01-15')
        })
      })
      cy.request('POST', `/api/v1/projects/${pid}/edit-lock/release`)
    })
  })
}

describe('Team achievement', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    seedAchievement()
    cy.openTeam('Platform')
    achievementTab('Achievement').click()
  })

  it('counts a story in the sprint it was completed in', () => {
    cy.get('table[aria-label="Achievement per sprint"]').should('contain', 'Q2-2026.1')
    cy.get('button[aria-label="ISK Portal achieved, Q2-2026.1: 5 pts"]').click()
    cy.get('[aria-label="Items achieved by ISK Portal in Q2-2026.1"]')
      .should('contain', 'Pay by card')
      .and('contain', '10.04.2026')
      .and('not.contain', 'Legacy cleanup')
  })

  it('puts work completed before the calendar in the footer, not in a column', () => {
    cy.contains('[role="note"]', /^Outside the calendar/).should('contain', '3 pts')
    cy.get('button[aria-label^="ISK Portal achieved, Q2-2026.1: 8"]').should('not.exist')
  })
})

describe('Measured velocity', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    seedAchievement()
    // Only closed sprints are measured: an open one is still accumulating.
    cy.get<string>('@piId').then((piId) => {
      cy.request('GET', '/api/v1/projects/').then((res) => {
        const pid = res.body.find((p: { name: string }) => p.name === 'ISK Portal').system_id
        cy.request('POST', `/api/v1/projects/${pid}/edit-lock/acquire`)
        cy.request('PATCH', `/api/v1/pis/${piId}`, { state: 'closed' })
        cy.request('POST', `/api/v1/projects/${pid}/edit-lock/release`)
      })
    })
    cy.openTeam('Platform')
    achievementTab('Projects').click()
  })

  it('suggests the measured factor, and fills it without saving', () => {
    cy.contains('li', 'ISK Portal').contains('button', /^Edit$/).click()
    cy.get('[role="dialog"]').within(() => {
      // 5 pts in the one closed, dated sprint, over 10 PD: ten 8 h days at focus 1.
      cy.get('[role="group"][aria-label="Measured velocity"]')
        .should('contain', '0.50 pts/PD')
        .and('contain', '(of 3 asked)')
      cy.contains('button', 'Use this value').click()
      cy.get('input[name="units_per_pd"]').should('have.value', '0.5')
    })

    // Filled, not saved: the assignment still holds the typed 1.5.
    cy.request('GET', '/api/v1/teams').then((teams) => {
      cy.request(`/api/v1/teams/${teams.body[0].system_id}/projects`).then((res) => {
        expect(res.body[0].units_per_pd).to.eq(1.5)
      })
    })
  })
})

