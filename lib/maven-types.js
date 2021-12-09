const semver = require('semver')
const MavenContentSource = require('./maven-content-source')
const selectVersion = require('./version-selector');

class MavenRepository {
    baseUrl;
    fetchOptions;

    constructor({baseUrl, fetchOptions}) {
        this.baseUrl = baseUrl;
        this.fetchOptions = fetchOptions;
    }

    toString() {
        return 'MavenRepository(' + this.baseUrl + ')'
    }
}

class MavenArtifact {
    groupId;
    artifactId;
    version;
    extension;
    classifier;

    constructor({groupId, artifactId, version, classifier = 'docs', extension = 'zip'}) {
        this.groupId = groupId;
        this.artifactId = artifactId;
        this.version = version;
        this.classifier = classifier;
        this.extension = extension;
    }

    toString() {
        return 'MavenArtifact(' + this.groupId + ':' + this.artifactId + ':' + this.version
            + (this.classifier ? ':' + this.classifier : '')
            + (this.extension ? '@' + this.extension : '')
            + ')';
    }
}

class MavenContentCoordinate {
    groupId;
    artifactId;
    versionRange;
    version;
    extension;
    classifier;
    limit;
    limitBy;
    includeSnapshots;
    startPath;
    startPaths;

    constructor({
                    groupId,
                    artifactId,
                    version = "*",
                    classifier = 'docs',
                    extension = 'zip',
                    limit = 1,
                    limitBy = 'major',
                    includeSnapshots = false,
                    startPath = null,
                    startPaths = null,
                    includePrerelease = true
                }) {
        this.groupId = groupId;
        this.artifactId = artifactId;
        this.includeSnapshots = includeSnapshots;
        this.startPath = startPath;
        this.startPaths = startPaths;
        this.version = version;
        this.versionRange = new semver.Range(version, {loose: false, includePrerelease});
        this.classifier = classifier;
        this.extension = extension;
        this.limit = limit;
        this.limitBy = limitBy;
        if (!['major', 'minor', 'patch', 'any'].includes(this.limitBy)) {
            throw new TypeError("limitBy must be one of 'major', 'minor', 'patch', 'any'");
        }
    }

    toString() {
        return 'MavenContentCoordinate(' + this.groupId + ':' + this.artifactId + ':[' + this.versionRange + ']'
            + (this.classifier ? ':' + this.classifier : '')
            + (this.extension ? '@' + this.extension : '')
            + (limit !== 1 ? ', up to ' + limit + ' versions' : '')
            + (this.includeSnapshots ? ' including ' : ' excluding ') + 'snapshots'
            + ', selected by "' + this.regExp + '")';
    }

    /**
     *
     * @param {MavenClient} mavenClient
     * @param {MavenRepository[]} repositories
     * @param {Git} git
     * @param {string} cacheFolder
     * @param logger
     * @returns {Promise<MavenContentSource[]>}
     */
    async resolveToContentSources(mavenClient, repositories, git, cacheFolder, logger) {
        let versionRepoTupleList = [];
        try {
            versionRepoTupleList = await mavenClient.retrieveAvailableVersions(repositories, {
                groupId: this.groupId,
                artifactId: this.artifactId,
                fallback: {
                    version: this.version,
                    classifier: this.classifier,
                    extension: this.extension
                }
            })
        } catch (e) {
            logger.warn('failure when trying to download available versions  for ' + this.groupId + ':' + this.artifactId + ' (' + e.message + '). Skipping.');
        }
        if (!this.includeSnapshots) {
            versionRepoTupleList = versionRepoTupleList.filter(({
                                                                    version,
                                                                    repository
                                                                }) => !version.endsWith('-SNAPSHOT'))
        }
        return this.createSourcesForMatchingVersions(versionRepoTupleList, mavenClient, git, cacheFolder, logger);
    }

    createSourcesForMatchingVersions(versionRepoTupleList, mavenClient, git, cacheFolder, logger) {
        let results = [];
        selectVersion(this.versionRange, this.limit, this.limitBy, versionRepoTupleList, versionRepoTuple => {
            results.push(new MavenContentSource({
                    mavenClient: mavenClient,
                    logger: mavenClient.logger,
                    repository: versionRepoTuple.repository,
                    git: git,
                    cacheFolder: cacheFolder,
                    startPath: this.startPath,
                    startPaths: this.startPaths,
                    mavenArtifact: new MavenArtifact({
                        groupId: this.groupId,
                        artifactId: this.artifactId,
                        version: versionRepoTuple.version,
                        classifier: this.classifier,
                        extension: this.extension
                    })
                }
            ))
        }, logger);
        return results;
    }

    /**
     * @param {{repository: MavenRepository, version: string}[]} versionRepoTupleList
     * @param {function({repository: MavenRepository, version: string})} consumer
     * @param logger
     */
    forEachSelectedTuple(versionRepoTupleList, consumer, logger) {
        let usedVersionFragments = new Set();
        let idx = 0;
        do {
            let candidate = versionRepoTupleList[idx];
            if (this.versionRange.test(candidate.version)) {
                const candidateFragment = this.#extractVersionFragment(candidate.version);
                if (!usedVersionFragments.has(candidateFragment)) {
                    consumer(candidate);
                    usedVersionFragments.add(candidateFragment);
                } else {
                    logger.debug('Skipping version ' + candidate.version + ' of ' + this + ': version fragment already present');
                }
            } else {
                logger.debug('Skipping version ' + candidate.version + ' of ' + this + ': does not match ' + this.versionRange);
            }
        } while (++idx < versionRepoTupleList.length && usedVersionFragments.length < this.limit)
    }

    #extractVersionFragment(version) {
        let semanticVersion = semver.parse(version);
        switch (this.limitBy) {
            case 'major':
                return semanticVersion.major;
            case 'minor':
                return semanticVersion.major + '.' + semanticVersion.minor;
            case 'patch':
                return semanticVersion.major + '.' + semanticVersion.minor + '.' + semanticVersion.patch;
            default:
                return version;
        }
    }
}

module.exports = {
    MavenRepository,
    MavenArtifact,
    MavenContentCoordinate
}
