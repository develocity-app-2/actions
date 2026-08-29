import * as core from '@actions/core'

import type {RepoStatus} from './client'

/**
 * The status the App gave for this repository, for whatever else in the job needs to act on it.
 *
 * A leaf module on purpose. `configuration.ts` reads this to resolve the cache provider, and
 * `index.ts` reaches `publish.ts` -> `develocity/short-lived-token.ts` -> `configuration.ts`, so
 * having `configuration.ts` import `index.ts` would close an import cycle. Nothing here imports
 * anything but `@actions/core` and a type.
 */

/** Where the fetched status is saved for the post step. */
export const STATUS_STATE = 'DEVELOCITY_APP_STATUS'

/**
 * The in-memory copy, for readers in the same step as the fetch.
 *
 * `core.saveState`/`getState` move state from the main step to the *post* step: the runner only
 * populates `STATE_*` in the post step's environment, so read back within a single step `getState`
 * always returns empty. Both routes are needed, and `currentStatus` prefers the one that works.
 */
let fetched: RepoStatus | undefined

export function saveStatus(status: RepoStatus): void {
    fetched = status
    core.saveState(STATUS_STATE, JSON.stringify(status))
}

/**
 * The status this job established, or `undefined` when there is none -- the workflow did not opt in,
 * did not grant `id-token: write`, or the App could not be reached.
 *
 * The post step depends on this answering the same way the main step did. `setup-gradle` restores
 * with one cache provider and saves with another otherwise, which is a corruption rather than a
 * degradation, and nothing in the job would report it.
 */
export function currentStatus(): RepoStatus | undefined {
    if (fetched) return fetched

    const saved = core.getState(STATUS_STATE)
    if (!saved) return undefined

    try {
        return JSON.parse(saved) as RepoStatus
    } catch {
        // Saved by this action a moment ago, so this cannot really happen -- but a throw here would
        // surface as a failure to read an input, which is a lie about what went wrong.
        return undefined
    }
}
