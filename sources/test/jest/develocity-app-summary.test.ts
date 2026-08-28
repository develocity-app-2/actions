import {describe, expect, it} from '@jest/globals'

import type {RepoStatus} from '../../src/develocity-app/client'
import {connectPrompt, connectedSummary, unreachableSummary} from '../../src/develocity-app/summary'

const REPO = 'develocity-app-2/demo-app'
const CONNECT_URL = 'https://app.example.com/start?repo=develocity-app-2%2Fdemo-app'

const connected: RepoStatus = {
    repository: REPO,
    connected: true,
    account: 'develocity-app-2',
    connectUrl: CONNECT_URL,
    features: [
        {id: 'build-scans', name: 'Build Scans', enabled: true},
        {id: 'enhanced-caching', name: 'Enhanced caching', enabled: false}
    ]
}

describe('connected summary', () => {
    it('names the account and links to Manage features', () => {
        const summary = connectedSummary(connected, CONNECT_URL)

        expect(summary).toContain('connected to Develocity via `develocity-app-2`')
        expect(summary).toContain(`[Manage features →](${CONNECT_URL})`)
    })

    it('renders each feature as the App sent it, enabled or not', () => {
        const summary = connectedSummary(connected, CONNECT_URL)

        expect(summary).toContain('| Build Scans | Enabled |')
        expect(summary).toContain('| Enhanced caching | Not enabled |')
    })

    it('degrades to a plain connected summary when the App sends no features', () => {
        const summary = connectedSummary({...connected, features: undefined}, CONNECT_URL)

        expect(summary).toContain('connected to Develocity via `develocity-app-2`')
        expect(summary).toContain('[Manage features →]')
        expect(summary).not.toContain('| Feature | Status |')
    })

    it('degrades the same way for an empty feature list', () => {
        const summary = connectedSummary({...connected, features: []}, CONNECT_URL)

        expect(summary).not.toContain('| Feature | Status |')
    })
})

describe('connect prompt', () => {
    // *Not configured* and *Not opted in* render this, differing only in where the URL came from.
    it('carries one call to action, pointing at the supplied url', () => {
        const summary = connectPrompt(REPO, CONNECT_URL)

        expect(summary).toContain(`**[Connect \`${REPO}\` to Develocity →](${CONNECT_URL})**`)
        expect(summary.match(/Connect `.*` to Develocity/g)).toHaveLength(1)
    })

    it('does not explain how to edit the workflow', () => {
        const summary = connectPrompt(REPO, CONNECT_URL)

        expect(summary).not.toContain('id-token')
        expect(summary).not.toContain('permissions:')
    })
})

describe('unreachable summary', () => {
    it('says nothing is known, and still offers the way in', () => {
        const summary = unreachableSummary(REPO, CONNECT_URL)

        expect(summary).toContain('Develocity could not be reached')
        expect(summary).toContain(`**[Connect \`${REPO}\` to Develocity →](${CONNECT_URL})**`)
    })

    it('claims nothing about whether the repository is connected', () => {
        expect(unreachableSummary(REPO, CONNECT_URL)).not.toContain('connected to Develocity via')
    })
})
