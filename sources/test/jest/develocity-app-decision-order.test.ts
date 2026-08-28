import {beforeEach, describe, expect, it, jest} from '@jest/globals'

/**
 * The decision order of the App integration: what gets contacted, and what does not.
 *
 * The token mint itself is deliberately not tested -- it needs a live runner, and a mocked
 * `getIDToken` would only test the mock. What is tested here is that it is never *reached*.
 */

const inputs: Record<string, string> = {}
const summaryWrites: string[] = []

const getIDToken = jest.fn(async (_audience?: string): Promise<string> => 'a.token.value')
const setSecret = jest.fn()
const warning = jest.fn()

jest.unstable_mockModule('@actions/core', () => ({
    getInput: (name: string) => inputs[name] ?? '',
    info: jest.fn(),
    warning,
    setSecret,
    saveState: jest.fn(),
    getIDToken,
    summary: {
        addRaw: (text: string) => {
            summaryWrites.push(text)
            return this
        },
        write: async () => undefined
    }
}))

const APP_URL = 'https://app.example.com'
const WORKFLOW_REF = 'develocity-app-2/demo-app/.github/workflows/ci.yml@refs/heads/main'

async function runIntegration(): Promise<void> {
    const {reportDevelocityAppStatus} = await import('../../src/develocity-app/index')
    await reportDevelocityAppStatus()
}

describe('the decision order', () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>

    beforeEach(() => {
        jest.clearAllMocks()
        summaryWrites.length = 0
        for (const key of Object.keys(inputs)) delete inputs[key]

        inputs['develocity-app-url'] = APP_URL

        process.env['GITHUB_REPOSITORY'] = 'develocity-app-2/demo-app'
        process.env['GITHUB_REPOSITORY_ID'] = '123'
        process.env['GITHUB_REPOSITORY_OWNER_ID'] = '456'
        process.env['GITHUB_WORKFLOW_REF'] = WORKFLOW_REF
        delete process.env['ACTIONS_ID_TOKEN_REQUEST_URL']
        delete process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']

        fetchSpy = jest.spyOn(globalThis, 'fetch')
    })

    it('mints nothing and calls nothing when develocity-url is absent', async () => {
        process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://runner.example.com/token?api-version=1'
        process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'runner-token'

        await runIntegration()

        // Short-circuits before the environment is even consulted: OIDC is available here.
        expect(getIDToken).not.toHaveBeenCalled()
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(summaryWrites.join()).toContain('Connect `develocity-app-2/demo-app` to Develocity')
    })

    it('mints nothing and calls nothing when id-token: write was not granted', async () => {
        inputs['develocity-url'] = 'https://develocity.example.com'

        await runIntegration()

        expect(getIDToken).not.toHaveBeenCalled()
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(summaryWrites.join()).toContain('Connect `develocity-app-2/demo-app` to Develocity')
    })

    it('builds the call to action from the environment when nothing was granted', async () => {
        await runIntegration()

        expect(summaryWrites.join()).toContain(
            `${APP_URL}/start?repo=develocity-app-2%2Fdemo-app&repo_id=123&owner_id=456` +
                '&workflow=.github%2Fworkflows%2Fci.yml'
        )
    })

    it('renders Unreachable and warns, rather than failing, when the App cannot be reached', async () => {
        inputs['develocity-url'] = 'https://develocity.example.com'
        process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://runner.example.com/token?api-version=1'
        process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'runner-token'
        fetchSpy.mockRejectedValue(new Error('tunnel is down'))

        await runIntegration()

        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(summaryWrites.join()).toContain('Develocity could not be reached')
        expect(warning).toHaveBeenCalled()
    })

    it('masks the minted token before it can reach a log', async () => {
        inputs['develocity-url'] = 'https://develocity.example.com'
        process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://runner.example.com/token?api-version=1'
        process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'runner-token'
        fetchSpy.mockRejectedValue(new Error('tunnel is down'))

        await runIntegration()

        expect(setSecret).toHaveBeenCalledWith('a.token.value')
    })

    it('requests the app url as the audience unless one is given', async () => {
        inputs['develocity-url'] = 'https://develocity.example.com'
        process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://runner.example.com/token?api-version=1'
        process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'runner-token'
        fetchSpy.mockRejectedValue(new Error('tunnel is down'))

        await runIntegration()
        expect(getIDToken).toHaveBeenCalledWith(APP_URL)

        jest.clearAllMocks()
        inputs['develocity-app-audience'] = 'https://audience.example.com'
        await runIntegration()
        expect(getIDToken).toHaveBeenCalledWith('https://audience.example.com')
    })
})
