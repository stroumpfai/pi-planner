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

  it('shows a member who does not count below the total, and leaves the total alone', () => {
    cy.request('GET', '/api/v1/teams').then((teams) => {
      const teamId = teams.body[0].system_id
      cy.request('POST', `/api/v1/teams/${teamId}/members`, {
        name: 'Pia Moser',
        counts_towards_capacity: false,
        pattern: { effective_from: '2026-01-01', hours_per_day: 4 },
      })
      cy.request('GET', '/api/v1/projects/').then((projects) => {
        cy.request('POST', `/api/v1/teams/${teamId}/projects`, {
          project_id: projects.body[0].system_id,
        })
      })
    })
    cy.reload()
    cy.openTeam('Platform')
    capacityTab('Capacity').click()

    // Marta alone: 10 PD. Pia's 5 PD is shown, under its own heading, and not added (§3.2).
    cy.contains('tr', /^Team/).should('contain', '10.0 PD')
    cy.contains('th', 'Not counted towards capacity').should('be.visible')
    cy.contains('tr', 'Pia Moser').should('contain', '5.0 PD')
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

/** Date every sprint of a PI as consecutive Mon–Fri fortnights from *firstDay*. */
function dateSprints(piId: string, firstDay: string) {
  cy.request('GET', `/api/v1/pis/${piId}/sprints`).then((res) => {
    for (const sprint of res.body) {
      const start = new Date(`${firstDay}T00:00:00Z`)
      start.setUTCDate(start.getUTCDate() + sprint.sprint_index * 14)
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 11)
      cy.request('PATCH', `/api/v1/sprints/${sprint.system_id}`, {
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
      })
    }
  })
}

/**
 * Click a month bar the frame is sitting on, the way a mouse would: on the
 * frame, at that month's own x.
 */
function clickThroughFrame(bar: string) {
  cy.get(`button[aria-label^="${bar}"]`).then(($bar) => {
    const month = $bar[0].getBoundingClientRect()
    cy.get('button[aria-label^="Showing "]').then(($frame) => {
      const frame = $frame[0].getBoundingClientRect()
      cy.wrap($frame).click(month.left + month.width / 2 - frame.left, frame.height / 2)
    })
  })
}

/** The anchor assignment, plus a second PI so the table has more than one page. */
function seedTwoDatedPIs() {
  cy.request('GET', '/api/v1/teams').then((teams) => {
    cy.request('GET', '/api/v1/projects/').then((projects) => {
      const projectId = projects.body[0].system_id
      cy.request('POST', `/api/v1/teams/${teams.body[0].system_id}/projects`, {
        project_id: projectId,
      })
      cy.request('GET', `/api/v1/projects/${projectId}/pis`).then((pis) => {
        dateSprints(pis.body[0].system_id, '2026-04-06')
      })
      cy.request('POST', `/api/v1/projects/${projectId}/pis`, {
        name: 'Q3-2026',
        start_date: '2026-06-29',
      }).then((pi) => dateSprints(pi.body.system_id, '2026-06-29'))
    })
  })
}

describe('Team capacity minimap', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    seedTeamAndProject()
    seedTwoDatedPIs()
    cy.openTeam('Platform')
    capacityTab('Capacity').click()
  })

  it('moves the table to the sprint a month names, and the frame with it', () => {
    // Ten sprints, six columns: the first page starts at the first of them, and
    // the frame covers the six months from there.
    cy.contains('Q2-2026.1').should('be.visible')
    cy.get('button[aria-label^="Showing Apr 2026 to Sep 2026"]').should('exist')

    // August is *under* the frame, so the mouse lands on the frame — which is
    // exactly the gesture being tested: a press that never travels is passed
    // through to the month beneath it, or the six months the frame covers would
    // be the six a mouse cannot reach.
    clickThroughFrame('Show Aug 2026')

    // August opens in Q3-2026.3 (27 Jul – 7 Aug); six columns from there would
    // run off the end, so the window backs up to the last full page.
    cy.contains('Q3-2026.3').should('be.visible')
    cy.contains('Q2-2026.1').should('not.exist')
    cy.get('button[aria-label^="Showing Aug 2026 to Jan 2027"]').should('exist')

    // And back, from a bar outside the frame this time.
    cy.get('button[aria-label^="Show Apr 2026"]').click()
    cy.contains('Q2-2026.1').should('be.visible')
    cy.get('button[aria-label^="Showing Apr 2026 to Sep 2026"]').should('exist')

    // July's sprint starts on 29 June, so the frame must still answer July —
    // anchoring it on that sprint's start date is what read as a click landing
    // a month early.
    clickThroughFrame('Show Jul 2026')
    cy.contains('Q3-2026.1').should('be.visible')
    cy.get('button[aria-label^="Showing Jul 2026 to Dec 2026"]').should('exist')

    // The arrows are not a month anyone named, so the frame goes back to
    // following the table: sprints 3–8 start in May.
    cy.get('button[aria-label="Earlier sprints"]').click()
    cy.get('button[aria-label^="Showing Apr 2026 to Sep 2026"]').should('exist')
  })

  it('counts an absence into the month that holds it, and jumps there', () => {
    // A full week off inside Q3-2026.1 (29 Jun – 10 Jul): five days at 8 h is
    // 5 PD, and 3 of those days fall in July.
    cy.request('GET', '/api/v1/teams').then((teams) => {
      const teamId = teams.body[0].system_id
      cy.request('GET', `/api/v1/teams/${teamId}/members`).then((members) => {
        cy.request('POST', `/api/v1/teams/${teamId}/absences`, {
          kind: 'range',
          label: 'Summer leave',
          start_date: '2026-06-29',
          end_date: '2026-07-03',
          member_ids: [members.body[0].system_id],
        })
      })
    })
    cy.reload()
    cy.openTeam('Platform')
    capacityTab('Capacity').click()

    // The sprint is 12 calendar days — 2 in June, 10 in July — so the 5 PD it
    // lost is spread 0.8 / 4.2 rather than charged whole to the month it starts
    // in. The bar is per month; the sprint straddles the end.
    cy.get('button[aria-label="Show Jun 2026 — 0.8 person-days lost"]').should('exist')
    cy.get('button[aria-label="Show Jul 2026 — 4.2 person-days lost"]').should('exist')
    cy.get('button[aria-label="Show Aug 2026 — nothing lost"]').should('exist')

    cy.get('select[aria-label="Jump to month"]').select('2026-07')
    cy.contains('Q3-2026.1').should('be.visible')
  })
})
