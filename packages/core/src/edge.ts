/**
 * Edge-runtime entry point (`edge-light` export condition).
 *
 * Identical public surface to the default bundle EXCEPT the Axios adapter is
 * not re-exported — edge runtimes have no Node http stack, so `createClient`
 * falls back to the fetch adapter automatically (see environment/edgeSafe.ts).
 */
export * from './index'
