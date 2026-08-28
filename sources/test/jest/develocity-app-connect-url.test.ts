import {describe, expect, it} from '@jest/globals'

import {buildConnectUrl, workflowPathFromRef} from '../../src/develocity-app/connectUrl'

const APP = 'https://app.example.com'

describe('workflowPathFromRef', () => {
    it('extracts the path from a branch ref', () => {
        expect(workflowPathFromRef('owner/repo/.github/workflows/ci.yml@refs/heads/main')).toBe(
            '.github/workflows/ci.yml'
        )
    })

    it('extracts the path when the ref itself contains slashes', () => {
        expect(workflowPathFromRef('owner/repo/.github/workflows/ci.yml@refs/heads/feature/x')).toBe(
            '.github/workflows/ci.yml'
        )
    })

    it('extracts the path from a tag ref', () => {
        expect(workflowPathFromRef('owner/repo/.github/workflows/ci.yml@refs/tags/v1.2.3')).toBe(
            '.github/workflows/ci.yml'
        )
    })

    it('keeps a nested workflow path intact', () => {
        expect(workflowPathFromRef('owner/repo/.github/workflows/nested/build.yml@refs/heads/main')).toBe(
            '.github/workflows/nested/build.yml'
        )
    })

    it('is undefined when the variable is absent', () => {
        expect(workflowPathFromRef(undefined)).toBeUndefined()
        expect(workflowPathFromRef('')).toBeUndefined()
    })

    it('is undefined when the ref is not a workflow path', () => {
        expect(workflowPathFromRef('owner/repo/something/else.yml@refs/heads/main')).toBeUndefined()
    })
})

describe('buildConnectUrl', () => {
    const context = {
        repository: 'develocity-app-2/demo-app',
        repositoryId: '123',
        ownerId: '456',
        workflowRef: 'develocity-app-2/demo-app/.github/workflows/ci.yml@refs/heads/main'
    }

    it('carries the repository, both ids and the workflow', () => {
        expect(buildConnectUrl(APP, context)).toBe(
            `${APP}/start?repo=develocity-app-2%2Fdemo-app&repo_id=123&owner_id=456` +
                '&workflow=.github%2Fworkflows%2Fci.yml'
        )
    })

    it('encodes the slash in owner/repo', () => {
        expect(buildConnectUrl(APP, context)).toContain('repo=develocity-app-2%2Fdemo-app')
        expect(buildConnectUrl(APP, context)).not.toContain('repo=develocity-app-2/demo-app')
    })

    it('omits the workflow when the ref is absent, keeping the rest', () => {
        const url = buildConnectUrl(APP, {...context, workflowRef: undefined})
        expect(url).toBe(`${APP}/start?repo=develocity-app-2%2Fdemo-app&repo_id=123&owner_id=456`)
        expect(url).not.toContain('workflow=')
    })

    it('omits ids that the runner did not provide', () => {
        const url = buildConnectUrl(APP, {...context, repositoryId: undefined, ownerId: undefined})
        expect(url).not.toContain('repo_id=')
        expect(url).not.toContain('owner_id=')
        expect(url).toContain('repo=develocity-app-2%2Fdemo-app')
    })

    it('does not double the slash when the app url has a trailing one', () => {
        expect(buildConnectUrl('https://app.example.com/', context)).toContain('https://app.example.com/start?')
    })
})
