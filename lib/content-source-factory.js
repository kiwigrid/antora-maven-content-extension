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
        await Promise.all(coordinates.map(async (coordinate) => {
            await Promise.all(
                (await coordinate.resolveToContentSources(
                        this.mavenClient,
                        repositories,
                        this.git,
                        playbook.runtime?.cacheDir ? playbook.runtime.cacheDir + '/maven' : '.cache/maven',
                        this.logger)
                )
                    .map(contentSource => {
                        this.logger.info("Adding " + contentSource + ' to playbook.')
                        return contentSource.addAsSourceToPlaybook(playbook)
                    }));
        }));
    }
}

module.exports = ContentSourceFactory
