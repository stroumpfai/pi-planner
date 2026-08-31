/**
 * Staffing a team, and dating a contract change (teams.md §3.2, §3.3, §7.2, §7.3).
 *
 * The journey these specs walk is the one the feature exists for: add a person,
 * change their contract from a date, and see that figures before that date do
 * not move. Everything else here supports that.
 *
 * Two house rules apply throughout. Team writes take **no edit lock** (§4.1), so
 * there is no `cy.enterEditMode()` anywhere below — `testuser` is an admin and
 * the controls are gated on their role alone. And the app has no URL routing, so
 * the team is opened by clicking, through `cy.openTeam`.
 */

const memberDialog = () => cy.get('[role="dialog"]')
const memberTab = (name: string) => cy.contains('[role="tab"]', name)
const memberRow = (name: string) => cy.contains('li', name)

/** A half-day toggle, addressed the way a screen reader would: "<who> <day> <half>". */
const halfDay = (member: string, label: string) =>
  cy.get(`[role="switch"][aria-label="${member} ${label}"]`)

function openPlatform() {
  cy.request('POST', '/api/v1/teams', { name: 'Platform' })
  cy.openTeam('Platform')
}

/** Seed a member through the API — for the specs whose subject is not the form. */
function seedMember(name: string, pattern: Record<string, unknown> = {}) {
  cy.request('GET', '/api/v1/teams').then((res) => {
    const team = res.body.find((t: { name: string }) => t.name === 'Platform')
    cy.request('POST', `/api/v1/teams/${team.system_id}/members`, {
      name,
      pattern: { effective_from: '2026-01-01', ...pattern },
    })
  })
}

describe('Team members', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
  })

  it('adds a member with their first working pattern, in one dialog', () => {
    openPlatform()

    cy.contains('button', /^\+ Add member$/).click()
    memberDialog().find('input[name="name"]').type('Marta Lindqvist')
    memberDialog().find('#role').type('PO')
    memberDialog().find('#organisation').type('BIT')
    memberDialog().contains('button', /^Add member$/).click()

    // The row carries the pattern the same dialog created: a member without one
    // would compute as zero capacity and read as a bug (§3.3).
    memberRow('Marta Lindqvist').should('contain', 'PO · BIT')
    memberRow('Marta Lindqvist').should('contain', '8.0 h')
    memberRow('Marta Lindqvist').should('contain', 'focus 1.00')
    cy.contains('1 member').should('be.visible')
  })

  it('sends the hours chip to Working days instead of editing in place', () => {
    openPlatform()
    seedMember('Rui Domingues', { hours_per_day: 6 })
    cy.reload()
    cy.openTeam('Platform')

    memberRow('Rui Domingues').contains('6.0 h').click()

    // Changing hours means dating a new version, so the chip navigates (§7.2).
    memberTab('Working days').should('have.attr', 'aria-selected', 'true')
    halfDay('Rui Domingues', 'Mon am').should('exist')
  })

  it('changes a contract from a date, and leaves the days before it alone', () => {
    // The worked case from the spec: 100% until 31.08., 80% from 01.09. Two
    // versions, nothing edited, and nothing before September moves (§3.3).
    openPlatform()
    seedMember('Katrin Hofstetter')
    cy.reload()
    cy.openTeam('Platform')
    memberTab('Working days').click()

    cy.contains('button', 'Change from…').click()
    memberDialog().find('#change-from').clear().type('01.09.2026').blur()
    memberDialog().find('[aria-label="Katrin Hofstetter Fri am"]').click()
    memberDialog().find('[aria-label="Katrin Hofstetter Fri pm"]').click()
    memberDialog().contains('button', /^Save change$/).click()

    // The view moves to the date just written, where Friday is now off…
    cy.get('#as-of').should('have.value', '01.09.2026')
    halfDay('Katrin Hofstetter', 'Fri am').should('have.attr', 'aria-checked', 'false')

    // …and August still reads the contract it was planned with.
    cy.get('#as-of').clear().type('31.08.2026').blur()
    halfDay('Katrin Hofstetter', 'Fri am').should('have.attr', 'aria-checked', 'true')
    cy.contains('version from 01.01.26').should('be.visible')
  })

  it('edits the version in force, warning that closed PIs will not move', () => {
    openPlatform()
    seedMember('Tomas Bergerat')
    cy.reload()
    cy.openTeam('Platform')
    memberTab('Working days').click()

    // The seeded version took effect on 1 Jan 2026, which is in the past.
    cy.contains('sprints in closed PIs are not recomputed').should('be.visible')

    halfDay('Tomas Bergerat', 'Sat am').click()
    halfDay('Tomas Bergerat', 'Sat am').should('have.attr', 'aria-checked', 'true')

    // It is one version, not two: the timeline still says so.
    cy.contains('one version').should('be.visible')
  })

  it('reorders members, and keeps the order after a reload', () => {
    openPlatform()
    seedMember('Marta Lindqvist')
    seedMember('Tomas Bergerat')
    cy.reload()
    cy.openTeam('Platform')

    cy.get('li').filter(':contains("Lindqvist"), :contains("Bergerat")').first().should('contain', 'Marta')
    cy.get('[aria-label="Move Tomas Bergerat up"]').click()

    cy.reload()
    cy.openTeam('Platform')
    cy.get('li').filter(':contains("Lindqvist"), :contains("Bergerat")').first().should('contain', 'Tomas')
  })

  it('says what removing a member takes with them before it happens', () => {
    openPlatform()
    seedMember('Jonas Wehrli')
    cy.reload()
    cy.openTeam('Platform')

    memberRow('Jonas Wehrli').contains('button', /^Remove$/).click()
    memberDialog().should('contain', '1 working-pattern version')
    memberDialog().should('contain', '"until" date instead')
    memberDialog().contains('button', /^Remove$/).click()

    cy.contains('Jonas Wehrli').should('not.exist')
    cy.contains('Nobody on this team yet').should('be.visible')
  })

  it('refuses a name the team already holds, in the form', () => {
    openPlatform()
    seedMember('Marta Lindqvist')
    cy.reload()
    cy.openTeam('Platform')

    cy.contains('button', /^\+ Add member$/).click()
    memberDialog().find('input[name="name"]').type('marta lindqvist')
    memberDialog().contains('button', /^Add member$/).click()

    memberDialog().contains('already has a member with that name').should('be.visible')
  })
})
