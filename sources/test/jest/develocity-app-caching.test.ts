import {beforeEach, describe, expect, it, jest} from '@jest/globals'

/**
 * The caching gate: which provider a repository gets, and how it is told.
 *
 * Exercised through `CacheConfig.getCacheProvider()` rather than the gate directly, because the
 * point of the change is what upstream's single read site now answers -- `getCacheService` and
 * `getProviderNote` both go through it, in the main step and again in the post step.
 */

const inputs: Record<string, string> = {}
const info = jest.fn()
const warning = jest.fn()
let savedState: Record<string, string> = {}

jest.unstable_mockModule('@actions/core', () => ({
    getInput: (name: string) => inputs[name] ?? '',
    getBooleanInput: () => false,
    getMultilineInput: () => [],
    info,
    debug: jest.fn(),
    warning,
    error: jest.fn(),
    setFailed: jest.fn(),
    setSecret: jest.fn(),
    saveState: (name: string, value: unknown) => {
        savedState[name] = String(value)
    },
    getState: (name: string) => savedState[name] ?? '',
    exportVariable: jest.fn(),
    getIDToken: jest.fn(),
    summary: {addRaw: () => undefined, write: async () => undefined}
}))

const CONNECT_URL = 'https://app.example.com/start?repo=develocity-app-2%2Fdemo-app'

type Feature = {id: string; name: string; enabled: boolean}

const status = (connected: boolean, features: Feature[]) => ({
    repository: 'develocity-app-2/demo-app',
    connected,
    account: 'develocity-app-2',
    connectUrl: CONNECT_URL,
    features
})

const ENTITLED = status(true, [
    {id: 'build-scan-publishing', name: 'Build Scan publishing', enabled: true},
    {id: 'enhanced-caching', name: 'Enhanced GitHub Actions Caching', enabled: true}
])

const FEATURE_OFF = status(true, [
    {id: 'build-scan-publishing', name: 'Build Scan publishing', enabled: true},
    {id: 'enhanced-caching', name: 'Enhanced GitHub Actions Caching', enabled: false}
])

const NOT_CONNECTED = status(false, [
    {id: 'enhanced-caching', name: 'Enhanced GitHub Actions Caching', enabled: true}
])

/**
 * A fresh module graph per case. The gate memoises its message so it is said once per step, and
 * `status.ts` holds the fetched status in memory, so both have to be reset between cases.
 */
async function resolve(provider: string, appStatus?: unknown) {
    jest.resetModules()
    inputs['cache-provider'] = provider

    const {CacheConfig, CacheProvider} = await import('../../src/configuration')
    if (appStatus) {
        const {saveStatus} = await import('../../src/develocity-app/status')
        saveStatus(appStatus as never)
    }

    return {provider: new CacheConfig().getCacheProvider(), CacheProvider}
}

describe('the caching gate', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        savedState = {}
        for (const key of Object.keys(inputs)) delete inputs[key]
    })

    describe('when the workflow says nothing', () => {
        it('unlocks enhanced caching for a connected repository with the feature on', async () => {
            const {provider, CacheProvider} = await resolve('', ENTITLED)

            expect(provider).toBe(CacheProvider.Enhanced)
            expect(info).not.toHaveBeenCalled()
            expect(warning).not.toHaveBeenCalled()
        })

        it('uses basic caching when the feature is off, and says so once', async () => {
            const {provider, CacheProvider} = await resolve('', FEATURE_OFF)

            expect(provider).toBe(CacheProvider.Basic)
            expect(info).toHaveBeenCalledTimes(1)
            expect(warning).not.toHaveBeenCalled()
        })

        it('uses basic caching when the repository is not connected', async () => {
            const {provider, CacheProvider} = await resolve('', NOT_CONNECTED)

            expect(provider).toBe(CacheProvider.Basic)
        })

        // No develocity-url, no id-token: write, a downed tunnel, a 401, a timeout -- one bucket.
        it('uses basic caching when there is no status at all', async () => {
            const {provider, CacheProvider} = await resolve('')

            expect(provider).toBe(CacheProvider.Basic)
        })
    })

    describe("when the workflow asks for 'enhanced'", () => {
        it('gives it to an entitled repository, silently', async () => {
            const {provider, CacheProvider} = await resolve('enhanced', ENTITLED)

            expect(provider).toBe(CacheProvider.Enhanced)
            expect(warning).not.toHaveBeenCalled()
        })

        // The whole reason the default had to become empty: this case and the unset one differ
        // only in that somebody asked out loud, and deserves to be told they did not get it.
        it('warns rather than failing, and falls back to basic', async () => {
            const {provider, CacheProvider} = await resolve('enhanced', FEATURE_OFF)

            expect(provider).toBe(CacheProvider.Basic)
            expect(warning).toHaveBeenCalledTimes(1)
            expect(warning.mock.calls[0][0]).toContain(CONNECT_URL)
            expect(info).not.toHaveBeenCalled()
        })

        it('warns without a connect link when there is no status to take one from', async () => {
            const {provider, CacheProvider} = await resolve('enhanced')

            expect(provider).toBe(CacheProvider.Basic)
            expect(warning).toHaveBeenCalledTimes(1)
        })
    })

    describe('the explicit values the gate never touches', () => {
        it("honours 'basic' even where enhanced caching was unlocked", async () => {
            const {provider, CacheProvider} = await resolve('basic', ENTITLED)

            expect(provider).toBe(CacheProvider.Basic)
            expect(info).not.toHaveBeenCalled()
            expect(warning).not.toHaveBeenCalled()
        })

        it("honours 'external' whatever the repository is entitled to", async () => {
            expect((await resolve('external', ENTITLED)).provider).toBe('external')
            expect((await resolve('external', FEATURE_OFF)).provider).toBe('external')
            expect((await resolve('external')).provider).toBe('external')
        })

        it('still rejects a value that is not a provider at all', async () => {
            jest.resetModules()
            inputs['cache-provider'] = 'turbo'
            const {CacheConfig} = await import('../../src/configuration')

            expect(() => new CacheConfig().getCacheProvider()).toThrow(TypeError)
        })
    })

    /**
     * The post step is a separate process: the in-memory copy is gone and only `STATE_*` survives.
     * If it resolved differently from the main step, the job would restore with one provider and
     * save with another, and nothing would report it.
     */
    describe('across the main and post steps', () => {
        it('resolves in the post step exactly as it did in the main step', async () => {
            const main = await resolve('', ENTITLED)
            expect(main.provider).toBe(main.CacheProvider.Enhanced)

            // A new module graph with no in-memory status, reading only what the main step saved.
            jest.resetModules()
            const {CacheConfig, CacheProvider} = await import('../../src/configuration')

            expect(new CacheConfig().getCacheProvider()).toBe(CacheProvider.Enhanced)
        })

        it('carries a downgrade across too, rather than saving with a provider it did not restore with', async () => {
            await resolve('', FEATURE_OFF)

            jest.resetModules()
            const {CacheConfig, CacheProvider} = await import('../../src/configuration')

            expect(new CacheConfig().getCacheProvider()).toBe(CacheProvider.Basic)
        })
    })

    it('says it once, however many times the provider is read in a step', async () => {
        jest.resetModules()
        inputs['cache-provider'] = 'enhanced'
        const {CacheConfig} = await import('../../src/configuration')
        const config = new CacheConfig()

        // getCacheService reads it twice and getProviderNote twice again.
        config.getCacheProvider()
        config.getCacheProvider()
        config.getCacheProvider()
        config.getCacheProvider()

        expect(warning).toHaveBeenCalledTimes(1)
    })
})
