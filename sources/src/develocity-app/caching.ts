import * as core from '@actions/core'

import {currentStatus} from './status'

/**
 * Enhanced GitHub Actions caching, gated on the App reporting the feature enabled.
 *
 * Upstream defaults to enhanced caching and lets a workflow opt out. This fork inverts that: basic
 * caching is what a repository gets, and enhanced is unlocked by connecting. Enhanced caching is the
 * proprietary `gradle-actions-caching` provider (`DISTRIBUTION.md`), which makes it the thing worth
 * putting behind registration -- and registering is the whole price.
 *
 * | `cache-provider` | Connected, feature on | Anything else   |
 * | ---              | ---                   | ---             |
 * | *unset*          | enhanced              | basic, `info`   |
 * | `enhanced`       | enhanced              | basic, `warning`|
 * | `basic`          | basic                 | basic           |
 * | `external`       | external              | external        |
 *
 * "Anything else" is deliberately one bucket. Not connected, feature off, no `develocity-url`, no
 * `id-token: write`, a downed tunnel, a 401, a timeout -- the gate opens only on a positive answer,
 * so the proprietary provider is never engaged without a verified entitlement, and there is no third
 * case to reason about.
 *
 * **Nothing here fails a build.** A workflow that asked for enhanced caching and is not entitled to
 * it is told so and given basic caching. Failing would make a Develocity outage break CI for a
 * feature that is, by construction, only ever an optimisation.
 */

export const ENHANCED_CACHING = 'enhanced-caching'

function entitled(): boolean {
    const status = currentStatus()
    if (!status?.connected) return false
    return (status.features ?? []).some(feature => feature.id === ENHANCED_CACHING && feature.enabled)
}

/**
 * Said once per step, not once per read.
 *
 * `getCacheProvider()` is consulted up to four times in a single step -- `getCacheService` reads it
 * twice and `getProviderNote` twice again -- and the decision is stable across all of them because
 * it reads one status. The message is what would repeat, so that is what is guarded.
 */
let announced = false

function announce(explicit: boolean): void {
    if (announced) return
    announced = true

    if (!explicit) {
        core.info(
            'Develocity App: using basic caching. Enhanced GitHub Actions Caching is available to ' +
                'repositories connected to Develocity with the feature enabled.'
        )
        return
    }

    const connectUrl = currentStatus()?.connectUrl
    core.warning(
        "Develocity App: 'cache-provider: enhanced' was requested, but this repository is not " +
            'connected to Develocity with Enhanced GitHub Actions Caching enabled. Using basic ' +
            `caching instead.${connectUrl ? ` Connect it at ${connectUrl}` : ''}`
    )
}

/**
 * Whether this repository may use enhanced caching; announces the downgrade when it may not.
 *
 * Answers a boolean rather than a `CacheProvider` so that nothing here imports `configuration.ts`,
 * which imports this. That would be a real cycle rather than a type-only one: the enum is a runtime
 * value. It is the same reason `status.ts` exists.
 *
 * `explicit` distinguishes the workflow having asked for enhanced caching from it having said
 * nothing. That is the only difference between the two, and it is only the log level -- but somebody
 * who wrote `enhanced` asked for something specific and should be told plainly they did not get it.
 */
export function enhancedCachingAllowed(explicit: boolean): boolean {
    if (entitled()) return true

    announce(explicit)
    return false
}
