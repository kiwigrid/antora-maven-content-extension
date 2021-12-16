const fetch = require("node-fetch");
const fs = require("fs")
const libxml = require("libxmljs2");
const unzip = require("unzip-stream");
const tar = require("tar");
const {pipeline} = require('stream/promises');
const {
    MavenRepository,
    MavenArtifact
} = require('./maven-types')
const semver = require('semver')


const META_DATA_FILE_NAME = 'maven-metadata.xml';

const SETTINGS_XML_NS = 'http://maven.apache.org/SETTINGS/1.0.0'

class MavenClient {

    logger;

    constructor(logger) {
        this.logger = logger
    }

    /**
     *
     * @param {MavenRepository} repository
     * @param {String }targetFolder
     * @param {MavenArtifact} mavenArtifact
     * @returns {Promise<void>}
     */
    async downloadAndExtract(repository, targetFolder, mavenArtifact) {
        const downloadUrl = await MavenClient.#buildUrl(repository, mavenArtifact)
        this.logger.debug('Fetching ' + downloadUrl)
        const response = await fetch(downloadUrl, repository.fetchOptions);
        if (!response.ok) {
            throw new MavenClientError("Failure downloading " + downloadUrl + ' (' + response.status + ')');
        }
        switch (mavenArtifact.extension) {
            case 'zip':
            case 'jar':
                await pipeline(
                    response.body,
                    unzip.Extract({path: targetFolder})
                );
                break;
            case 'tgz':
                await pipeline(
                    response.body,
                    tar.extract({cwd: targetFolder})
                );
                break;
            default:
                throw new MavenClientError('Unsupported extension: ' + mavenArtifact.extension);
        }
    }

