import * as core from '@actions/core'

import {loadBuildResults} from '../build-results'
import {TIMEOUT_MS, type RepoStatus} from './client'
import {currentStatus} from './status'
import {mintIdToken, oidcAvailable} from './token'

/**
 * Reporting a failed build's Build Scans to the Develocity GitHub App, so it can summarise the
 * failures on the pull request.
 *
 * The action does not read the failures and does not write the comment. It knows two things the
 * App cannot find out for itself -- that this job's build failed, and which Build Scans it
 * published -- and sends only those. Everything else the App derives from the OIDC claims, which
 * is what keeps a workflow from asking for a comment on somebody else's pull request.
 *
 * Runs in the *post* step, because a Build Scan URL does not exist until the build has finished.
 */

export const TEST_FAILURE_ANALYTICS = 'test-failure-analytics'

/**
 * Marks that this job has already reported its failures. The same idiom, for the same reason, as
 * `DEVELOCITY_APP_STATUS_REPORTED` in `index.ts`: a job running both `setup-gradle` and
 * `dependency-submission` has two post steps, and only the first of them finds any build results.
 */
const REPORTED_STATE = 'DEVELOCITY_APP_FAILURES_REPORTED'

function isEnabled(status: RepoStatus): boolean {
    return (status.features ?? []).some(feature => feature.id === TEST_FAILURE_ANALYTICS && feature.enabled)
}

/** `https://server/s/abc123` -> `abc123`. The App accepts either, but the id is the smaller claim. */
function buildScanId(uri: string): string | undefined {
    return /\/s\/([a-z0-9]+)\/?$/i.exec(uri)?.[1]
}

/**
 * Send the failed builds' scan ids, if there are any and the feature is on.
 *
 * Never throws and never fails the step, on the same terms as the rest of this module: a report
 * that does not arrive is a comment that does not appear, which is strictly less bad than a build
 * that fails because a pull-request comment could not be posted.
 */
export async function reportBuildFailures(): Promise<void> {
    try {
        if (core.getState(REPORTED_STATE)) return

        const status = currentStatus()
        if (!status || !isEnabled(status)) return

        // Read *before* `setupGradle.complete` marks the results processed, after which they are
        // no longer loadable. This is why the call site sits ahead of it in the post step.
        const failed = loadBuildResults().filter(result => result.buildFailed && result.buildScanUri)
        if (failed.length === 0) return

        const buildScanIds = failed
            .map(result => buildScanId(result.buildScanUri))
            .filter((id): id is string => id !== undefined)
        if (buildScanIds.length === 0) {
            core.info('Develocity App: no Build Scan ids to report, so no failure summary was requested.')
            return
        }

        core.saveState(REPORTED_STATE, true)

        const appUrl = core.getInput('develocity-app-url').trim()
        if (!appUrl || !oidcAvailable()) return

        const audience = core.getInput('develocity-app-audience').trim() || appUrl
        const token = await mintIdToken(audience)

        const url = `${appUrl.replace(/\/+$/, '')}/api/build-failures`
        const response = await fetch(url, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({buildScanIds}),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        })

        if (!response.ok) {
            core.warning(`Develocity App: the failure summary was not posted (${url} answered ${response.status}).`)
            return
        }

        // The App answers 200 for outcomes the action cannot act on -- not a pull request, nothing
        // readable yet -- so the reason is logged rather than warned about.
        const body = (await response.json().catch(() => ({}))) as {reported?: boolean; reason?: string}
        core.info(
            body.reported
                ? `Develocity App: failure summary posted for ${buildScanIds.length} build(s).`
                : `Develocity App: no failure summary posted (${body.reason ?? 'no reason given'}).`
        )

        await writeSummary(body)
    } catch (error) {
        core.warning(
            `Develocity App: could not report build failures. ${error instanceof Error ? error.message : String(error)}`
        )
    }
}

/**
 * One line, so the Job Summary accounts for everything the App did rather than only for what it did
 * before the build. Written from the post step ahead of `setup-gradle`'s own completion, so it lands
 * between the main step's status block and the build-results table.
 *
 * Says why nothing was posted as readily as it says that something was: "no comment appeared" is the
 * same observation whether the feature is off, the run is not a pull request, or the App broke, and
 * only one of those is worth acting on.
 */
async function writeSummary(body: {reported?: boolean; reason?: string}): Promise<void> {
    const line = body.reported
        ? '<p>&#9989; Develocity App: failure summary added to the pull request.</p>\n'
        : `<p>&#8505;&#65039; Develocity App: no failure summary was added (${body.reason ?? 'no reason given'}).</p>\n`

    core.summary.addRaw(line)
    await core.summary.write()
}
