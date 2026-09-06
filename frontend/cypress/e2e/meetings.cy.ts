/**
 * Booked time, and the number dropping for it (teams.md §3.5, §5.4, §7.5).
 *
 * The journey: a team serving a project gains a meeting, everybody is put in it
 * from the column head, and the capacity figure falls by exactly the hours that
 * reach it. Then the case §11 turns on — an 8 h workshop for a 6 h/day member
 * costs their whole day and stops there.
 *
 * Team writes take no edit lock (§4.1), so there is no `cy.enterEditMode()`
 * below — the controls are gated on the role, and `testuser` is an admin.
 */

const meetingDialog = () => cy.get('[role="dialog"]')
const meetingsTab = (name: string) =>
  cy.get('nav[aria-label="Team views"]').contains('button', name)

/** A team of two, serving a project whose first sprint is a fortnight in April. */
function seedMeetingTeam(options: { hoursPerDay?: number } = {}) {
  cy.request('POST', '/api/v1/teams', { name: 'Platform' }).then((teamRes) => {
    const teamId = teamRes.body.system_id
    for (const name of ['Marta Lindqvist', 'Tomas Bergerat']) {
      cy.request('POST', `/api/v1/teams/${teamId}/members`, {
        name,
        pattern: {
          effective_from: '2026-01-01',
          hours_per_day: options.hoursPerDay ?? 8,
          focus: 1,
        },
      })
    }
    cy.request('POST', '/api/v1/projects/', { name: 'ISK Portal' }).then((projectRes) => {
      const projectId = projectRes.body.system_id
      cy.request('POST', `/api/v1/projects/${projectId}/pis`, {
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
      cy.request('POST', `/api/v1/teams/${teamId}/projects`, { project_id: projectId })
    })
  })
}

/** Add a meeting through the API, so a test about the matrix starts at one. */
function seedMeeting(body: Record<string, unknown>) {
  cy.request('GET', '/api/v1/teams').then((teams) => {
    cy.request('POST', `/api/v1/teams/${teams.body[0].system_id}/meetings`, {
      kind: 'range',
      half: 'am',
      ...body,
    })
  })
}

/** The top edge of an element, as the browser actually laid it out. */
function topOf(selector: string): Cypress.Chainable<number> {
  return cy.get(selector).then(($el) => $el[0].getBoundingClientRect().top)
}

describe('Meetings', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    seedMeetingTeam()
    cy.openTeam('Platform')
    meetingsTab('Meetings').click()
  })

  it('starts empty, and offers the first column', () => {
    cy.contains('a meeting is a column here').should('be.visible')
    cy.contains('button', /^Add the first meeting$/).should('be.visible')
  })

  it('adds a meeting as a column, with its schedule in words', () => {
    cy.contains('button', /^\+ Add meeting$/).click()

    meetingDialog().find('input[name="title"]').type('Sprint planning')
    meetingDialog().contains('button', /^Weekly$/).click()
    meetingDialog().find('#meeting-weekday').select('Mon')
    meetingDialog().find('#meeting-anchor').type('06.04.2026')
    meetingDialog().find('#meeting-duration').clear().type('120')
    meetingDialog().contains('button', /^Save$/).click()

    // The head carries what the grid has no axis to show (§7.5).
    cy.contains('th', 'Sprint planning').should('contain', '2 h')
    cy.contains('th', 'Sprint planning').should('contain', 'every Monday am')
    cy.contains('th', 'Sprint planning').should('contain', 'Weekly')
  })

  it('puts the whole team in a meeting from the column head, and the number drops', () => {
    seedMeeting({
      title: 'Sprint planning',
      kind: 'weekly',
      start_date: '2026-04-06',
      weekday: 0,
      duration_minutes: 120,
    })
    cy.reload()
    cy.openTeam('Platform')

    // Before: nobody attends, so the meeting costs nothing.
    meetingsTab('Capacity').click()
    cy.contains('10.0 PD').should('be.visible')

    meetingsTab('Meetings').click()
    cy.get('input[aria-label="Everyone attends Sprint planning"]').click()
    cy.contains('td', '2 of 2').should('be.visible')

    // Two Mondays in the sprint, 2 h each: 4 h off each member (§5.4).
    cy.contains('td', '4.0 h').should('be.visible')

    meetingsTab('Capacity').click()
    cy.contains('9.5 PD').should('be.visible')
    cy.contains('76.0 h').should('be.visible')
  })

  it('totals for the sprint the load column names, and reads “—” for an undated one', () => {
    seedMeeting({
      title: 'Workshop',
      start_date: '2026-04-08',
      duration_minutes: 240,
    })
    cy.reload()
    cy.openTeam('Platform')
    meetingsTab('Meetings').click()

    cy.get('input[aria-label="Marta Lindqvist attends Workshop"]').click()
    cy.contains('td', '4.0 h').should('be.visible')

    // Sprint 2 has no dates, so every figure is unknown rather than zero (§7.0.1).
    cy.get('select[aria-label="Sprint for meeting load"]').select('Q2-2026.2')
    cy.contains('no dates set').should('be.visible')
    cy.get('input[aria-label="Marta Lindqvist attends Workshop"]').should('be.checked')
    cy.contains('td', '4.0 h').should('not.exist')
  })

  it('costs a 6 h/day member their whole day for an 8 h workshop, and no more', () => {
    cy.resetDb()
    cy.login()
    seedMeetingTeam({ hoursPerDay: 6 })
    seedMeeting({
      title: 'Architecture workshop',
      start_date: '2026-04-08',
      duration_minutes: 480,
    })
    cy.openTeam('Platform')
    meetingsTab('Meetings').click()

    cy.get('input[aria-label="Marta Lindqvist attends Architecture workshop"]').click()

    // Their day is 6 h, so the workshop costs 6 h — clamped, never 8 (§11).
    cy.contains('td', '6.0 h').should('be.visible')
    // The footer's person-hours are the meeting's own length, unclamped.
    cy.contains('td', '8.0 ph').should('be.visible')

    meetingsTab('Capacity').click()
    // 10 days × 6 h = 60 h, less the 6 h day: 54 h ÷ 8 = 6.75 PD.
    cy.contains('54.0 h').should('be.visible')
  })

  it('reorders the columns, because the order is the team’s and not chronological', () => {
    seedMeeting({ title: 'Stand-up', start_date: '2026-04-06', duration_minutes: 15 })
    seedMeeting({ title: 'Retro', start_date: '2026-04-17', duration_minutes: 60 })
    cy.reload()
    cy.openTeam('Platform')
    meetingsTab('Meetings').click()

    cy.get('th').eq(1).should('contain', 'Stand-up')
    cy.get('button[aria-label="Actions for Retro"]').click()
    cy.contains('[role="menuitem"]', 'Move left').click()

    cy.get('th').eq(1).should('contain', 'Retro')
    // And it stays put: order is stored, not a session preference.
    cy.reload()
    cy.openTeam('Platform')
    meetingsTab('Meetings').click()
    cy.get('th').eq(1).should('contain', 'Retro')
  })

  it('sizes the sprint select to its label, not to the column', () => {
    seedMeeting({ title: 'Stand-up', start_date: '2026-04-06', duration_minutes: 15 })
    cy.reload()
    cy.openTeam('Platform')
    meetingsTab('Meetings').click()

    // A control the width of "Q2-2026.1" stretched across the whole header reads
    // as an empty text field. Layout again, so only a real browser can see it.
    cy.get('select[aria-label="Sprint for meeting load"]').then(($select) => {
      const select = $select[0].getBoundingClientRect().width
      // `thead` scoped on purpose: every member row opens with a `th` too, and
      // an unscoped `.last()` measures a name cell instead of this column.
      cy.get('thead th').last().then(($head) => {
        const head = $head[0].getBoundingClientRect().width
        expect(select).to.be.lessThan(head * 0.75)
        // And the column stays a caption on a "4.0 h" figure rather than a form:
        // the picker sets this width, so it is the picker that has to stay small.
        expect(head).to.be.lessThan(180)
      })
    })
  })

  it('sizes the card to its columns and packs them against the left', () => {
    seedMeeting({ title: 'Stand-up', start_date: '2026-04-06', duration_minutes: 15 })
    cy.reload()
    cy.openTeam('Platform')
    meetingsTab('Meetings').click()

    // Two members and one meeting is a small table, and it should look like one:
    // stretched to the window, the load column ends up an inch from the page edge
    // with a field of empty canvas between it and the names. Layout again — only
    // a real browser can tell a shrink-to-fit table from a full-width one.
    cy.get('table').then(($table) => {
      const table = $table[0].getBoundingClientRect()
      const card = $table[0].parentElement!.getBoundingClientRect()

      // The card ends where the last column does, and both start at the left.
      expect(Math.abs(card.right - table.right)).to.be.lessThan(2)
      expect(Math.abs(card.left - table.left)).to.be.lessThan(2)
      // And that is nowhere near the width of the page.
      expect(card.width).to.be.lessThan(Cypress.config('viewportWidth') * 0.7)
    })
  })

  it('keeps paired controls level however their labels wrap', () => {
    cy.contains('button', /^\+ Add meeting$/).click()
    meetingDialog().contains('button', /^Interval$/).click()

    // "First occurrence · the anchor — it picks the weeks" wraps to two lines
    // beside a one-line "Until", and "Starts in" beside "Duration". The controls
    // still share a baseline: only a real browser can see this, so it is asserted
    // here rather than in a jsdom test that has no layout at all.
    topOf('#meeting-anchor').then((anchor) => {
      topOf('#meeting-until').should('be.closeTo', anchor, 1)
    })
    topOf('#meeting-half').then((half) => {
      topOf('#meeting-duration').should('be.closeTo', half, 1)
    })
  })

  it('deletes the whole series, without offering a per-occurrence choice', () => {
    seedMeeting({
      title: 'Stand-up',
      kind: 'weekly',
      start_date: '2026-04-06',
      weekday: 1,
      duration_minutes: 15,
    })
    cy.reload()
    cy.openTeam('Platform')
    meetingsTab('Meetings').click()

    cy.get('button[aria-label="Actions for Stand-up"]').click()
    cy.contains('[role="menuitem"]', 'Delete').click()

    meetingDialog().should('contain', 'every occurrence')
    meetingDialog().should('not.contain', 'This occurrence')
    meetingDialog().contains('button', /^Delete$/).click()

    cy.contains('a meeting is a column here').should('be.visible')
  })
})
