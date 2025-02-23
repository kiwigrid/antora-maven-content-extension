"use strict";
const fs = require('fs');

class ContentSourceFactory {
    mavenClient;
    git;
    logger;

    /**
     *
     * @param {MavenClient} mavenClient
     * @param {Git} git
     * @param logger
     */
    constructor(mavenClient, git, logger) {
        this.mavenClient = mavenClient;
        this.git = git;
        this.logger = logger;
    }

    /**
     * @param {MavenRepository[]} repositories
     * @param {MavenContentCoordinate[]} coordinates
     * @param playbook
     * @returns {Promise<void>}
     */
    async produceContentSourcesIntoPlaybook(repositories, coordinates, playbook) {
        const cacheFolder = playbook.runtime?.cacheDir ? playbook.runtime.cacheDir + '/maven' : '.cache/maven';
        const mappingFile = cacheFolder + '/contents.jsonl';
        const stream = fs.createWriteStream(mappingFile, {flags: 'w'});
        await Promise.all(coordinates.map(async (coordinate) => {
            await Promise.all(
                (await coordinate.resolveToContentSources(
                        this.mavenClient,
                        repositories,
                        this.git,
                        cacheFolder,
                        this.logger)
                )
                    .map(contentSource => {
                        this.logger.info("Adding " + contentSource + ' to playbook.')
                        let mapping = {
                            source: contentSource.#getCacheFolderName(),
                            artifact: {
                                groupId: contentSource.#mavenArtifact.groupId,
                                artifactId: contentSource.#mavenArtifact.artifactId,
                                version: contentSource.#mavenArtifact.version,
                                classifier: contentSource.#mavenArtifact.classifier,
                                extension: contentSource.#mavenArtifact.extension,
                            },
                            editUrl: contentSource.#editUrl
                        }
                        stream.write(JSON.stringify(mapping));
                        return contentSource.addAsSourceToPlaybook(playbook)
                    }));
        }));
    }
}

module.exports = ContentSourceFactory
