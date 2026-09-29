<!-- since: 37de6dc — scripts/release-notes.sh appends new commits here;
     condense/edit in place, then commit. -->

## Unreleased

- Teams can now be exported to and imported from JSON
- Add JSON export/import for teams
- Fix stale Docker Compose secrets instructions, drop Roadmap section
- Add docs/capacity.md explaining the team capacity computation
- Replace matplotlib with a small Pillow-based renderer for PI PNG/PDF exports
- Ignore tests and secrets when building the mcp-server image, drop unused uvicorn extras
- Bump app to 1.13.0 and mcp-server to 1.8.0
- Show who counts towards capacity in every team view
- Cover the velocity suggestion end to end, and give the test projects their units
- Suggest a measured velocity in the assignment editor
- Serve a project's measured velocity from the Achievement grid
- Add the step-4 contract: a project's measured velocity
- Keep a completion date when the CSV's date cells are blank
