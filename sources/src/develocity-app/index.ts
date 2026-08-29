import * as core from '@actions/core'

import {fetchRepoStatus, type RepoStatus} from './client'
import {buildConnectUrl, contextFromEnvironment} from './connectUrl'
import {configurePublishing} from './publish'
import {currentStatus, saveStatus} from './status'
import {connectPrompt, connectedSummary, publishSummary, unreachableSummary} from './summary'
import {mintIdToken, oidcAvailable} from './token'

/**
 * The Develocity GitHub App integration: this fork's whole delta, in one place.
 *
 * With `develocity-url` set, it mints a GitHub Actions OIDC token, asks the App what this
 * repository's status is, and renders that in the Job Summary. Without it, nothing is minted and
 * nothing is contacted -- but the call to action still renders, built entirely from the local
 * environment. Connecting is something a workflow has to say out loud; inviting it to say so costs
 * no credential and no network call.
 *
 * Both `setup-gradle` and `dependency-submission` call this, on identical terms: the same call to
 * action, the same status, the same features. A job using both reports once -- see `REPORTED_VAR`.
 *
 * Nothing about the build changes here. The features the App reports are reported, and no more.
 */

/**
 * Marks that this job has already reported. Exported to the environment rather than saved as state,
 * because it has to be visible to a *later step* -- `setup-gradle` and `dependency-submission` both
 * report, and a job using both would otherwise mint two tokens, call the App twice and render the
 * call to action twice. The same idiom, for the same reason, as `GRADLE_BUILD_ACTION_SETUP_COMPLETED`
 * in `setup-gradle.ts`.
 */
const REPORTED_VAR = 'DEVELOCITY_APP_STATUS_REPORTED'

/**
 * Act on the features the App reported, once upstream's own setup has run.
 *
 * Deliberately a second entry point rather than part of `reportDevelocityAppStatus`, because both
 * things it does depend on running *after* `setupGradle.setup(...)`:
 *
 * - the injection variables are defaulted only where the action's inputs did not set them, and
 *   those inputs are exported to the environment by upstream's `buildScan.setup`;
 * - an access key supplied by the workflow is exchanged by upstream's `setupToken`, and minting an
 *   OIDC token before that ran would race a credential this module is supposed to defer to.
 *
 * Reads the status the reporting half established. The App is not called a second time.
 */
export async function configureDevelocityAppFeatures(): Promise<void> {
    try {
        const status = currentStatus()
        if (!status) return

        const outcome = await configurePublishing(status)
        if (outcome.kind === 'failed') {
            core.warning(`Develocity App: Build Scan publishing could not be configured. ${outcome.reason}`)
        }

        const rendered = publishSummary(outcome)
        if (rendered) {
            core.summary.addRaw(rendered)
            await core.summary.write()
        }
    } catch (error) {
        core.warning(`Develocity App: could not configure features. ${asMessage(error)}`)
    }
}

/**
 * Written in the *main* step, not the post step, for two reasons: `GITHUB_STEP_SUMMARY` appends in
 * write order, so writing here puts the call to action above the build-results summary, which is
 * where a call to action belongs; and the status has to be known before the build runs.
 *
 * Every path appends and returns normally. A failure to reach the App warns and continues -- the
 * build never fails because of anything in here.
 */
export async function reportDevelocityAppStatus(): Promise<void> {
    try {
        // Bypass on all but the first gradle/actions step in the job.
        if (process.env[REPORTED_VAR]) {
            core.info('Develocity App: status already reported by an earlier gradle/actions step.')
            return
        }
        core.exportVariable(REPORTED_VAR, true)

        const appUrl = core.getInput('develocity-app-url').trim()
        const context = contextFromEnvironment()
        const repository = context.repository ?? 'this repository'
        const localConnectUrl = buildConnectUrl(appUrl, context)

        // 1. `develocity-url` is the opt-in. Its value is not dereferenced here -- its presence is
        //    the workflow declaring that this build should use Develocity at all.
        if (!core.getInput('develocity-url').trim()) {
            core.info('Develocity App: no develocity-url input, so the App will not be contacted.')
            core.summary.addRaw(connectPrompt(repository, localConnectUrl))
            await core.summary.write()
            return
        }

        // 2. Without `id-token: write` the workflow cannot prove which repository it is, so there
        //    is nothing to ask with. A different failure from the one above, and a different log.
        if (!oidcAvailable()) {
            core.info('Develocity App: this workflow lacks id-token: write, so the App will not be contacted.')
            core.summary.addRaw(connectPrompt(repository, localConnectUrl))
            await core.summary.write()
            return
        }

        // 3. Mint, ask, render.
        const audience = core.getInput('develocity-app-audience').trim() || appUrl
        const result = await mintAndFetch(appUrl, audience)

        if (!result.ok) {
            core.warning(`Develocity App: could not determine this repository's status. ${result.reason}`)
            core.summary.addRaw(unreachableSummary(repository, localConnectUrl))
            await core.summary.write()
            return
        }

        const status = result.status
        saveStatus(status)

        const enabled = (status.features ?? []).filter(feature => feature.enabled).map(feature => feature.id)
        core.info(
            `Develocity App: connected=${status.connected} for ${status.repository}` +
                `, features enabled: ${enabled.join(', ') || 'none'}`
        )

        // The App's URL is used verbatim, for the call to action and for *Manage features* alike:
        // it decides what belongs on it, including whether a workflow rides along.
        const appConnectUrl = status.connectUrl ?? localConnectUrl
        core.summary.addRaw(
            status.connected ? connectedSummary(status, appConnectUrl) : connectPrompt(repository, appConnectUrl)
        )
        await core.summary.write()
    } catch (error) {
        // Reaching here means something other than reachability broke. Still not worth a build.
        core.warning(`Develocity App: could not render the status summary. ${asMessage(error)}`)
    }
}

async function mintAndFetch(
    appUrl: string,
    audience: string
): Promise<{ok: true; status: RepoStatus} | {ok: false; reason: string}> {
    let token: string
    try {
        token = await mintIdToken(audience)
    } catch (error) {
        return {ok: false, reason: `Could not mint an OIDC token: ${asMessage(error)}`}
    }

    return await fetchRepoStatus(appUrl, token)
}

function asMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
