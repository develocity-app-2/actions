import {beforeEach, describe, expect, it, jest} from '@jest/globals'

/**
 * The precedence rule: the App's features default Develocity injection, and never override what the
 * workflow asked for. By the time this runs, upstream's `buildScan.setup` has already exported the
 * action's inputs, so "the workflow set the input" and "the variable is set" are the same condition.
 */

const inputs: Record<string, string> = {}
const getIDToken = jest.fn(async (_audience?: string): Promise<string> => 'oidc.token.value')
const setSecret = jest.fn()
const exported: Record<string, string> = {}

jest.unstable_mockModule('@actions/core', () => ({
    getInput: (name: string) => inputs[name] ?? '',
    info: jest.fn(),
    warning: jest.fn(),
    setSecret,
    saveState: jest.fn(),
    getState: jest.fn(),
    getIDToken,
    exportVariable: (name: string, value: string) => {
        exported[name] = value
        process.env[name] = value
    },
    summary: {addRaw: () => undefined, write: async () => undefined}
}))

const fetchToken = jest.fn(async (): Promise<{hostname: string; key: string}> => ({
    hostname: 'develocity.example.com',
    key: 'short.lived.token'
}))

jest.unstable_mockModule('../../src/develocity/short-lived-token', () => ({
    ShortLivedTokenClient: class {
        fetchToken = fetchToken
    }
}))

const SERVER = 'https://develocity.example.com'

const status = (enabled: boolean) => ({
    repository: 'develocity-app-2/demo-app',
    connected: true,
    account: 'develocity-app-2',
    features: [
        {id: 'build-scan-publishing', name: 'Build Scan publishing', enabled},
        {id: 'enhanced-caching', name: 'Enhanced GitHub Actions Caching', enabled: true}
    ]
})

async function configure(s = status(true)) {
    const {configurePublishing} = await import('../../src/develocity-app/publish')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await configurePublishing(s as any)
}

const INJECTION_VARS = [
    'DEVELOCITY_INJECTION_ENABLED',
    'DEVELOCITY_INJECTION_PROJECT_ID',
    'DEVELOCITY_INJECTION_DEVELOCITY_PLUGIN_VERSION',
    'DEVELOCITY_ACCESS_KEY',
    'GRADLE_ENTERPRISE_ACCESS_KEY'
]

