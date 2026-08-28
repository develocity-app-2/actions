/**
 * Asking the Develocity GitHub App what this repository's status is.
 */

/** One feature as the App reports it. The action holds no catalogue of its own. */
export interface Feature {
    id: string
    name: string
    enabled: boolean
}

/**
 * The App's answer. `account` is null when the App is not installed at all, and `connected` is
 * true only when it is installed *and* enabled for this repository.
 *
 * `features` is optional: a response without it degrades to a plain connected summary rather than
 * failing, so adding a feature stays a one-entry change in the App and no change here.
 */
export interface RepoStatus {
    repository: string
    connected: boolean
    account: string | null
    connectUrl?: string
    features?: Feature[]
}

export type StatusResult = {ok: true; status: RepoStatus} | {ok: false; reason: string}

/** Both the token mint and this call get the same budget. */
export const TIMEOUT_MS = 10000

/**
 * `GET {appUrl}/api/repo-status` with the OIDC token as a bearer.
 *
 * No parameters: the App derives the repository from the verified claims, so there is nothing to
 * send and nothing a caller could spoof.
 *
 * Every failure -- a timeout, a downed tunnel, a 401 rejecting the token, a non-2xx, a body that
 * is not the expected shape -- comes back as `ok: false` with a reason to log. None of them is
 * worth failing a build over.
 */
export async function fetchRepoStatus(appUrl: string, token: string): Promise<StatusResult> {
    const url = `${appUrl.replace(/\/+$/, '')}/api/repo-status`

    try {
        const response = await fetch(url, {
            headers: {Authorization: `Bearer ${token}`},
            signal: AbortSignal.timeout(TIMEOUT_MS)
        })

        if (!response.ok) {
            return {ok: false, reason: `${url} answered ${response.status}`}
        }

        const body = (await response.json()) as unknown
        if (!isRepoStatus(body)) {
            return {ok: false, reason: `${url} answered with an unexpected body`}
        }

        return {ok: true, status: body}
    } catch (error) {
        return {ok: false, reason: error instanceof Error ? error.message : String(error)}
    }
}

/**
 * Only the fields this action depends on are checked. `features` is not among them -- its absence
 * is a supported response, not a malformed one.
 */
function isRepoStatus(body: unknown): body is RepoStatus {
    if (typeof body !== 'object' || body === null) return false
    const candidate = body as Record<string, unknown>
    return typeof candidate['repository'] === 'string' && typeof candidate['connected'] === 'boolean'
}
