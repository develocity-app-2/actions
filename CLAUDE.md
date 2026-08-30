# Workspace Instructions

## Vendored Library Flow

This repository uses a proprietary caching library: `gradle-actions-caching`.

- The vendored copy lives at `sources/vendor/gradle-actions-caching`
- The source code is at `../actions-caching` and https://github.com/gradle/actions-caching

When a task involves building, updating, validating, or testing the vendored `gradle-actions-caching` library, use this sequence:

1. Run `npm run build` in `actions-caching`.
2. Copy (overwrite) the contents of `actions-caching/dist/` onto `sources/vendor/gradle-actions-caching/`. (No need to rm the existing contents)
3. Then continue with any build, test, or validation steps in this repository.

Do not treat `actions/sources/vendor/gradle-actions-caching` as the source of truth. The source of truth is `actions-caching`, and the vendor directory must be refreshed from its `dist/` output after rebuilding.

## Building

Before running any build or npm commands, initialize the PATH:

```sh
source ~/.zshrc
```

To build this repository, run the `build` script at the root of that repository with no arguments:

```sh
./build
```

## dist directory

Never hand-edit `dist/` — it is generated. But it **is** committed here, by hand, in the same commit
as the sources it was built from.

`setup-gradle/action.yml` runs `../dist/setup-gradle/{main,post}/index.js`, so the committed `dist/`
is exactly what a consumer of `develocity-app-2/actions/setup-gradle@main` executes. `sources/dist/`
is gitignored and never leaves the machine, so `npm run build` alone changes nothing a workflow can
see.

Upstream has a CI workflow that refreshes `dist/` on push, which is why the habit of leaving it to CI
exists. **It does not run in this fork:** `.github/workflows/ci-update-dist.yml` is guarded by
`if: github.repository == 'gradle/actions'`.

So, for any change that has to reach a workflow:

```sh
./build dist     # clean install, build, then copy sources/dist over dist
git add dist sources
```

Committing sources without `dist/` leaves `@main` serving the previous bundle, and nothing reports
it — the workflow simply runs the old code.
