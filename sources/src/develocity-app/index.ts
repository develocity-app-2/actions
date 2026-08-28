import * as core from '@actions/core'

import {fetchRepoStatus, type RepoStatus} from './client'
import {buildConnectUrl, contextFromEnvironment} from './connectUrl'
import {connectPrompt, connectedSummary, unreachableSummary} from './summary'
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
 * Nothing about the build changes here. The features the App reports are reported, and no more.
 */

/** Where the fetched status is saved for the post step, and for the steps built on top of this. */
export const STATUS_STATE = 'DEVELOCITY_APP_STATUS'

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
        core.saveState(STATUS_STATE, JSON.stringify(status))

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
