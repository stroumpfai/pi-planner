# Pre-existing frontend test failures

These 5 tests were already failing on `main` before the PI export work. They are not regressions.

---

## 1. `App.test.tsx` — all 4 tests (TypeError: window.matchMedia)

**File:** `frontend/src/components/__tests__/App.test.tsx`

**Tests affected:**
- `App > shows login page when unauthenticated`
- `App > renders header with PI Planner when authenticated`
- `App > clicking Sign out calls logout.mutate`
- `App > clicking PI Planner home button calls setActiveProject(null)`

**Root cause:**
`useTheme` (called inside `App`) unconditionally calls `window.matchMedia(...)` when
`colorScheme === 'system'`. jsdom does not implement `window.matchMedia`, so all four tests
throw before the component renders:

```
TypeError: window.matchMedia is not a function
  at src/hooks/useTheme.ts:18:23
```

**Fix options (pick one):**

**Option A — mock in `test-setup.ts`** (covers the whole test suite):
```ts
// frontend/src/test-setup.ts
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})
```

**Option B — mock only in `App.test.tsx`**:
```ts
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }),
  })
})
```

Option A is preferred — `matchMedia` is likely to be needed in other tests too.

---

## 2. `GroupCard.test.tsx` — 1 test (stale class name assertion)

**File:** `frontend/src/components/__tests__/GroupCard.test.tsx`

**Test affected:**
- `GroupCard > keeps the gray effort pill and Bug badge on each PBI/Bug once placed in a sprint`

**Root cause:**
The test asserts that the effort pill contains `bg-gray-100`, but after the Soft UI / dark-mode
refresh the class changed to `bg-band text-gray-500 dark:text-gray-400`:

```
AssertionError: expected 'ml-auto flex-shrink-0 text-xs font-mo…' to contain 'bg-gray-100'
- Expected:  bg-gray-100
+ Received:  ml-auto flex-shrink-0 text-xs font-mono bg-band text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full
```

**Fix:**
Update the assertion in the test to match the current Tailwind classes:
```ts
// Before
expect(pill.className).toContain('bg-gray-100')

// After
expect(pill.className).toContain('bg-band')
```

Or test by role/text content instead of class name to make the assertion styling-agnostic.
