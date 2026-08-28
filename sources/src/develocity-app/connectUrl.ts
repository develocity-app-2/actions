/**
 * Building the connect call-to-action without contacting anything.
 *
 * This is the demo's cold-start path. A job that granted nothing -- no `develocity-url`, no
 * `id-token: write` -- still has to render a link that identifies this repository and this
 * workflow, because that is precisely the job the App needs to offer to fix. `GITHUB_WORKFLOW_REF`
 * and the `GITHUB_REPOSITORY*` variables are available whatever the workflow's permissions are,
 * unlike the OIDC claims, which is what makes that possible.
 *
 * Deliberately free of I/O so it is unit-testable without a runner.
 */

/** Everything the local fallback URL is built from, read from the environment by the caller. */
export interface RepoContext {
    repository: string | undefined
    repositoryId: string | undefined
    ownerId: string | undefined
    workflowRef: string | undefined
}

/**
 * `owner/repo/.github/workflows/ci.yml@refs/heads/main` -> `.github/workflows/ci.yml`.
 *
 * The `@ref` suffix is stripped from the last `@` rather than the first, so a ref containing
 * slashes (`refs/heads/feature/x`) or a tag ref is handled; the path is then anchored on
 * `.github/workflows/`, which is where a workflow file always lives, rather than on counting
 * leading segments.
 */
export function workflowPathFromRef(workflowRef: string | undefined): string | undefined {
    if (!workflowRef) return undefined

    const separator = workflowRef.lastIndexOf('@')
    const withoutRef = separator === -1 ? workflowRef : workflowRef.slice(0, separator)

    const match = withoutRef.match(/(\.github\/workflows\/.+)$/)
    return match ? match[1] : undefined
}

/**
 * The connect URL to use when the App has not supplied one -- only in *Not opted in* and
 * *Unreachable*. Every other state uses the URL the App returned, built from claims it verified.
 *
 * `repo_id` and `owner_id` travel because pre-selecting the repository on GitHub's install screen
 * requires its numeric id, and a private repository's id cannot be read before the App is
 * installed on it.
 */
export function buildConnectUrl(appUrl: string, context: RepoContext): string {
    const workflow = workflowPathFromRef(context.workflowRef)

    const params: string[] = []
    const add = (name: string, value: string | undefined): void => {
        if (value) params.push(`${name}=${encodeURIComponent(value)}`)
    }

    add('repo', context.repository)
    add('repo_id', context.repositoryId)
    add('owner_id', context.ownerId)
    add('workflow', workflow)

    const base = `${appUrl.replace(/\/+$/, '')}/start`
    return params.length > 0 ? `${base}?${params.join('&')}` : base
}

/** The context as this runner reports it. The one place this module reads the environment. */
export function contextFromEnvironment(): RepoContext {
    return {
        repository: process.env['GITHUB_REPOSITORY'],
        repositoryId: process.env['GITHUB_REPOSITORY_ID'],
        ownerId: process.env['GITHUB_REPOSITORY_OWNER_ID'],
        workflowRef: process.env['GITHUB_WORKFLOW_REF']
    }
}
