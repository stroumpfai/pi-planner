/**
 * Teams on the home page — create, rename, delete (teams.md §3.1, §4.2, §10).
 *
 * Projects and teams are peers on one page, so **every** selector here scopes to
 * its own <section> first. A bare cy.contains('Platform') would match a project
 * row just as happily as a team row, and the failure that causes is silent: the
 * spec passes against the wrong element until somebody names a project after a
 * team.
 *
 * Team writes are outside the edit lock (§4.1) and the Teams section's controls
 * are gated on canEdit() — a role check — exactly like the project rows. So there
 * is no cy.enterEditMode() anywhere in this file; testuser is an admin and sees
 * the buttons on arrival.
 */

const teamsSection = () => cy.get('section[aria-labelledby="teams-heading"]')
const projectsSection = () => cy.get('section[aria-labelledby="projects-heading"]')

/** A team's row, scoped to the Teams section so a same-named project cannot match. */
const teamRow = (name: string) => teamsSection().contains('li', name)

const EMPTY_STATE = 'No teams yet — a team lets you compute sprint capacity from who is available.'

/** Fill the create/edit team form. Scoped to the dialog: the fields are registered
 *  by react-hook-form as name="name" etc., which the project modals use too. */
const dialog = () => cy.get('[role="dialog"]')

describe('Teams', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
  })

  it('shows the empty state on a fresh instance, and clears it once a team exists', () => {
    teamsSection().contains(EMPTY_STATE).should('be.visible')

    cy.request('POST', '/api/v1/teams', { name: 'Platform' })
    cy.reload()

    teamsSection().contains(EMPTY_STATE).should('not.exist')
    teamRow('Platform').should('be.visible')
  })

  it('creates a team from the home page and lists it with its counts', () => {
    teamsSection().contains('button', /^\+ New Team$/).click()

    dialog().find('input[name="name"]').type('Platform')
    dialog().find('textarea[name="description"]').type('Runs the shared services')
    dialog().contains('button', /^Create Team$/).click()

    // A brand-new team has nobody in it and serves nothing, and the row says so
    // rather than leaving the column blank.
    teamRow('Platform').should('contain', '0 members').and('contain', '0 projects')
    teamRow('Platform').should('contain', 'Runs the shared services')
    teamsSection().contains(EMPTY_STATE).should('not.exist')
  })

  it('renames a team and the new name replaces the old one', () => {
    cy.request('POST', '/api/v1/teams', { name: 'Original Team' })
    cy.reload()

    teamRow('Original Team').contains('button', /^Edit$/).click()
    // The modal shows "Loading…" until its own read lands; the form only exists
    // after that, so wait for the field rather than for the dialog.
    dialog().find('input[name="name"]').should('have.value', 'Original Team')
    dialog().find('input[name="name"]').clear().type('Renamed Team')
    dialog().contains('button', /^Save$/).click()

    teamRow('Renamed Team').should('be.visible')
    teamsSection().contains('Original Team').should('not.exist')
  })

  it('deletes a team and returns to the empty state', () => {
    cy.request('POST', '/api/v1/teams', { name: 'Doomed Team' })
    cy.reload()

    teamRow('Doomed Team').contains('button', /^Delete$/).click()
    // Anchored, and scoped to the dialog: the row behind it still carries its own
    // "Delete" button, and a team named "Delete" would match a substring.
    dialog().contains('button', /^Delete$/).click()

    teamsSection().contains('Doomed Team').should('not.exist')
    teamsSection().contains(EMPTY_STATE).should('be.visible')
  })

  it('runs the whole journey without a reload: create, rename, delete', () => {
    teamsSection().contains('button', /^\+ New Team$/).click()
    dialog().find('input[name="name"]').type('Journey Team')
    dialog().contains('button', /^Create Team$/).click()
    teamRow('Journey Team').should('be.visible')

    teamRow('Journey Team').contains('button', /^Edit$/).click()
    dialog().find('input[name="name"]').should('have.value', 'Journey Team')
    dialog().find('input[name="name"]').clear().type('Journey Team Renamed')
    dialog().contains('button', /^Save$/).click()
    teamRow('Journey Team Renamed').should('be.visible')

    teamRow('Journey Team Renamed').contains('button', /^Delete$/).click()
    dialog().contains('button', /^Delete$/).click()
    teamsSection().contains(EMPTY_STATE).should('be.visible')
  })

  it('keeps a project and a team of the same name in their own sections', () => {
    // The reason every selector above is scoped. If this passes with the scoping
    // removed, the scoping is not doing its job.
    cy.request('POST', '/api/v1/projects/', { name: 'Atlas' })
    cy.request('POST', '/api/v1/teams', { name: 'Atlas' })
    cy.reload()

    projectsSection().contains('li', 'Atlas').should('contain', 'No team')
    teamRow('Atlas').should('contain', '0 members')
    // The project row has an Export button; the team row does not. Each section
    // therefore found its own row and not the other one's.
    projectsSection().contains('li', 'Atlas').contains('button', /^Export$/).should('exist')
    teamRow('Atlas').contains('button', /^Export$/).should('not.exist')
  })

  it('shows "No team" on a project row while nothing is assigned', () => {
    // Assignment arrives in step 4; until then every project reads "No team".
    cy.request('POST', '/api/v1/projects/', { name: 'Apollo' })
    cy.request('POST', '/api/v1/teams', { name: 'Platform' })
    cy.reload()

    projectsSection().contains('li', 'Apollo').should('contain', 'No team')
  })

  it('opens a team with cy.openTeam and leaves the home page behind', () => {
    cy.request('POST', '/api/v1/teams', { name: 'Platform' })

    cy.openTeam('Platform')

    cy.contains('h2', 'Platform').should('be.visible')
    cy.contains('[role="tab"]', 'Members').should('be.visible')
    cy.contains('h2', 'Teams').should('not.exist')
    // A team view has no project to lock, so the lock button must not follow you
    // in here (implementation plan §1.4).
    cy.contains('button', 'Request Edit Mode').should('not.exist')
  })

  it('rejects a duplicate team name inline', () => {
    cy.request('POST', '/api/v1/teams', { name: 'Platform' })
    cy.reload()

    teamsSection().contains('button', /^\+ New Team$/).click()
    dialog().find('input[name="name"]').type('Platform')
    dialog().contains('button', /^Create Team$/).click()

    dialog().contains('A team with this name already exists').should('be.visible')
  })
})