    /**
     *
     * @param {MavenRepository }repository
     * @param {MavenArtifact} mavenArtifact
     * @returns {Promise<string>}
     */
    static async #buildUrl(repository, mavenArtifact) {
        if (mavenArtifact.version.endsWith("-SNAPSHOT")) {
            return await MavenClient.#buildSnapshotUrl(repository, mavenArtifact);
        } else {
            return MavenClient.#buildReleaseUrl(repository.baseUrl, mavenArtifact);
        }
    }

    /**
     *
     * @param {MavenRepository[]} repositories
     * @param {string} groupId
     * @param {string} artifactId
     * @param {string} version optional, try to find this if metadata discovery fails for a reason
     * @param {string} classifier optional, try to find this if metadata discovery fails for a reason
     * @param {string} extension optional, try to find this if metadata discovery fails for a reason
     *
     * @returns {Promise<{version, repository}[]>}
     */
    async retrieveAvailableVersions(repositories, {groupId, artifactId, fallback: {version, classifier, extension}}) {
        const versionToRepoMap = new Map();
        await Promise.all(repositories.map(async (repository) => {
            const metaDataUrl = MavenClient.#buildMetaDataUrlForArtifact(repository.baseUrl, {groupId, artifactId});
            this.logger.debug('Downloading metadata to extract version from ' + metaDataUrl);
            try {
                const metaDataDocument = await MavenClient.#downloadXml(metaDataUrl, repository.fetchOptions);
                metaDataDocument
                    .find("//versions/version/text()")
                    .map(node => node.text())
                    .forEach(discoveredVersion => {
                        if (!semver.valid(discoveredVersion)) {
                            this.logger.info('Found invalid SemVer version ' + discoveredVersion + ' for ' + groupId + ':' + artifactId + ', skipping.');
                        } else if (!versionToRepoMap.has(discoveredVersion)) {
                            versionToRepoMap.set(discoveredVersion, repository);
                        }
                    });
            } catch (error) {
                this.logger.warn('Error when trying to fetch meta data for ' + groupId + ':' + artifactId + ' from ' + repository + ': ' + error.message);
                const fixedVersionUrl = await MavenClient.#buildUrl(
                    repository,
                    new MavenArtifact({groupId, artifactId, version, classifier, extension}))
                this.logger.debug('Probing "' + fixedVersionUrl + '"...')
                if (await MavenClient.#existsRemotely(fixedVersionUrl, repository.fetchOptions)) {
                    this.logger.debug('Using fallback version for ' + groupId + ':' + artifactId + ':' + version);
                    versionToRepoMap.set(version, repository)

                } else {
                    this.logger.warn('Skipping ' + groupId + ':' + artifactId);
                }
            }
        }));
        if (!versionToRepoMap.size) {
            throw new MavenClientError('Unable to find any version for ' + groupId + ':' + artifactId);
        }
        const versionList = semver.sort([...versionToRepoMap.keys()]);
        versionList.reverse();
        this.logger.info('Found ' + versionList.length + ' versions for ' + groupId + ':' + artifactId);
        return versionList.map(version => {
            return {
                version: version,
                repository: versionToRepoMap.get(version)
            };
        });
    }

    /**
     *
     * @param {MavenRepository }repository
     * @param {MavenArtifact} mavenArtifact
     * @returns {Promise<string>}
     */
    static async #buildSnapshotUrl(repository, mavenArtifact) {
        const snaphotMetadataUrl =
            [repository.baseUrl]
                .concat(...MavenClient.#groupIdAsPathSegments(mavenArtifact.groupId))
                .concat(mavenArtifact.artifactId)
                .concat(mavenArtifact.version)
                .concat(META_DATA_FILE_NAME)
                .join('/');
        const snapshotMetaData = await MavenClient.#downloadXml(snaphotMetadataUrl, repository.fetchOptions);
        const latestVersion = snapshotMetaData.get(
            '//snapshotVersion[extension="'
            + mavenArtifact.extension
            + '"][classifier="'
            + mavenArtifact.classifier
            + '"]/value/text()')?.text()
        if (!latestVersion) {
            throw new MavenClientError('Cannot find latest snapshot version info for ' + mavenArtifact.extension + ' in maven metadata: ' + snapshotMetaData)
        }
        return [repository.baseUrl]
            .concat(...MavenClient.#groupIdAsPathSegments(mavenArtifact.groupId))
            .concat(mavenArtifact.artifactId)
            .concat(mavenArtifact.version)
            .concat(
                mavenArtifact.artifactId
                + '-'
                + latestVersion
                + (mavenArtifact.classifier ? '-' + mavenArtifact.classifier : '')
                + '.'
                + mavenArtifact.extension)
            .join('/')
    }

    static #buildMetaDataUrlForArtifact(baseUrl, mavenArtifact) {
        return [baseUrl]
            .concat(...MavenClient.#groupIdAsPathSegments(mavenArtifact.groupId))
            .concat(mavenArtifact.artifactId)
            .concat(META_DATA_FILE_NAME)
            .join('/');
    }

    /**
     *
     * @param {string} baseUrl
     * @param {MavenArtifact} mavenArtifact
     * @returns {string}
     */
    static #buildReleaseUrl(baseUrl, mavenArtifact) {
        return [baseUrl]
            .concat(...MavenClient.#groupIdAsPathSegments(mavenArtifact.groupId))
            .concat(mavenArtifact.artifactId)
            .concat(mavenArtifact.version)
            .concat(
                mavenArtifact.artifactId
                + '-'
                + mavenArtifact.version
                + (mavenArtifact.classifier ? '-' + mavenArtifact.classifier : '')
                + '.'
                + mavenArtifact.extension)
            .join('/');
    }


    static async #downloadXml(url, fetchOptions) {
        let metaDataResponse = await fetch(url, fetchOptions)
        let blob = await metaDataResponse.blob()
        let text = await blob.text();
        if (!metaDataResponse.ok) {
            throw new MavenClientError("Failure while downloading xml file: " + metaDataResponse.status + " : " + text);
        }
        return libxml.parseXml(text);
    }

    static async #existsRemotely(url, fetchOptions) {
        const options = Object.assign({}, fetchOptions);
        options.method = 'HEAD';
        let probeResponse = await fetch(url, options);
        return probeResponse.ok
    }

    static #groupIdAsPathSegments(groupId) {
        return groupId.split('\.')
    }

    async extractRepositoriesFromSettingsFile(settingsFilePath) {
        this.logger.debug('Loading repositories from ' + settingsFilePath + '...');
        if (!fs.existsSync(settingsFilePath)) {
            this.logger.warn('Skip loading repos from settings, ' + settingsFilePath + ' does not exist.');
            return [];
        }
        const mavenSettingsXml = await fs.promises.readFile(settingsFilePath, "utf-8")
        const mavenSettingsDocument = libxml.parseXml(mavenSettingsXml);
        this.logger.debug('Settings file parsed ...');
        const activeProfileNamePredicate = mavenSettingsDocument
            .find('/xmlns:settings/xmlns:activeProfiles/xmlns:activeProfile/text()', SETTINGS_XML_NS)
            .map(node => 'xmlns:id="' + node.text() + '"')
            .join(",");
        this.logger.debug('Found active profiles: ' + activeProfileNamePredicate);
        const activeProfileRepoNodes = mavenSettingsDocument.find('/xmlns:settings/xmlns:profiles/xmlns:profile[' + activeProfileNamePredicate + ']/xmlns:repositories/xmlns:repository', SETTINGS_XML_NS)
        return activeProfileRepoNodes.map(node => {
            this.logger.debug('Found active profile repo: ' + node);
            const repoId = node.get('xmlns:id/text()', SETTINGS_XML_NS)?.text()
            const baseUrl = node.get('xmlns:url/text()', SETTINGS_XML_NS)?.text()
            const serverNode = mavenSettingsDocument.get('/xmlns:settings/xmlns:servers/xmlns:server[xmlns:id="'+ repoId +'"]', SETTINGS_XML_NS);
            const fetchOptions = {};
            if (serverNode) {
                this.logger.debug('Found active profile repo server: ' + serverNode);
                const userName = serverNode.get('xmlns:username/text()', SETTINGS_XML_NS)?.text()
                const password = serverNode.get('xmlns:password/text()', SETTINGS_XML_NS)?.text()
                const buff = Buffer.from(userName + ':' + password, 'utf-8');
                fetchOptions.headers = {
                    'Authorization': 'Basic ' + buff.toString('base64')
                }
            }
            const mavenRepository = new MavenRepository({baseUrl, fetchOptions});
            this.logger.info('Found repo in maven settings: ' + mavenRepository);
            return mavenRepository;
        })
    }
}

class MavenClientError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MavenContentSourceError';
    }
}

module.exports = MavenClient