describe('build scan publishing', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        for (const key of Object.keys(inputs)) delete inputs[key]
        for (const key of Object.keys(exported)) delete exported[key]
        for (const name of INJECTION_VARS) delete process.env[name]

        inputs['develocity-url'] = SERVER
        process.env['GITHUB_REPOSITORY_ID'] = '1335548142'
    })

    it('does nothing at all when the feature is not enabled', async () => {
        const outcome = await configure(status(false))

        expect(outcome.kind).toBe('not-enabled')
        expect(getIDToken).not.toHaveBeenCalled()
        expect(fetchToken).not.toHaveBeenCalled()
        expect(exported).toEqual({})
    })

    it('defaults injection on and the project id to the repository id', async () => {
        await configure()

        expect(exported['DEVELOCITY_INJECTION_ENABLED']).toBe('true')
        expect(exported['DEVELOCITY_INJECTION_PROJECT_ID']).toBe('1335548142')
    })

    // Without a plugin version the init script applies no plugin at all, and does so silently:
    // the build succeeds, publishes nothing, and logs neither an error nor a denial.
    it('defaults the plugin version, without which injection is inert', async () => {
        await configure()

        expect(exported['DEVELOCITY_INJECTION_DEVELOCITY_PLUGIN_VERSION']).toBe('4.5.0')
    })

    it('leaves a plugin version the workflow chose', async () => {
        process.env['DEVELOCITY_INJECTION_DEVELOCITY_PLUGIN_VERSION'] = '3.19'

        await configure()

        expect(exported['DEVELOCITY_INJECTION_DEVELOCITY_PLUGIN_VERSION']).toBeUndefined()
        expect(process.env['DEVELOCITY_INJECTION_DEVELOCITY_PLUGIN_VERSION']).toBe('3.19')
    })

    it('leaves an injection setting the workflow already made', async () => {
        // `develocity-injection-enabled: false` reaches here as the string 'false' -- present, and
        // therefore honoured. This is the row most likely to regress.
        process.env['DEVELOCITY_INJECTION_ENABLED'] = 'false'
        process.env['DEVELOCITY_INJECTION_PROJECT_ID'] = 'chosen-by-the-workflow'

        await configure()

        expect(exported['DEVELOCITY_INJECTION_ENABLED']).toBeUndefined()
        expect(exported['DEVELOCITY_INJECTION_PROJECT_ID']).toBeUndefined()
        expect(process.env['DEVELOCITY_INJECTION_ENABLED']).toBe('false')
        expect(process.env['DEVELOCITY_INJECTION_PROJECT_ID']).toBe('chosen-by-the-workflow')
    })

    it('reports the project the build will actually use, not the one it would have chosen', async () => {
        process.env['DEVELOCITY_INJECTION_PROJECT_ID'] = 'chosen-by-the-workflow'

        const outcome = await configure()

        expect(outcome).toEqual({kind: 'configured', projectId: 'chosen-by-the-workflow', injected: true})
    })

    it('exchanges an OIDC token for the Develocity server, host-qualified and masked', async () => {
        const outcome = await configure()

        expect(getIDToken).toHaveBeenCalledWith(SERVER)
        expect(outcome).toEqual({kind: 'configured', projectId: '1335548142', injected: true})
        expect(exported['DEVELOCITY_ACCESS_KEY']).toBe('develocity.example.com=short.lived.token')
        expect(setSecret).toHaveBeenCalledWith('short.lived.token')
    })

    it('defers to an access key already supplied, minting nothing', async () => {
        process.env['DEVELOCITY_ACCESS_KEY'] = 'develocity.example.com=supplied'

        const outcome = await configure()

        expect(outcome.kind).toBe('delegated')
        expect(getIDToken).not.toHaveBeenCalled()
        expect(fetchToken).not.toHaveBeenCalled()
        // Upstream's exchange owns this value; nothing here may overwrite it.
        expect(process.env['DEVELOCITY_ACCESS_KEY']).toBe('develocity.example.com=supplied')
    })

    it('defers to a Gradle Enterprise access key too', async () => {
        process.env['GRADLE_ENTERPRISE_ACCESS_KEY'] = 'develocity.example.com=supplied'

        expect((await configure()).kind).toBe('delegated')
        expect(getIDToken).not.toHaveBeenCalled()
    })

    it('still configures injection when the credential is supplied', async () => {
        process.env['DEVELOCITY_ACCESS_KEY'] = 'develocity.example.com=supplied'

        await configure()

        // The project id is needed whichever credential publishes.
        expect(exported['DEVELOCITY_INJECTION_PROJECT_ID']).toBe('1335548142')
    })

    it('does not claim a build will publish when the workflow disabled injection', async () => {
        process.env['DEVELOCITY_INJECTION_ENABLED'] = 'false'

        const outcome = await configure()

        expect(outcome).toEqual({kind: 'configured', projectId: '1335548142', injected: false})
    })

    it('reports a failed exchange rather than throwing', async () => {
        fetchToken.mockRejectedValueOnce(new Error('401 from /api/auth/token'))

        const outcome = await configure()

        expect(outcome.kind).toBe('failed')
        expect(outcome).toHaveProperty('reason', '401 from /api/auth/token')
        expect(exported['DEVELOCITY_ACCESS_KEY']).toBeUndefined()
    })
})

/**
 * The handoff between the two halves of the module, which is easy to get wrong in a way no unit
 * test of either half would catch: `core.saveState` is a main-to-post-step channel, so reading the
 * status back with `getState` inside the same step silently yields nothing and publishing is
 * skipped with no error anywhere.
 */
describe('the status handoff within one step', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        for (const key of Object.keys(inputs)) delete inputs[key]
        for (const key of Object.keys(exported)) delete exported[key]
        for (const name of INJECTION_VARS) delete process.env[name]

        inputs['develocity-url'] = SERVER
        inputs['develocity-app-url'] = 'https://app.example.com'
        process.env['GITHUB_REPOSITORY_ID'] = '1335548142'
        process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://runner.example.com/token?api-version=1'
        process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'runner-token'
    })

    it('acts on the status the reporting half fetched', async () => {
        jest.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify(status(true)), {status: 200})
        )

        const app = await import('../../src/develocity-app/index')
        await app.reportDevelocityAppStatus()
        await app.configureDevelocityAppFeatures()

        expect(exported['DEVELOCITY_INJECTION_ENABLED']).toBe('true')
        expect(exported['DEVELOCITY_INJECTION_PROJECT_ID']).toBe('1335548142')
        expect(exported['DEVELOCITY_ACCESS_KEY']).toBe('develocity.example.com=short.lived.token')
    })
})
