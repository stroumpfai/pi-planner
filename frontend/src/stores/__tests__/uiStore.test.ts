import { useUiStore } from '../uiStore'

describe('uiStore', () => {
  beforeEach(() => useUiStore.setState({ activeModal: null }))

  it('opens a modal', () => {
    useUiStore.getState().openModal('create-feature')
    expect(useUiStore.getState().activeModal).toBe('create-feature')
  })

  it('closes a modal', () => {
    useUiStore.setState({ activeModal: 'create-feature' })
    useUiStore.getState().closeModal()
    expect(useUiStore.getState().activeModal).toBeNull()
  })
})
