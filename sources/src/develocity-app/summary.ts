import type {Feature, RepoStatus} from './client'
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

/** *Connected*: the App answered, and this repository is installed and enabled. */
export function connectedSummary(status: RepoStatus, manageUrl: string): string {
    return `
### Develocity

This build is connected to Develocity via \`${status.account}\`.
${featureTable(status.features)}
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

This build ran \`setup-gradle\` without connecting to Develocity, missing out on build scans, failure analytics and enhanced caching.

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

\`setup-gradle\` could not contact Develocity to check this repository's status.

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
            return `\nBuild Scans publish to project \`${outcome.projectId ?? 'unknown'}\`.\n`
        case 'delegated':
            return '\nBuild Scans publish using the Develocity access key this workflow supplied.\n'
        case 'failed':
            return (
                '\n**Build Scan publishing is enabled for this repository, but could not be configured.**\n' +
                `This build will not publish. ${outcome.reason}\n`
            )
    }
}
