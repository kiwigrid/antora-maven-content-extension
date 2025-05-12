const MavenContentSource = require('./maven-content-source')
const selectVersion = require('./version-selector');
const versioning = require('./versioning')

class MavenRepository {
    baseUrl;
    fetchOptions;

    constructor({baseUrl, baseurl, fetchOptions, fetchoptions}) {
        this.baseUrl = baseUrl || baseurl;
        this.fetchOptions = fetchOptions || fetchoptions;
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
    editUrl;

    constructor({
                    groupId, groupid,
                    artifactId, artifactid,
                    version = "*",
                    versionScheme, versionscheme,
                    classifier = 'docs',
                    extension = 'zip',
                    limit = 1,
                    limitBy, limitby,
                    includeSnapshots, includesnapshots,
                    startPath, startpath,
                    startPaths, startpaths,
                    includePrerelease, includeprerelease,
                    editUrl, editurl
                }) {
        this.groupId = groupId || groupid;
        this.artifactId = artifactId || artifactid;
        this.includeSnapshots = includeSnapshots || includesnapshots || false;
        this.startPath = startPath || startpath || null;
        this.startPaths = startPaths || startpaths || null;
        this.version = version;
        this.versionScheme = versioning[versionScheme || versionscheme || 'SemVer'];
        if (!this.versionScheme) {
            throw new TypeError(`versionScheme must be one of "${Object.keys(versioning).join('", "')}"`);
        }
        this.versionRange = this.versionScheme.range(
            version,
            typeof includePrerelease !== 'undefined' || typeof includeprerelease !== 'undefined'
                ? includePrerelease || includeprerelease
                : true);
        this.classifier = classifier;
        this.extension = extension;
        this.limit = limit;
        this.limitBy = limitBy || limitby || 'major';
        if (!['major', 'minor', 'patch', 'any'].includes(this.limitBy)) {
            throw new TypeError("limitBy must be one of 'major', 'minor', 'patch', 'any'");
        }
        this.editUrl = editUrl || editurl || false;
    }

    toString() {
        return `MavenContentCoordinate(${this.groupId}:${this.artifactId}:[${this.versionRange}]${this.classifier ? ':' + this.classifier : ''}${this.extension ? '@' + this.extension : ''}${this.limit !== 1 ? ', up to ' + this.limit + ' versions' : ''}${this.includeSnapshots ? ' including ' : ' excluding '}snapshots, selected by "${this.limitBy}")`;
    }

    /**
     *
     * @param {MavenClient} mavenClient
     * @param {MavenRepository[]} repositories
     * @param git
     * @param {string} cacheFolder
     * @param logger
     * @returns {Promise<MavenContentSource[]>}
     */
    async resolveToContentSources(mavenClient, repositories, git, cacheFolder, logger) {
        let versionRepoTupleList = [];
        try {
            versionRepoTupleList = await mavenClient.retrieveAvailableVersions(repositories, this.versionScheme, {
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
                    logger: logger,
                    repository: versionRepoTuple.repository,
                    git: git,
                    cacheFolder: cacheFolder,
                    startPath: this.startPath,
                    startPaths: this.startPaths,
                    editUrl: this.editUrl,
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
