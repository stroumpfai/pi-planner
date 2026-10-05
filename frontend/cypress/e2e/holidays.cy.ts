/**
 * Shared holiday calendars, from the Calendars page to the PI board
 * (spec/public-holidays.md).
 *
 * The journey is the point: a holiday entered once in a shared calendar shows
 * up for a team only once the team enables it, removes capacity for everyone
 * except whoever works it, and reaches the board as a chip on the sprint.
 *
 * House rules as in the other team specs: team and calendar writes take **no
 * edit lock**, so there is no `cy.enterEditMode()`, and there is no URL routing.
 * "Public holiday" is both the strip's heading and part of the chip and the
 * legend, so those assertions are scoped.
 */

export {}

const dialog = () => cy.get('[role="dialog"]')
const teamTab = (name: string) => cy.get('nav[aria-label="Team views"]').contains('button', name)
const cell = (member: string, date: string, half: 'am' | 'pm') =>
  cy.get(`[title="${member} · ${date} ${half}"]`)
const strip = () => cy.get('section[aria-label="Public holidays"]')

const HOLIDAY = '2026-09-09'

/** A team of two serving a project whose first sprint is 7–11 September 2026, and a calendar. */
function seed() {
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
            .request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'PI 7', start_date: '2026-09-07' })
            .then((piRes) => cy.request('GET', `/api/v1/pis/${piRes.body.system_id}/sprints`))
            .then((sprintRes) => {
              const first = sprintRes.body.find((s: { sprint_index: number }) => s.sprint_index === 0)
              return cy.request('PATCH', `/api/v1/sprints/${first.system_id}`, {
                start_date: '2026-09-07',
                end_date: '2026-09-11',
              })
            })
            .then(() => cy.request('POST', `/api/v1/teams/${teamId}/projects`, { project_id: projectId }))
        })
    })
    .then(() => cy.request('POST', '/api/v1/holiday-calendars', { name: 'Switzerland' }))
    .then((calRes) =>
      cy.request('POST', `/api/v1/holiday-calendars/${calRes.body.system_id}/entries`, {
        label: 'Company holiday',
        start_date: HOLIDAY,
      }),
    )
}

function showSeptember() {
  teamTab('Absences').click()
  cy.get('select[aria-label="Jump to month"]').select('2026-09')
  cy.get('[aria-label="Months shown"]').should('contain', 'Sep 2026')
}

describe('Holiday calendars', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    seed()
  })

  it('reaches a team only once enabled, spares whoever works it, and shows on the board', () => {
    cy.openTeam('Platform')
    showSeptember()
    strip().should('contain', 'No holiday calendar is enabled')
    cell('Marta Lindqvist', HOLIDAY, 'am').should('not.have.class', 'bg-amber-400')

    // Enabling warns that history moves before it does anything (§3.4).
    cy.contains('label', 'Switzerland').find('input[type="checkbox"]').click()
    dialog().should('contain', 'including closed ones')
    dialog().contains('button', /^Enable$/).click()
    cy.get('[role="dialog"]').should('not.exist')

    strip().should('contain', 'Company holiday')
    cell('Marta Lindqvist', HOLIDAY, 'am').should('have.class', 'bg-amber-400')
    cell('Rui Domingues', HOLIDAY, 'pm').should('have.class', 'bg-amber-400')

    // Marta is on call that day.
    cell('Marta Lindqvist', HOLIDAY, 'am').click()
    dialog().should('contain', 'Company holiday')
    dialog().contains('label', /^Works this day$/).find('input').click()
    dialog().contains('label', /^Works this day$/).find('input').should('be.checked')
    dialog().contains('button', /^Close$/).click()
    cell('Marta Lindqvist', HOLIDAY, 'am').should('not.have.class', 'bg-amber-400')
    strip().find('[title*="1 of 2 members (Marta Lindqvist work)"]').should('exist')

    // Capacity: Rui loses the day to the holiday, Marta keeps it.
    teamTab('Capacity').click({ force: true })
    cy.get('button[aria-label*="Marta Lindqvist, PI 7.1"]').should('contain', '5.0 PD')
    cy.get('button[aria-label*="Rui Domingues, PI 7.1"]').should('contain', '4.0 PD').click()
    cy.contains('− public holidays (2 half-days)').should('be.visible')

    // And the board names it on the sprint.
    cy.contains('button', 'PI Planner').click()
    cy.openProject('ISK Portal')
    cy.openPI('PI 7')
    cy.contains('1 public holiday').should('have.attr', 'title').and('contain', 'Company holiday')
  })

  it('manages a calendar and its holidays on the Calendars page', () => {
    cy.contains('button', /^Holiday calendars$/).click()
    cy.contains('h2', 'Holiday calendars').parents('section').first().should('contain', 'Switzerland')

    cy.contains('button', /^\+ New$/).click()
    cy.get('#new-calendar-name').type('Company shutdowns')
    cy.contains('button', /^Create$/).click()
    cy.get('section[aria-label="Company shutdowns"]').should('exist')

    // The year view opens on this year; move to 2026 whatever year the suite runs in.
    cy.get('section[aria-label="Company shutdowns"]').then(($section) => {
      const shown = Number($section.find('[aria-live="polite"]').text())
      const steps = shown - 2026
      for (let i = 0; i < Math.abs(steps); i += 1) {
        cy.get(`button[aria-label="${steps > 0 ? 'Previous' : 'Next'} year"]`).click()
      }
    })
    cy.contains('button', /^\+ Add holiday$/).click()
    dialog().should('contain', 'No team uses this calendar yet')
    dialog().find('#holiday-label').type('Between the years')
    dialog().find('#holiday-start').type('28.12.2026')
    // DateInput commits on blur. Cypress fires the blur and the Save click in one
    // task, before React has applied the blur's update, so blur explicitly — a
    // person's click spans separate tasks and never meets this.
    dialog().find('#holiday-end').type('31.12.2026').blur()
    dialog().contains('button', /^Save$/).click()
    cy.get('[role="dialog"]').should('not.exist')
    cy.get('section[aria-label="Company shutdowns"]')
      .should('contain', 'Between the years')
      .and('contain', '2026-12-28 – 2026-12-31')
  })
})
