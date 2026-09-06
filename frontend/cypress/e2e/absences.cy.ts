/**
 * Recording who is away, and watching the number drop (teams.md §3.4, §7.4).
 *
 * That last part is the point of the step: an absence is only worth entering if
 * capacity falls by it, so the journey here ends in the Capacity view rather
 * than in the grid.
 *
 * Two house rules apply, as in the other team specs. Team writes take **no edit
 * lock** (§4.1), so there is no `cy.enterEditMode()` below. And there is no URL
 * routing, so everything is reached by clicking.
 */

const absenceDialog = () => cy.get('[role="dialog"]')
const teamTab = (name: string) => cy.get('nav[aria-label="Team views"]').contains('button', name)

/** A half-day cell, addressed the way its tooltip names it. */
const cell = (member: string, date: string, half: 'am' | 'pm') =>
  cy.get(`[title="${member} · ${date} ${half}"]`)

interface Seeded {
  teamId: string
}

/**
 * A team, two members, and a project whose first sprint is one working week.
 *
 * The sprint is what makes capacity computable at all — an undated one reads
 * "—", never 0 (§5.3) — and its dates are the week the absences below fall in.
 */
function seed(): Cypress.Chainable<Seeded> {
  return cy
    .request('POST', '/api/v1/teams', { name: 'Platform' })
    .then((teamRes) => {
      const teamId = teamRes.body.system_id
      const pattern = { effective_from: '2026-01-01' }
      return cy
        .request('POST', `/api/v1/teams/${teamId}/members`, { name: 'Marta Lindqvist', pattern })
        .then(() =>
          cy.request('POST', `/api/v1/teams/${teamId}/members`, { name: 'Rui Domingues', pattern }),
        )
        .then(() => cy.request('POST', '/api/v1/projects/', { name: 'ISK Portal' }))
        .then((projectRes) => {
          const projectId = projectRes.body.system_id
          return cy
            .request('POST', `/api/v1/projects/${projectId}/pis`, {
              name: 'PI 7',
              start_date: '2026-09-07',
            })
            .then((piRes) => cy.request('GET', `/api/v1/pis/${piRes.body.system_id}/sprints`))
            .then((sprintRes) => {
              const first = sprintRes.body.find(
                (s: { sprint_index: number }) => s.sprint_index === 0,
              )
              return cy.request('PATCH', `/api/v1/sprints/${first.system_id}`, {
                start_date: '2026-09-07',
                end_date: '2026-09-11',
              })
            })
            .then(() =>
              cy.request('POST', `/api/v1/teams/${teamId}/projects`, { project_id: projectId }),
            )
        })
        .then(() => ({ teamId }))
    })
}

/** Move the grid onto September 2026, whatever month the suite runs in. */
function showSeptember() {
  teamTab('Absences').click()
  cy.get('select[aria-label="Jump to month"]').select('2026-09')
  cy.get('[aria-label="Months shown"]').should('contain', 'Sep 2026')
}

