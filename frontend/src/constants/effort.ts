export const EFFORT_VALUES = [0, 0.5, 1, 2, 3, 5, 8, 13, 21] as const
export type EffortValue = (typeof EFFORT_VALUES)[number]
