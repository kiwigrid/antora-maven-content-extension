const MavenContentSource = require('./maven-content-source')
const selectVersion = require('./version-selector');
const versioning = require('./versioning')

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
    edit_url;

    constructor({
                    groupId,
                    artifactId,
                    version = "*",
                    versionScheme = 'SemVer',
                    classifier = 'docs',
                    extension = 'zip',
                    limit = 1,
                    limitBy = 'major',
                    includeSnapshots = false,
                    startPath = null,
                    startPaths = null,
                    includePrerelease = true,
                    edit_url = false
                }) {
        this.groupId = groupId;
        this.artifactId = artifactId;
        this.includeSnapshots = includeSnapshots;
        this.startPath = startPath;
        this.startPaths = startPaths;
        this.version = version;
        this.versionScheme = versioning[versionScheme];
        if (!this.versionScheme) {
            throw new TypeError(`versionScheme must be one of "${Object.keys(versioning).join('", "')}"`);
        }
        this.versionRange = this.versionScheme.range(version, includePrerelease);
        this.classifier = classifier;
        this.extension = extension;
        this.limit = limit;
        this.limitBy = limitBy;
        if (!['major', 'minor', 'patch', 'any'].includes(this.limitBy)) {
            throw new TypeError("limitBy must be one of 'major', 'minor', 'patch', 'any'");
        }
        this.edit_url = edit_url;
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
            versionRepoTupleList = await mavenClient.retrieveAvailableVersions(repositories, this.versionScheme,{
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
        selectVersion(this.versionScheme, this.versionRange, this.limit, this.limitBy, versionRepoTupleList, versionRepoTuple => {
            results.push(new MavenContentSource({
                    mavenClient: mavenClient,
                    logger: mavenClient.logger,
                    repository: versionRepoTuple.repository,
                    git: git,
                    cacheFolder: cacheFolder,
                    startPath: this.startPath,
                    startPaths: this.startPaths,
                    edit_url: this.edit_url,
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
}

module.exports = {
    MavenRepository,
    MavenArtifact,
    MavenContentCoordinate
}