describe('Absences', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    seed()
    cy.openTeam('Platform')
  })

  it('enters one day for the whole team, and the capacity figures fall', () => {
    // Before: a five-day sprint, both members on a full week — 5 PD each.
    teamTab('Capacity').click()
    cy.get('button[aria-label*="Marta Lindqvist, PI 7.1"]').should('contain', '5.0 PD')

    showSeptember()
    cy.contains('button', /^\+ Add absence$/).click()

    // "all N" is one click, and is how a public holiday is entered (§3.4).
    absenceDialog().contains('button', /^all 2$/).click()
    absenceDialog().find('#absence-label').type('Company day')
    absenceDialog().find('#absence-from').type('09.09.2026')
    absenceDialog().find('#absence-to').type('09.09.2026')
    absenceDialog().contains('button', /^Save$/).click()
    cy.get('[role="dialog"]').should('not.exist')

    // The cell fills for both people, from one form.
    cell('Marta Lindqvist', '2026-09-09', 'am').should('exist')
    cell('Rui Domingues', '2026-09-09', 'am').should('exist')

    teamTab('Capacity').click({ force: true })
    cy.get('button[aria-label*="Marta Lindqvist, PI 7.1"]').should('contain', '4.0 PD')
    cy.get('button[aria-label*="Rui Domingues, PI 7.1"]').should('contain', '4.0 PD')
  })

  it('selects an entry from the grid and deletes the whole series', () => {
    showSeptember()
    cy.contains('button', /^\+ Add absence$/).click()
    absenceDialog().contains('label', 'Marta Lindqvist').click()
    absenceDialog().find('#absence-label').type('Summer holiday')
    absenceDialog().find('#absence-from').type('10.09.2026')
    absenceDialog().find('#absence-to').type('11.09.2026')
    absenceDialog().contains('button', /^Save$/).click()
    cy.get('[role="dialog"]').should('not.exist')

    cell('Marta Lindqvist', '2026-09-10', 'am').click()
    cy.contains('Summer holiday').should('be.visible')

    cy.get('button[aria-label="Delete absence for Marta Lindqvist"]').click()
    // No "this occurrence / the whole series" — there is only the series (§3.4).
    absenceDialog().should('contain', 'cannot be undone')
    absenceDialog().should('not.contain', 'This occurrence')
    absenceDialog().contains('button', /^Delete$/).click()

    cy.get('button[aria-label="Delete absence for Marta Lindqvist"]').should('not.exist')
    // force: Radix leaves the body scroll-locked for a beat after a dialog closes.
    teamTab('Capacity').click({ force: true })
    cy.get('button[aria-label*="Marta Lindqvist, PI 7.1"]').should('contain', '5.0 PD')
  })

  it('keeps paired controls level however their labels wrap', () => {
    showSeptember()
    cy.contains('button', /^\+ Add absence$/).click()
    absenceDialog().contains('button', /^Interval$/).click()

    // "First occurrence · the anchor — it picks the weeks" wraps to two lines
    // beside a one-line "Until". The two date fields still share a baseline —
    // an assertion only a real browser can make, since jsdom has no layout.
    absenceDialog()
      .find('#absence-anchor')
      .then(($anchor) => {
        const top = $anchor[0].getBoundingClientRect().top
        absenceDialog()
          .find('#absence-until')
          .then(($until) => {
            expect($until[0].getBoundingClientRect().top).to.be.closeTo(top, 1)
          })
      })
  })

  it('books a fortnightly Friday and previews which Fridays it means', () => {
    showSeptember()
    cy.contains('button', /^\+ Add absence$/).click()

    absenceDialog().contains('label', 'Rui Domingues').click()
    absenceDialog().contains('button', /^Interval$/).click()
    absenceDialog().find('#absence-anchor').type('04.09.2026')
    absenceDialog().find('#absence-weekday').select('4')
    absenceDialog().find('#absence-halves').select('am')

    // The chips are the check against an off-by-one week (§3.4).
    absenceDialog().should('contain', '2026-09-04').and('contain', '2026-09-18')
    absenceDialog().contains('button', /^Save$/).click()
    cy.get('[role="dialog"]').should('not.exist')

    // One occurrence lands inside the 7–11 September sprint: Friday 11th is not
    // one of them, so only the anchor fortnight shows in the first week.
    cell('Rui Domingues', '2026-09-18', 'am').click()
    cy.contains('every 2nd Friday am').should('be.visible')
  })

  it('shows the grid to a reader with no way to change it', () => {
    // A name of this spec's own: `cy.resetDb()` clears planning data but not
    // accounts, so a username shared with another spec fails on whichever runs
    // second.
    cy.request('POST', '/api/v1/users/', {
      username: 'absence-reader',
      display_name: 'Absence Reader',
      password: 'correct-horse-battery',
      role: 'reader',
    })
    cy.request('POST', '/api/v1/auth/logout')
    cy.login('absence-reader', 'correct-horse-battery')
    cy.openTeam('Platform')
    teamTab('Absences').click()

    cy.get('[role="grid"][aria-label="Absences by member and half-day"]').should('exist')
    cy.contains('button', /^\+ Add absence$/).should('not.exist')
    cy.contains('Read-only').should('be.visible')
  })
})
