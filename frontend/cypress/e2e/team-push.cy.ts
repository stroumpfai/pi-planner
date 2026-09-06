/**
 * The number reaching the board (teams.md §6.6–§6.8).
 *
 * The whole journey in one spec, because that is what step 7 ships: a team with
 * a member serves a project on a conversion factor, the home page says the board
 * is behind, the push writes the sprint headers, and an absence makes the number
 * drop and the badge come back.
 *
 * Team writes take no edit lock (§4.1) — the push does, but as the *editor* this
 * session already is, so there is still nothing to acquire here.
 */

const pushTab = (name: string) =>
  cy.get('nav[aria-label="Team views"]').contains('button', name)
const pushDialog = () => cy.get('[role="dialog"]')

/**
 * A team of one full-timer serving one project, on 1.5 pts per person-day.
 *
 * 10 working days × 8 h ÷ 8 h = 10 PD, at 100% share × 1.5 = 15 pts per sprint —
 * whole numbers, so the assertions below are about the push rather than about
 * rounding, which the backend tests cover on its own.
 */
function seedPush() {
  cy.request('POST', '/api/v1/teams', { name: 'Platform' }).then((team) => {
    cy.request('POST', `/api/v1/teams/${team.body.system_id}/members`, {
      name: 'Marta Lindqvist',
      pattern: { effective_from: '2026-01-01', hours_per_day: 8, focus: 1 },
    })
    cy.wrap(team.body.system_id).as('teamId')
  })
  cy.request('POST', '/api/v1/projects/', { name: 'ISK Portal' }).then((project) => {
    cy.wrap(project.body.system_id).as('projectId')
    cy.request('POST', `/api/v1/projects/${project.body.system_id}/pis`, {
      name: 'Q2-2026',
      start_date: '2026-04-06',
    }).then((pi) => {
      cy.request('GET', `/api/v1/pis/${pi.body.system_id}/sprints`).then((sprints) => {
        const dates = [
          ['2026-04-06', '2026-04-17'],
          ['2026-04-20', '2026-05-01'],
        ]
        dates.forEach(([start, end], index) => {
          const sprint = sprints.body.find(
            (s: { sprint_index: number }) => s.sprint_index === index,
          )
          cy.request('PATCH', `/api/v1/sprints/${sprint.system_id}`, {
            start_date: start,
            end_date: end,
          })
        })
      })
    })
  })
}

/** Serve the project on a factor, which is what makes a push possible at all. */
function assignWithFactor() {
  cy.get('@teamId').then((teamId) => {
    cy.get('@projectId').then((projectId) => {
      cy.request('POST', `/api/v1/teams/${teamId}/projects`, {
        project_id: projectId,
        share_pct: 100,
        available_source: 'factor',
        units_per_pd: 1.5,
      })
    })
  })
}

describe('Pushing team capacity to a project', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    seedPush()
  })

  it('carries a team change through to the board, and only on an explicit push', () => {
    assignWithFactor()

    // The home page pairs the project with the team that feeds it, so a board
    // behind its team is visible without opening either (§7.0).
    cy.visit('/')
    cy.get('section[aria-labelledby="projects-heading"]')
      .contains('li', 'ISK Portal')
      .should('contain', '2 sprints differ from the team')

    // Nothing has reached the board yet: Available is still what it was created
    // with. Capacity is never a live view (§6.4).
    cy.openProject('ISK Portal')
    cy.openPI('Q2-2026')
    cy.contains('0/0 pts - 0%').should('exist')

    cy.openTeam('Platform')
    pushTab('Projects').click()
    cy.contains('li', 'ISK Portal').should('contain', '2 sprints differ from the team')

    cy.contains('button', /^Update projects$/).click()
    // The review shows the integer it will write, before anything is written.
    pushDialog().should('contain', 'Step 1 of 2')
    pushDialog().contains('15 pts').should('be.visible')
    pushDialog().contains('button', /^Apply to 1 project$/).click()
    pushDialog().should('contain', '2 sprints updated')
    pushDialog().contains('button', /^Close$/).click()

    cy.contains('li', 'ISK Portal').should('contain', 'in sync')

    // And the board now holds it.
    cy.openProject('ISK Portal')
    cy.openPI('Q2-2026')
    cy.contains('0/15 pts - 0%').should('exist')
    cy.contains('Platform').should('exist')
  })

  it('makes an absence lower the number, and says the board is behind again', () => {
    assignWithFactor()
    cy.get('@projectId').then((projectId) => {
      cy.request('POST', `/api/v1/projects/${projectId}/team-capacity/apply`)
    })

    // A whole week off one of one member: 5 PD × 1.5 = 7.5 → 8 pts.
    cy.get('@teamId').then((teamId) => {
      cy.request('GET', `/api/v1/teams/${teamId}/members`).then((members) => {
        cy.request('POST', `/api/v1/teams/${teamId}/absences`, {
          member_ids: [members.body[0].system_id],
          label: 'Holiday',
          kind: 'range',
          start_date: '2026-04-06',
          end_date: '2026-04-10',
        })
      })
    })

    cy.visit('/')
    cy.get('section[aria-labelledby="projects-heading"]')
      .contains('li', 'ISK Portal')
      .should('contain', '1 sprint differs from the team')

    cy.openTeam('Platform')
    pushTab('Projects').click()
    cy.contains('button', /^Update projects$/).click()
    pushDialog().contains('8 pts').should('be.visible')
    pushDialog().contains('button', /^Apply to 1 project$/).click()
    pushDialog().should('contain', '1 sprint updated')
    pushDialog().contains('button', /^Close$/).click()

    cy.openProject('ISK Portal')
    cy.openPI('Q2-2026')
    cy.contains('0/8 pts - 0%').should('exist')
  })

  it('makes a derived Available read-only on the board, dates still editable', () => {
    assignWithFactor()
    cy.get('@projectId').then((projectId) => {
      cy.request('POST', `/api/v1/projects/${projectId}/team-capacity/apply`)
    })

    cy.openProject('ISK Portal')
    cy.openPI('Q2-2026')
    cy.enterEditMode()
    cy.contains('pushed').should('exist')

    // The pencil stays — it still owns the sprint's dates, which no team writes.
    // It is the Available field inside that the API would refuse with 409
    // AVAILABLE_IS_DERIVED, so that is the one thing the form stops offering.
    cy.get('[title="Edit sprint dates"]').first().click()
    pushDialog().find('#sprint-available').should('have.attr', 'readonly')
    pushDialog().should('contain', 'Derived from team Platform')
    pushDialog().find('#sprint-start').should('not.have.attr', 'readonly')
  })

  it('leaves a hand-typed project alone, and keeps its pencil', () => {
    // manual is the default and changes nothing (§6.4).
    cy.get('@teamId').then((teamId) => {
      cy.get('@projectId').then((projectId) => {
        cy.request('POST', `/api/v1/teams/${teamId}/projects`, { project_id: projectId })
      })
    })

    cy.visit('/')
    cy.get('section[aria-labelledby="projects-heading"]')
      .contains('li', 'ISK Portal')
      .should('not.contain', 'sprints differ')

    cy.openTeam('Platform')
    pushTab('Projects').click()
    cy.contains('button', /^Update projects$/).click()
    pushDialog().should('contain', 'No project served by this team derives its Available')
    pushDialog().contains('button', /^Cancel$/).click()

    cy.openProject('ISK Portal')
    cy.openPI('Q2-2026')
    cy.enterEditMode()
    cy.get('[title="Edit Available"]').should('exist')
  })
})
