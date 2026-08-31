/**
 * Assignment and the first real number (teams.md §6.1–§6.4, §7.6).
 *
 * The journey: a team with a member serves a project, and its sprint capacity
 * becomes readable — in person-days, in hours, and traced step by step in an
 * expanded cell. Nothing here writes a sprint; the push is step 7's.
 *
 * Team writes take no edit lock (§4.1), so there is no `cy.enterEditMode()`
 * below — the controls are gated on the role, and `testuser` is an admin.
 */

const capacityDialog = () => cy.get('[role="dialog"]')
const capacityTab = (name: string) =>
  cy.get('nav[aria-label="Team views"]').contains('button', name)

/** A team, a member, and a project with one dated sprint. */
function seedTeamAndProject(options: { hoursPerDay?: number; focus?: number } = {}) {
  cy.request('POST', '/api/v1/teams', { name: 'Platform' }).then((teamRes) => {
    cy.request('POST', `/api/v1/teams/${teamRes.body.system_id}/members`, {
      name: 'Marta Lindqvist',
      pattern: {
        effective_from: '2026-01-01',
        hours_per_day: options.hoursPerDay ?? 8,
        focus: options.focus ?? 1,
      },
    })
  })
  cy.request('POST', '/api/v1/projects/', { name: 'ISK Portal' }).then((projectRes) => {
    cy.request('POST', `/api/v1/projects/${projectRes.body.system_id}/pis`, {
      name: 'Q2-2026',
      start_date: '2026-04-06',
    }).then((piRes) => {
      cy.request('GET', `/api/v1/pis/${piRes.body.system_id}/sprints`).then((sprintRes) => {
        const first = sprintRes.body.find((s: { sprint_index: number }) => s.sprint_index === 0)
        cy.request('PATCH', `/api/v1/sprints/${first.system_id}`, {
          start_date: '2026-04-06',
          end_date: '2026-04-17',
        })
      })
    })
  })
}

describe('Team capacity', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    seedTeamAndProject()
    cy.openTeam('Platform')
  })

  it('has no sprint calendar until a project is assigned, and says so', () => {
    capacityTab('Capacity').click()
    cy.contains('no sprint calendar to count in').should('be.visible')

    // The empty state leads to the tab that fixes it rather than describing it.
    cy.contains('button', 'Assign a project').click()
    capacityTab('Projects').should('have.attr', 'aria-current', 'page')
  })

  it('assigns a project and reads a real figure from it', () => {
    capacityTab('Projects').click()
    cy.contains('button', /^\+ Assign project$/).click()
    capacityDialog().find('select[name="project_id"]').select('ISK Portal')
    capacityDialog().contains('button', /^Assign project$/).click()

    // The first assignment is the anchor: its dates are the columns below.
    cy.contains('li', 'ISK Portal').should('contain', 'anchor')

    capacityTab('Capacity').click()
    cy.contains('Q2-2026.1').should('be.visible')
    cy.contains('6–17 Apr').should('be.visible')
    // Ten working days at 8 h, focus 1.0 — 80 h, 10 PD.
    cy.contains('10.0 PD').should('be.visible')
    cy.contains('80.0 h').should('be.visible')
  })

  it('expands a cell into the chain that produced the number', () => {
    cy.request('GET', '/api/v1/teams').then((teams) => {
      cy.request('GET', '/api/v1/projects/').then((projects) => {
        cy.request('POST', `/api/v1/teams/${teams.body[0].system_id}/projects`, {
          project_id: projects.body[0].system_id,
          share_pct: 70,
          available_source: 'factor',
          units_per_pd: 1.5,
        })
      })
    })
    cy.reload()
    cy.openTeam('Platform')
    capacityTab('Capacity').click()

    cy.get('button[aria-label*="Marta Lindqvist, Q2-2026.1"]').click()
    cy.contains('Contracted 20 half-days').should('be.visible')
    cy.contains('÷ 8.0 h per day').should('be.visible')

    // The project row converts it: 10 PD × 70% = 7 PD × 1.5 = 10.5 → 11 pts,
    // the integer a push would write (§6.4).
    cy.contains('7.0 PD').should('be.visible')
    cy.contains('→ 11 pts').should('be.visible')
  })

  it('warns when the shares add up past the team', () => {
    cy.request('POST', '/api/v1/projects/', { name: 'Data Exchange' })
    cy.request('GET', '/api/v1/teams').then((teams) => {
      const teamId = teams.body[0].system_id
      cy.request('GET', '/api/v1/projects/').then((projects) => {
        for (const project of projects.body) {
          cy.request('POST', `/api/v1/teams/${teamId}/projects`, {
            project_id: project.system_id,
            share_pct: 70,
          })
        }
      })
    })
    cy.reload()
    cy.openTeam('Platform')
    capacityTab('Projects').click()

    // Warn, never block: both assignments are still there (§6.3).
    cy.contains('Shares total 140% — this team is over-allocated').should('be.visible')
    cy.get('li').filter(':contains("ISK Portal"), :contains("Data Exchange")').should('have.length', 2)
  })

  it('unassigns a project and leaves the sprint budget where it was', () => {
    cy.request('GET', '/api/v1/teams').then((teams) => {
      cy.request('GET', '/api/v1/projects/').then((projects) => {
        cy.request('POST', `/api/v1/teams/${teams.body[0].system_id}/projects`, {
          project_id: projects.body[0].system_id,
        })
      })
    })
    cy.reload()
    cy.openTeam('Platform')
    capacityTab('Projects').click()

    cy.contains('li', 'ISK Portal').contains('button', /^Unassign$/).click()
    capacityDialog().contains('keeps the Available it holds now').should('be.visible')
    capacityDialog().contains('button', /^Unassign$/).click()

    cy.contains('This team serves no project yet').should('be.visible')
  })
})
