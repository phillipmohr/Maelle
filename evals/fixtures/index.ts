import { CASE_FIXTURES } from './cases'
import { EXAMPLE_FIXTURES } from './examples'
import { HANDOFF_FIXTURES } from './handoff'
import type { Fixture } from './types'

export * from './types'
export * from './worlds'
export {
  CASE_FIXTURES,
  CASE_1_CANCELLATION,
  CASE_2_REFUND,
  CASE_3_CHARGEBACK,
  CASE_4_BUG,
  CASE_5_FEATURE,
  CASE_6_SAFETY,
  CASE_7_DATA_ACCURACY,
} from './cases'
export { EXAMPLE_FIXTURES } from './examples'
export { HANDOFF_FIXTURES, HANDOFF_STORY_VIEWERS } from './handoff'

export const ALL_FIXTURES: Fixture[] = [...CASE_FIXTURES, ...EXAMPLE_FIXTURES, ...HANDOFF_FIXTURES]
