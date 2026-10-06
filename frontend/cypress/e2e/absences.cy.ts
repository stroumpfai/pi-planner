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

    // "all N" is one click — for something the whole team is off for. Public
    // holidays live in shared calendars instead (holidays.cy.ts).
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

  it('imports a calendar file, then updates it from a newer export', () => {
    showSeptember()
    cy.contains('button', /^Import \.ics$/).click()
    absenceDialog().find('input[aria-label="Calendar file"]').selectFile('cypress/fixtures/absences-marta.ics')
    // One member's file, and the first member is the one picked.
    absenceDialog().find('select[aria-label="Member"] option:selected').should('have.text', 'Marta Lindqvist')
    absenceDialog().contains('button', /^Preview$/).click()

    // A timed meeting is offered unticked; a moved occurrence cannot be stored
    // as an absence, and says so (§3.4 — no per-occurrence exceptions).
    absenceDialog().find('input[aria-label^="Import Sprint review"]').should('not.be.checked')
    absenceDialog().find('input[aria-label^="Import Vacation"]').should('be.checked')
    absenceDialog().should('contain', 'Wednesday afternoon moved').and('contain', 'changed occurrence')
    absenceDialog().contains('button', /^Import$/).click()
    cy.get('[role="dialog"]').should('not.exist')

    // The week is a range, the Wednesdays stay a recurring rule.
    cell('Marta Lindqvist', '2026-09-14', 'am').should('have.class', 'bg-blue-500')
    cell('Marta Lindqvist', '2026-09-09', 'pm').should('have.class', 'bg-blue-400')
    cell('Marta Lindqvist', '2026-09-09', 'am').should('not.have.class', 'bg-blue-400')

    // The Wednesday afternoon falls in the 7–11 September sprint.
    teamTab('Capacity').click({ force: true })
    cy.get('button[aria-label*="Marta Lindqvist, PI 7.1"]').should('contain', '4.5 PD')

    // A newer export: the vacation moved a week, the Wednesdays are gone.
    showSeptember()
    cy.contains('button', /^Import \.ics$/).click()
    absenceDialog().find('input[aria-label="Calendar file"]').selectFile('cypress/fixtures/absences-marta-v2.ics')
    absenceDialog().contains('button', /^Preview$/).click()
    absenceDialog().find('[aria-label="Import preview"]').should('contain', 'Update')
    absenceDialog().find('input[aria-label^="Remove Wednesday afternoons"]').should('be.checked')
    absenceDialog().contains('button', /^Import$/).click()
    cy.get('[role="dialog"]').should('not.exist')

    cell('Marta Lindqvist', '2026-09-14', 'am').should('not.have.class', 'bg-blue-500')
    cell('Marta Lindqvist', '2026-09-21', 'am').should('have.class', 'bg-blue-500')
    cell('Marta Lindqvist', '2026-09-09', 'pm').should('not.have.class', 'bg-blue-400')
    teamTab('Capacity').click({ force: true })
    cy.get('button[aria-label*="Marta Lindqvist, PI 7.1"]').should('contain', '5.0 PD')
  })

  it('narrows a long team file to the leave that matters before importing it', () => {
    showSeptember()
    cy.contains('button', /^Import \.ics$/).click()
    absenceDialog().find('input[aria-label="Calendar file"]').selectFile('cypress/fixtures/absences-team.ics')
    absenceDialog().contains('label', 'A shared team calendar').click()
    absenceDialog().contains('button', /^Preview$/).click()

    const preview = () => absenceDialog().find('[aria-label="Import preview"]')
    // Someone else's event is hidden until asked for; the yearly birthday and the
    // meeting are listed, but unticked.
    preview().should('not.contain', 'Someone else away')
    preview().find('input[aria-label^="Import Birthday Rui Domingues"]').first().should('not.be.checked')
    preview().find('input[aria-label^="Import PI planning"]').should('not.be.checked')

    // One word hides every birthday, the one-off cake included, and unticks it.
    absenceDialog().find('input[aria-label="Hide titles containing"]').type('birthday')
    preview().should('not.contain', 'Birthday cake')

    // The unmatched event is somebody's after all: show it, tick it, give it to Rui.
    preview().contains('button', /^Unmatched \(1\)$/).click()
    preview().find('input[aria-label="Import Someone else away"]').check()
    absenceDialog().contains('button', /^Import$/).should('be.disabled')
    preview().find('select[aria-label="Member for Someone else away"]').select('Rui Domingues')
    absenceDialog().should('contain', '3 to write')
    absenceDialog().contains('button', /^Import$/).click()
    cy.get('[role="dialog"]').should('not.exist')

    cell('Marta Lindqvist', '2026-09-14', 'am').should('have.class', 'bg-blue-500')
    cell('Rui Domingues', '2026-09-16', 'am').should('have.class', 'bg-blue-500')
    cell('Rui Domingues', '2026-09-21', 'am').should('have.class', 'bg-blue-500')
    cell('Marta Lindqvist', '2026-09-17', 'am').should('not.have.class', 'bg-blue-500')
    cell('Rui Domingues', '2026-09-18', 'am').should('not.have.class', 'bg-blue-500')
  })

  it('keeps the file settings clear of the import footer', () => {
    // A layout assertion only a real browser can make: the footer must sit below
    // the last setting, never over it, before and after a preview.
    showSeptember()
    cy.contains('button', /^Import \.ics$/).click()
    const clearOfFooter = () =>
      absenceDialog().contains('label', 'A shared team calendar').then(($label) => {
        absenceDialog().contains('button', /^Cancel$/).parent().then(($footer) => {
          expect($label[0].getBoundingClientRect().bottom).to.be.at.most($footer[0].getBoundingClientRect().top)
        })
      })
    clearOfFooter()
    absenceDialog().find('input[aria-label="Calendar file"]').selectFile('cypress/fixtures/absences-marta.ics')
    absenceDialog().contains('button', /^Preview$/).click()
    absenceDialog().find('[aria-label="Import preview"]').should('exist')
    clearOfFooter()
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
    cy.contains('button', /^Import \.ics$/).should('not.exist')
    cy.contains('Read-only').should('be.visible')
  })
})
