import { useUiStore } from '../uiStore'

describe('uiStore', () => {
  beforeEach(() =>
    useUiStore.setState({
      activeModal: null,
      activeProjectId: null,
      activePIId: null,
      activeTeamId: null,
    }),
  )

  it('opens a modal', () => {
    useUiStore.getState().openModal('create-feature')
    expect(useUiStore.getState().activeModal).toBe('create-feature')
  })

  it('closes a modal', () => {
    useUiStore.setState({ activeModal: 'create-feature' })
    useUiStore.getState().closeModal()
    expect(useUiStore.getState().activeModal).toBeNull()
  })

  it('selecting a project lands on the Backlog view', () => {
    useUiStore.getState().setActiveProject('p-1')
    expect(useUiStore.getState().activeProjectId).toBe('p-1')
    expect(useUiStore.getState().activePIId).toBeNull()
  })

  it('clearing the active project clears the active view', () => {
    useUiStore.setState({ activeProjectId: 'p-1', activePIId: 'pi-1' })
    useUiStore.getState().setActiveProject(null)
    expect(useUiStore.getState().activeProjectId).toBeNull()
    expect(useUiStore.getState().activePIId).toBeNull()
  })

  it('opening a team closes the project view', () => {
    useUiStore.setState({ activeProjectId: 'p-1', activePIId: 'pi-1' })
    useUiStore.getState().setActiveTeam('t-1')
    expect(useUiStore.getState().activeTeamId).toBe('t-1')
    // A stale project id would leave the shell rendering the board behind the team.
    expect(useUiStore.getState().activeProjectId).toBeNull()
    expect(useUiStore.getState().activePIId).toBeNull()
  })

  it('opening a project closes the team view', () => {
    useUiStore.setState({ activeTeamId: 't-1' })
    useUiStore.getState().setActiveProject('p-1')
    expect(useUiStore.getState().activeProjectId).toBe('p-1')
    expect(useUiStore.getState().activeTeamId).toBeNull()
  })

  it('setActivePI selects a PI or returns to Backlog', () => {
    useUiStore.getState().setActivePI('pi-1')
    expect(useUiStore.getState().activePIId).toBe('pi-1')

    useUiStore.getState().setActivePI(null)
    expect(useUiStore.getState().activePIId).toBeNull()
  })
})
