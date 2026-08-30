import {beforeEach, describe, expect, it, jest} from '@jest/globals'

/**
 * What the action sends, and — mostly — what it declines to send. It knows two things the App
 * cannot: that this job's build failed, and which Build Scans it published. Everything else the App
 * derives from the OIDC claims, so anything more sent from here would be unverifiable.
 */

const inputs: Record<string, string> = {}
const state: Record<string, string> = {}
const warning = jest.fn()
const summaryLines: string[] = []

jest.unstable_mockModule('@actions/core', () => ({
    getInput: (name: string) => inputs[name] ?? '',
    info: jest.fn(),
    warning,
    saveState: (name: string, value: unknown) => {
        state[name] = String(value)
    },
    getState: (name: string) => state[name] ?? '',
    getIDToken: async () => 'oidc.token.value',
    exportVariable: jest.fn(),
    setSecret: jest.fn(),
    summary: {
        addRaw: (line: string) => {
            summaryLines.push(line)
        },
        write: async () => undefined
    }
}))

interface FakeResult {
    buildFailed: boolean
    buildScanUri: string
}

let results: FakeResult[] = []

jest.unstable_mockModule('../../src/build-results', () => ({
    loadBuildResults: () => results
}))

const SCAN = 'https://develocity.example.com/s/abc123xyz'

const status = (enabled: boolean) => ({
    repository: 'develocity-app-2/demo-app',
    connected: true,
    account: 'develocity-app-2',
    features: [{id: 'test-failure-analytics', name: 'Test failure analytics', enabled}]
})

let fetchMock: jest.Mock

async function report(s: unknown = status(true)): Promise<void> {
    const {saveStatus} = await import('../../src/develocity-app/status')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveStatus(s as any)
    const {reportBuildFailures} = await import('../../src/develocity-app/failure-report')
    await reportBuildFailures()
}

function bodyOf(call: unknown[]): {buildScanIds: string[]} {
    return JSON.parse((call[1] as {body: string}).body)
}

describe('reportBuildFailures', () => {
    beforeEach(() => {
        jest.resetModules()
        for (const key of Object.keys(inputs)) delete inputs[key]
        for (const key of Object.keys(state)) delete state[key]
        warning.mockClear()
        summaryLines.length = 0

        inputs['develocity-app-url'] = 'https://app.example.com'
        process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://token.example.com'
        process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'request-token'

        results = [{buildFailed: true, buildScanUri: SCAN}]

        fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({reported: true})
        }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        globalThis.fetch = fetchMock as any
    })

    it('sends the failed build’s scan id, and only its id', async () => {
        await report()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, {method: string}]
        expect(url).toBe('https://app.example.com/api/build-failures')
        expect(init.method).toBe('POST')
        // Not the URL, and nothing identifying the repository or the pull request:
        // the App reads all of that from the verified claims.
        expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({buildScanIds: ['abc123xyz']})
    })

    it('accounts for itself in the Job Summary, and never silently', async () => {
        await report()

        // Also the regression guard for the summary path throwing: a broken writer
        // is swallowed by the outer catch, so asserting only on the POST would let
        // it fail unnoticed on every run.
        expect(warning).not.toHaveBeenCalled()
        expect(summaryLines.join('')).toContain('failure summary added to the pull request')
    })

    it('says in the Job Summary why nothing was posted', async () => {
        fetchMock.mockImplementation((async () => ({
            ok: true,
            status: 200,
            json: async () => ({reported: false, reason: 'not a pull request run'})
        })) as never)

        await report()

        expect(warning).not.toHaveBeenCalled()
        expect(summaryLines.join('')).toContain('not a pull request run')
    })

    it('says nothing when the feature is off', async () => {
        await report(status(false))
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('says nothing about a build that passed', async () => {
        results = [{buildFailed: false, buildScanUri: SCAN}]
        await report()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('says nothing when the failed build published no scan', async () => {
        results = [{buildFailed: true, buildScanUri: ''}]
        await report()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports once per job, however many post steps run', async () => {
        await report()
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // A job using both setup-gradle and dependency-submission has two post steps.
        const {reportBuildFailures} = await import('../../src/develocity-app/failure-report')
        await reportBuildFailures()
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('warns rather than throwing when the App cannot be reached', async () => {
        fetchMock.mockImplementation(async () => {
            throw new Error('tunnel is down')
        })

        await expect(report()).resolves.toBeUndefined()
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('tunnel is down'))
    })

    it('warns rather than throwing when the App refuses', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetchMock.mockImplementation((async () => ({ok: false, status: 502})) as any)

        await expect(report()).resolves.toBeUndefined()
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('502'))
    })
})
