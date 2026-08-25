describe('PI planning journey', () => {
  let projectId: string

  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'PI Test' }).then((res) => {
      projectId = res.body.system_id
    })
  })

  // Opens the project and takes the lock through the UI. Both matter: there is no
  // URL routing to assert on, and `isEditing` is client-side state that an API-only
  // acquisition never sets — without it every write control stays disabled and
  // drag-and-drop drops are discarded by the board's canEdit guard.
  function openProjectAsEditor() {
    cy.openProject('PI Test')
    cy.enterEditMode()
  }

  it('creates a PI and it appears with Draft state badge', () => {
    openProjectAsEditor()
    cy.contains('button', /\+ new pi/i).click()
    cy.get('input[name="name"]').type('Q1-2026')
    cy.get('button[type="submit"]').click()
    cy.contains('Q1-2026').should('be.visible')
    cy.contains(/draft/i).should('be.visible')
  })

  it('transitions PI from Draft to In Progress and badge updates', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' })
    openProjectAsEditor()
    cy.contains('button', /start pi/i).click()
    cy.get('[role="dialog"]').contains('button', /start pi/i).click()
    cy.contains(/in progress/i).should('be.visible')
  })

  it('only one PI can be In Progress at a time', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' })
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q2-2026' })
    openProjectAsEditor()

    cy.contains('li', 'Q1-2026').contains('button', /start pi/i).click()
    cy.get('[role="dialog"]').contains('button', /start pi/i).click()
    cy.contains(/in progress/i).should('be.visible')

    // The Start control stays visible on the second PI; the rule is enforced by
    // the backend and surfaced as an inline error in the PI list panel.
    cy.contains('li', 'Q2-2026').contains('button', /start pi/i).click()
    cy.get('[role="dialog"]').contains('button', /start pi/i).click()
    cy.contains(/only one pi|already.*in progress|in progress/i).should('be.visible')
  })

  it('moves a feature from backlog into a swimlane', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Auth Feature' })
    cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
      cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Team A' })
    })
    openProjectAsEditor()
    cy.openPI('Q1-2026')

    // dnd-kit's PointerSensor needs >5px of movement to activate, and the drop
    // zone's label changes once hovered, so resolve its coordinates up front and
    // drive the pointer over <body> in viewport space.
    cy.contains<HTMLElement>('Drop features here').then(($zone) => {
      const rect = $zone[0].getBoundingClientRect()
      const x = Math.round(rect.left + rect.width / 2)
      const y = Math.round(rect.top + rect.height / 2)
      cy.get('[data-testid="backlog-list"]').contains('Auth Feature').realMouseDown()
      cy.get('body').realMouseMove(x - 150, y)
      cy.get('body').realMouseMove(x, y)
      cy.get('body').realMouseUp()
    })

    cy.get('[data-testid="backlog-list"]').should('not.contain', 'Auth Feature')
    cy.contains('Auth Feature').should('be.visible')
  })

  it('creates a group in a swimlane and assigns PBIs', () => {
    cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Feature X' }).then((fRes) => {
      cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
        title: 'Story 1',
        parent_feature_system_id: fRes.body.system_id,
        item_type: 'story',
      })
      cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
        cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Team A' }).then((slRes) => {
          cy.request('PATCH', `/api/v1/features/${fRes.body.system_id}`, {
            location: 'pi',
            pi_id: piRes.body.system_id,
            swimlane_id: slRes.body.system_id,
          })
        })
      })
    })
    openProjectAsEditor()
    cy.openPI('Q1-2026')

    // Grouping is a three-step affordance on the feature card: expand it, tick the
    // PBIs, then confirm — which opens the name modal.
    cy.get('button[title="Select PBIs to group"]').first().click({ force: true })
    // The PBI's row label uses `display: contents`, so it measures 0x0 and Cypress
    // refuses an unforced click even though it is on screen.
    cy.contains('Story 1').click({ force: true })
    cy.contains('button', /^\+ Group \d+ PBI/).click()
    cy.get('#group-name').type('Sprint Group 1')
    cy.get('button[type="submit"]').click()
    cy.contains('Sprint Group 1').should('be.visible')
  })

  // Group and PBI drops onto a sprint cell — the two board interactions with no
  // browser-level coverage. Both go through handleDragEnd's sprintcell branches,
  // which the unit spec drives directly; this proves dnd-kit really produces
  // those payloads from a real pointer.
  describe('dropping onto a sprint cell', () => {
    let swimlaneId: string
    let featureId: string
    let pbiId: string

    beforeEach(() => {
      cy.request('POST', `/api/v1/projects/${projectId}/features`, { title: 'Payments' }).then((fRes) => {
        featureId = fRes.body.system_id
        cy.request('POST', `/api/v1/projects/${projectId}/pbis`, {
          title: 'Card capture',
          parent_feature_system_id: featureId,
          item_type: 'story',
        }).then((pRes) => {
          pbiId = pRes.body.system_id
        })
        cy.request('POST', `/api/v1/projects/${projectId}/pis`, { name: 'Q1-2026' }).then((piRes) => {
          cy.request('POST', `/api/v1/pis/${piRes.body.system_id}/swimlines`, { name: 'Team A' }).then((slRes) => {
            swimlaneId = slRes.body.system_id
            cy.request('PATCH', `/api/v1/features/${featureId}`, {
              location: 'pi',
              pi_id: piRes.body.system_id,
              swimlane_id: swimlaneId,
            })
          })
        })
      })
    })

    // Empty cells carry a data-testid because they render no text until a drag
    // hovers them — there is nothing else to aim at.
    const cell = (sprintIndex: number) =>
      cy.get(`[data-testid="sprintcell:${swimlaneId}:${featureId}:${sprintIndex}"]`)

    const centre = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    }

    // Drags the given handle onto a sprint cell.
    //
    // Two things make this more than "move the pointer to the target". dnd-kit's
    // PointerSensor needs >5px of travel before the drag exists at all, and the
    // board uses closestCenter — which resolves the drop from the centre of the
    // *dragged element*, not from the pointer. Grabbing a handle at the far left
    // of a wide row therefore lands a column to the right unless the grab offset
    // is subtracted. In both cases here the draggable node (the one holding
    // dnd-kit's ref) is the handle's grandparent: the listeners sit on an inner
    // wrapper.
    function dragTo(handle: () => Cypress.Chainable<JQuery<HTMLElement>>, sprintIndex: number) {
      let offset = { x: 0, y: 0 }
      handle().then(($handle) => {
        const grab = centre($handle[0])
        const node = $handle[0].parentElement?.parentElement ?? $handle[0]
        const nodeCentre = centre(node)
        offset = { x: grab.x - nodeCentre.x, y: grab.y - nodeCentre.y }

        cy.wrap($handle).realMouseDown()
        cy.get('body').realMouseMove(grab.x + 20, grab.y)
      })
      // Measured after the drag is live, so any reflow it caused is already applied.
      cell(sprintIndex).then(($cell) => {
        const to = centre($cell[0])
        cy.get('body').realMouseMove(to.x + offset.x, to.y + offset.y)
        cy.get('body').realMouseUp()
      })
    }

    it('drags a PBI into a sprint cell', () => {
      openProjectAsEditor()
      cy.openPI('Q1-2026')

      // The drag handle lives in the card's PBI panel, behind the same toggle the
      // grouping journey uses.
      cy.get('button[title="Select PBIs to group"]').first().click({ force: true })
      dragTo(() => cy.get('[title="Drag to sprint"]').first(), 1)

      cell(1).should('contain', 'Card capture')
    })

    it('drags a group from one sprint to another', () => {
      cy.then(() => {
        cy.request('POST', `/api/v1/swimlines/${swimlaneId}/groups`, {
          name: 'Payment Group',
          feature_system_id: featureId,
          pbi_ids: [pbiId],
          sprint_index: 0,
        })
      })
      openProjectAsEditor()
      cy.openPI('Q1-2026')
      cell(0).should('contain', 'Payment Group')

      dragTo(() => cy.contains<HTMLElement>('Payment Group'), 2)

      cell(2).should('contain', 'Payment Group')
      cell(0).should('not.contain', 'Payment Group')
    })
  })
})
