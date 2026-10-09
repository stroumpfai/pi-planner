<!-- since: 3e4552f — scripts/release-notes.sh appends new commits here;
     condense/edit in place, then commit. -->

## Unreleased


# Version 1.14

- CSV Import
  - Import both ADO CSV exports queries and keep their Epic, Area Path and Committed
  - Place imported items on the PI board from their Iteration Path

- Teams and Capacity
  - Teams can now be exported to and imported from JSON
  - Let one project take the team's remaining capacity, and give each allocation one share field
  - Import absences from an .ics calendar file, and update them on re-import
  - Make a long .ics file workable in the absence import
  - Let a share be days a week, on the assignment or for one member
  - Let a project assignment count only some of the team's members
  - Add shared holiday calendars that teams enable, counted in capacity

- Documentation
  - Add docs/capacity.md explaining the team capacity computation. Check source code repo.

- Improvements in testing coverage
  - Bring TESTING.md up to date, and measure frontend coverage over src only
  - Raise the coverage floors, enforce the frontend's, and add per-file floors
  - Measure branch coverage in the release report
  - Cover holiday calendars in every layer, and the MCP workflow error paths
  - Test the OAuth provider's rejection paths
  - Test the MCP activity log and its guard against forged entries
  - Fix two failing E2E specs: stale PBI modal and team-row selector

- Security improvements
  - Refuse weak signing secrets, and end OAuth grants with the API key behind them
  - Treat a 404 from the backend's key endpoints as unavailable, not as a revoked key
  - Document OAUTH_ALLOWED_REDIRECT_HOSTS, and refuse an unlisted redirect with a clear reason
  - Limit open OAuth registration, revoke a deleted user's keys, and hide which usernames exist

- Improve the release note generation
  - Read any heading level in release notes, and move the file's marker on --since
  - Stop release-notes.sh dropping commits when Unreleased is missing

- Technical updates
  - Clean-up Docker image
  - Reduce Docker image size by replacing matplotlib with a small Pillow-based renderer for PI PNG/PDF exports

<br>

# Previous Releases
- Show who counts towards capacity in every team view
- Cover the velocity suggestion end to end, and give the test projects their units
- Suggest a measured velocity in the assignment editor
- Serve a project's measured velocity from the Achievement grid
- Keep a completion date when the CSV's date cells are blank
- Add a Release Notes page, generated from commit history
