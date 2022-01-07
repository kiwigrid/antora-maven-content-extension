"use strict";
const {
    MavenRepository,
    MavenContentCoordinate
} = require('./maven-types')
const MavenClient = require('./maven-client')
const ContentSourceFactory = require('./content-source-factory')

/**
 * This antora extension allows to add content from maven coordinates.
 */
class MavenContentSourceExtension {

    antoraContext;
    config;
    mavenClient;
    git;
    logger;

    /**
     * The entry point of the extension, called by antora site generator if extension is enabled in playbook.
     * @param config The config as seen in the playbook
     */
    static register({config}) {
        new MavenContentSourceExtension(this, config)
    }

    /**
     * constructs the extension object and hooks it into the site generation pipeline.
     * @param context Antora generator context
     * @param config Extension configuration
     */
    constructor(context, config) {
        ;(this.antoraContext = context)
            // need to explicitly bind `this` when passing over a function:
            // see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes#binding_this_with_prototype_and_static_methods
            .on('playbookBuilt', this.onPlaybookBuilt.bind(this))
        this.config = config;
        this.logger = this.antoraContext.getLogger('maven-content');
        this.git = this.antoraContext.require('@antora/content-aggregator/lib/git.js')
        this.mavenClient = new MavenClient(this.logger);
        this.contentSourceFactory = new ContentSourceFactory(this.mavenClient, this.git, this.logger);
    }

    async onPlaybookBuilt({playbook}) {
        this.logger.info("Add Maven Content Sources to playbook...");
        const repositories = this.config.repositories?.map(entry => new MavenRepository(entry)) || [];
        const coordinates = this.config.sources?.map(entry => new MavenContentCoordinate(entry)) || [];
        if (this.config.mavenSettings) {
            const settingsFile = this.config.mavenSettings === true ? this.mavenClient.findMavenSettingsFile() : this.config.mavenSettings;
            repositories.push(...(await this.mavenClient.extractRepositoriesFromSettingsFile(settingsFile)));
        }
        // copy playbook as it is frozen deeply...
        const mutablePlaybook = MavenContentSourceExtension.#unfreezePlaybookSources(playbook);
        await this.contentSourceFactory.produceContentSourcesIntoPlaybook(repositories, coordinates, mutablePlaybook);
        this.antoraContext.updateVariables({playbook: mutablePlaybook})
    }

    static #unfreezePlaybookSources(playbook) {
        // see https://gitlab.com/antora/antora/-/issues/930
        let mutablePlaybook = Object.assign({}, playbook, {env: playbook.env})
        if (playbook.content) {
            mutablePlaybook.content = Object.assign({}, playbook.content);
            if (playbook.content.sources !== undefined) {
                mutablePlaybook.content.sources = Object.assign([], playbook.content.sources)
            }
        }
        return mutablePlaybook;
    }
}

module.exports = MavenContentSourceExtension
