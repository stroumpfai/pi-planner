import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    // The 4s default is tight once the suite shares the machine: check.sh runs it
    // beside pytest and vitest, and parallel stacks add a vite dev server each. A
    // slow render then fails a test that is fine. Waits only last as long as they
    // need, so a longer ceiling costs time only when something is really wrong.
    defaultCommandTimeout: 10000,
  },
})
