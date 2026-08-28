import * as setupGradle from '../../setup-gradle'
import {reportDevelocityAppStatus} from '../../develocity-app'
import * as provisioner from '../../execution/provision'
import * as dependencyGraph from '../../dependency-graph'
import {
    DevelocityConfig,
    CacheConfig,
    DependencyGraphConfig,
    GradleExecutionConfig,
    WrapperValidationConfig,
    getActionId,
    setActionId
} from '../../configuration'
import {failOnUseOfRemovedFeature, saveDeprecationState} from '../../deprecation-collector'
import {handleMainActionError} from '../../errors'
import {forceExit} from '../../force-exit'

/**
 * The main entry point for the action, called by Github Actions for the step.
 */
export async function run(): Promise<void> {
    try {
        if (getActionId() === 'gradle/gradle-build-action') {
            failOnUseOfRemovedFeature(
                'The action `gradle/gradle-build-action` has been replaced by `gradle/actions/setup-gradle`'
            )
        }

        setActionId('gradle/actions/setup-gradle')

        // Report this repository's Develocity GitHub App status. Written here, in the main step,
        // so the call to action lands above the build-results summary the post step appends.
        await reportDevelocityAppStatus()

        // Configure Gradle environment (Gradle User Home)
        await setupGradle.setup(new CacheConfig(), new DevelocityConfig(), new WrapperValidationConfig())

        // Configure the dependency graph submission
        await dependencyGraph.setup(new DependencyGraphConfig())

        const config = new GradleExecutionConfig()
        config.verifyNoArguments()
        await provisioner.provisionGradle(config.getGradleVersion())

        saveDeprecationState()
    } catch (error) {
        handleMainActionError(error)
    }

    // Explicit process.exit() to prevent waiting for hanging promises.
    await forceExit()
}

run()
