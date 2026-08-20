declare namespace Cypress {
  interface Chainable {
    login(username?: string, password?: string): Chainable<void>
    resetDb(): Chainable<void>
    /** Visit the app and open a project by name (no URL routing — this clicks). */
    openProject(name: string): Chainable<void>
    /** Open a PI from the left-hand PI list panel. Call after openProject. */
    openPI(name: string): Chainable<void>
    /** Click "Request Edit Mode" and wait for the editor badge. */
    enterEditMode(): Chainable<void>
  }
}
