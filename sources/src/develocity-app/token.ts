import * as core from '@actions/core'
import {TIMEOUT_MS} from './client'

/**
 * Minting the GitHub Actions OIDC token the App uses to identify this repository.
 */

/**
 * Whether the runner can mint a token at all.
 *
 * Both variables are absent unless the workflow granted `id-token: write`, so their absence is how
 * the runner expresses that it did not. They are tested directly rather than by catching a throw
 * from `core.getIDToken`, because "the workflow granted nothing" and "minting failed" need
 * different summaries and different log lines.
 */
export function oidcAvailable(): boolean {
    return Boolean(process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] && process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'])
}

/**
 * Mint a token for `audience`, masked before it can reach a log.
 *
 * `core.getIDToken` has no timeout of its own, so it is raced against one: a runner that never
 * answers must not hold the build open.
 */
export async function mintIdToken(audience: string): Promise<string> {
    let timer: NodeJS.Timeout | undefined

    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Timed out after ${TIMEOUT_MS}ms requesting an OIDC token`)),
            TIMEOUT_MS
        )
    })

    try {
        const token = await Promise.race([core.getIDToken(audience), timeout])
        core.setSecret(token)
        return token
    } finally {
        if (timer) clearTimeout(timer)
    }
}
