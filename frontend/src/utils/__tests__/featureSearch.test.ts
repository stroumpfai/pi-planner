import { featureSearchLabel, matchesFeatureQuery } from '../featureSearch'

describe('featureSearchLabel', () => {
  it('prefixes the user id in brackets', () => {
    expect(featureSearchLabel({ id: 101, title: 'Auth service' })).toBe('[101] Auth service')
  })

  it('omits the prefix when the feature has no user id', () => {
    expect(featureSearchLabel({ id: null, title: 'Auth service' })).toBe('Auth service')
  })
})

describe('matchesFeatureQuery', () => {
  const feature = { id: 101, title: 'Auth service' }

  it('matches everything for an empty query', () => {
    expect(matchesFeatureQuery(feature, '')).toBe(true)
  })

  it('matches everything for a whitespace-only query', () => {
    expect(matchesFeatureQuery(feature, '   ')).toBe(true)
  })

  it('matches a title substring', () => {
    expect(matchesFeatureQuery(feature, 'serv')).toBe(true)
  })

  it('ignores case', () => {
    expect(matchesFeatureQuery(feature, 'AUTH')).toBe(true)
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesFeatureQuery(feature, '  auth  ')).toBe(true)
  })

  it('matches a full user id', () => {
    expect(matchesFeatureQuery(feature, '101')).toBe(true)
  })

  it('matches a partial user id', () => {
    expect(matchesFeatureQuery(feature, '10')).toBe(true)
  })

  it('matches the bracketed id form', () => {
    expect(matchesFeatureQuery(feature, '[10')).toBe(true)
  })

  it('matches by title when the feature has no user id', () => {
    expect(matchesFeatureQuery({ id: null, title: 'Auth service' }, 'auth')).toBe(true)
  })

  it('does not match a numeric query against a feature without a user id', () => {
    expect(matchesFeatureQuery({ id: null, title: 'Auth service' }, '101')).toBe(false)
  })

  it('returns false when nothing matches', () => {
    expect(matchesFeatureQuery(feature, 'billing')).toBe(false)
  })
})
