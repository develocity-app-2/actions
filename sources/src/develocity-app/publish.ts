import * as core from '@actions/core'

import {ShortLivedTokenClient} from '../develocity/short-lived-token'
import type {RepoStatus} from './client'
import {mintIdToken} from './token'

/**
 * Build Scan publishing, when the Develocity GitHub App reports the feature enabled.
 *
 * Nothing here is a new mechanism. `setup-gradle` already exchanges a credential for a short-lived
 * Develocity token at `/api/auth/token`, and already injects and configures the Develocity plugin
 * for builds that do not reference it. This adds one thing to each: a GitHub OIDC token as the
 * bearer for that exchange, so no Develocity credential has to be stored anywhere, and a project id
 * so the injected build names the project it is entitled to publish to.
 */

export const BUILD_SCAN_PUBLISHING = 'build-scan-publishing'

/**
 * The Develocity plugin version injection applies when nothing else specifies one.
 *
 * Injection is gated on a plugin version: the init script's whole apply-and-configure block sits
 * behind `if (develocityPluginVersion)`, so without this the plugin is never applied, the build
 * publishes nothing, and *nothing is logged* -- not an error, not a denial. Upstream only defaults
 * it for `build-scan-publish`, which this path does not use, so it has to be defaulted here.
 *
 * Kept equal to upstream's own default in `develocity/build-scan.ts`.
 */
const DEFAULT_DEVELOCITY_PLUGIN_VERSION = '4.5.0'

export type PublishOutcome =
    | {kind: 'not-enabled'}
    | {kind: 'configured'; projectId: string | undefined; injected: boolean}
    | {kind: 'delegated'}
    | {kind: 'failed'; reason: string}

function isEnabled(status: RepoStatus): boolean {
    return (status.features ?? []).some(feature => feature.id === BUILD_SCAN_PUBLISHING && feature.enabled)
}

/**
 * Whether a Develocity credential was supplied from outside this module.
 *
 * Read *after* upstream's `setupToken` has run, so it covers every route: the
 * `develocity-access-key` input, either access-key environment variable, and the short-lived token
 * `setupToken` exports in their place. Any of them means the credential is upstream's business and
 * this module keeps out of the way -- it must not re-exchange or overwrite what is already there.
 */
function credentialAlreadySupplied(): boolean {
    return Boolean(process.env['DEVELOCITY_ACCESS_KEY'] || process.env['GRADLE_ENTERPRISE_ACCESS_KEY'])
}

/**
 * Default a Develocity injection variable, leaving anything already set alone.
 *
 * This runs *after* `buildScan.setup` has exported the injection variables from the action's
 * inputs, which is what makes the rule this simple: by now "the workflow set the input" and "the
 * variable is set" are the same condition, so a single presence check honours the workflow without
 * having to consult the inputs a second time. Note that `develocity-injection-enabled: false`
 * arrives here as the string `'false'` -- present, and therefore left alone, which is the point.
 *
 * Doing this *before* `setupGradle.setup(...)` would invert the precedence: the variables would not
 * exist yet, and a value defaulted here would then suppress the workflow's own input.
 */
function defaultInjectionVariable(name: string, value: string | undefined): void {
    if (!value) return
    if (process.env[name]) return
    core.exportVariable(name, value)
}

/**
 * Configure this build to publish, and report what happened so the summary can say so.
 *
 * Never throws and never fails the step. A build that cannot publish is a build that publishes
 * nothing -- which the Develocity plugin treats as a warning anyway, so failing here would be a
 * stricter contract than the plugin's own.
 */
export async function configurePublishing(status: RepoStatus): Promise<PublishOutcome> {
    if (!isEnabled(status)) return {kind: 'not-enabled'}

    // The project id the App would have this build publish to. The repository id is the project id
    // by construction, so nothing repository-specific has to be configured or kept in sync.
    defaultInjectionVariable('DEVELOCITY_INJECTION_ENABLED', 'true')
    defaultInjectionVariable('DEVELOCITY_INJECTION_PROJECT_ID', process.env['GITHUB_REPOSITORY_ID'])
    defaultInjectionVariable('DEVELOCITY_INJECTION_DEVELOCITY_PLUGIN_VERSION', DEFAULT_DEVELOCITY_PLUGIN_VERSION)

    // Read back rather than reusing the default: when the workflow set its own project id, that is
    // the one the build will use, and reporting the id this module *would* have chosen would
    // describe a build that is not the one running.
    const projectId = process.env['DEVELOCITY_INJECTION_PROJECT_ID']

    // A workflow may switch injection off while leaving the feature enabled. The credential and the
    // project id are still worth configuring -- a build that applies the Develocity plugin itself
    // will use them -- but nothing will be injected into a build that does not.
    const injected = process.env['DEVELOCITY_INJECTION_ENABLED'] === 'true'

    if (credentialAlreadySupplied()) {
        core.info('Develocity App: a Develocity access key is already configured, so no OIDC token is minted.')
        return {kind: 'delegated'}
    }

    const serverUrl = core.getInput('develocity-url').trim()
    try {
        // The audience is the Develocity server, matching its workload identity entry -- a
        // different token from the one minted for the App, which has the App's own audience.
        const oidcToken = await mintIdToken(serverUrl)

        const host = new URL(serverUrl).hostname
        const client = new ShortLivedTokenClient(core.getInput('develocity-allow-untrusted-server') === 'true')
        // No permissions and no projectIds are requested, so the token carries exactly what the
        // matching workload identity entry grants. Narrowing here would make this request, rather
        // than the grant, the thing that decides access.
        const token = await client.fetchToken(
            serverUrl,
            {hostname: host, key: oidcToken},
            core.getInput('develocity-token-expiry')
        )

        core.setSecret(token.key)
        // The Gradle plugin requires the host-qualified form and rejects a bare token outright,
        // failing before it even applies.
        core.exportVariable('DEVELOCITY_ACCESS_KEY', `${host}=${token.key}`)

        core.info(`Develocity App: Build Scan publishing configured for project ${projectId ?? '(unknown)'}.`)
        return {kind: 'configured', projectId, injected}
    } catch (error) {
        return {kind: 'failed', reason: error instanceof Error ? error.message : String(error)}
    }
}
