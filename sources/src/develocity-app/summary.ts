import type {Feature, RepoStatus} from './client'
import {ENHANCED_CACHING} from './caching'
import type {PublishOutcome} from './publish'

/**
 * Rendering the four states into the Job Summary.
 *
 * Deliberately free of I/O -- no network, no environment reads -- so every state is unit-testable
 * without a runner. The caller decides which state applies and supplies the URL.
 */

/**
 * The App sends display names alongside ids, so this renders whatever it is given and needs no
 * list of its own. A response with no features at all degrades to a plain connected summary
 * rather than an empty table.
 */
function featureTable(features: Feature[] | undefined): string {
    if (!Array.isArray(features) || features.length === 0) return ''

    const rows = features
        .map(feature => `| ${feature.name} | ${feature.enabled ? 'Enabled' : 'Not enabled'} |`)
        .join('\n')

    return `
| Feature | Status |
| --- | --- |
${rows}
`
}

/**
 * Why this job's caching report says *Basic*, when the feature is what decides it.
 *
 * Upstream's caching report is written by the post step and explains a basic provider in upstream's
 * terms -- "consider switching to Enhanced". On a connected repository that advice is wrong: the
 * lever is the feature, not the input. Said here rather than by editing `caching-report.ts`, which
 * is upstream's file and staying out of it is what lets the fork take upstream changes.
 *
 * Only for a *connected* repository. An unconnected one is already told, once, by the call to
 * action, and repeating it per feature is what "one CTA, not one per feature" rules out.
 */
function cachingNote(features: Feature[] | undefined): string {
    if (!Array.isArray(features)) return ''

    const caching = features.find(feature => feature.id === ENHANCED_CACHING)
    if (!caching || caching.enabled) return ''

    return `\nGradle State Caching uses the basic provider: **${caching.name}** is not enabled for this repository.\n`
}

/** *Connected*: the App answered, and this repository is installed and enabled. */
export function connectedSummary(status: RepoStatus, manageUrl: string): string {
    return `
### Develocity

This build is connected to Develocity via \`${status.account}\`.
${featureTable(status.features)}${cachingNote(status.features)}
[Manage features →](${manageUrl})
`
}

/**
 * *Not configured* and *Not opted in* share this. They differ only in where the link came from --
 * the App's answer, or built locally -- and not in what the reader should do about it.
 *
 * One call to action, not one per feature. It deliberately does not explain how to fix the
 * workflow: the link leads to a dialog that opens a pull request making the change, which is a
 * better answer than a snippet to copy.
 */
export function connectPrompt(repository: string, connectUrl: string): string {
    return `
### Your build could be better and faster with Develocity

This build ran without connecting to Develocity, missing out on build scans, failure analytics and enhanced caching.

**[Connect \`${repository}\` to Develocity →](${connectUrl})**
`
}

/**
 * *Unreachable*: something failed between here and the App. What is honest to say is that nothing
 * is known -- so this states that, and still offers the way in.
 */
export function unreachableSummary(repository: string, connectUrl: string): string {
    return `
### Develocity could not be reached

This build could not contact Develocity to check this repository's status, so it ran on the terms an unconnected repository gets.

**[Connect \`${repository}\` to Develocity →](${connectUrl})**
`
}

/**
 * What became of Build Scan publishing, appended after the status block.
 *
 * "Enabled" and "actually configured" are different things once publishing is real, and the gap
 * between them is where every credential failure lands. A refused or unattempted publish does not
 * fail the build -- the Develocity plugin warns and the build still succeeds -- so without a line
 * saying publishing was expected and did not happen, the only evidence is a scan that never appears.
 */
export function publishSummary(outcome: PublishOutcome): string {
    switch (outcome.kind) {
        case 'not-enabled':
            return ''
        case 'configured':
            return outcome.injected
                ? `\nBuild Scans publish to project \`${outcome.projectId ?? 'unknown'}\`.\n`
                : `\nA Develocity credential is configured for project \`${outcome.projectId ?? 'unknown'}\`, but ` +
                      'Develocity injection is disabled by this workflow, so only a build that applies the ' +
                      'Develocity plugin itself will publish.\n'
        case 'delegated':
            return '\nBuild Scans publish using the Develocity access key this workflow supplied.\n'
        case 'failed':
            return (
                '\n**Build Scan publishing is enabled for this repository, but could not be configured.**\n' +
                `This build will not publish. ${outcome.reason}\n`
            )
    }
}
