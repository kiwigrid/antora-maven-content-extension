const http = require('http');
const https = require('https');
const fs = require("fs")
const unzip = require("unzip-stream");
const tar = require("tar");
const {pipeline} = require('stream/promises');
const {
    MavenRepository,
    MavenArtifact
} = require('./maven-types')
const {MavenSettingsFile, MavenMetaDataFile} = require("./maven-files");
const Process = require("process");

const META_DATA_FILE_NAME = 'maven-metadata.xml';

class MavenClient {

    logger;

    constructor(logger) {
        this.logger = logger
    }

    async #nativeFetch(url, options = {}, redirectCount = 0) {
        return new Promise((resolve, reject) => {
            const urlObject = new URL(url);
            const client = urlObject.protocol === 'https:' ? https : http;

            const requestOptions = {
                method: options.method || 'GET',
                headers: options.headers || {},
                host: urlObject.hostname,
                port: urlObject.port,
                path: urlObject.pathname + urlObject.search
            };

            const req = client.request(requestOptions, (response) => {
                // Guard against cases where the callback is invoked without a response object
                if (!response) {
                    return reject(new MavenClientError(`Request to ${url} failed: No response received.`));
                }

                // Handle redirects
                if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location) {
                    if (redirectCount >= 10) {
                        return reject(new MavenClientError('Too many redirects'));
                    }
                    const redirectUrl = new URL(response.headers.location, url);
                    this.logger.debug(`Following redirect to ${redirectUrl}`);
                    this.#nativeFetch(redirectUrl.href, options, redirectCount + 1).then(resolve).catch(reject);
                    return;
                }

                // Resolve with a response object that mimics the fetch response
                resolve({
                    ok: response.statusCode >= 200 && response.statusCode < 300,
                    status: response.statusCode,
                    body: response, // The response object itself is a Readable stream
                    text: () => {
                        return new Promise((resolveText) => {
                            let data = '';
                            response.setEncoding('utf8');
                            response.on('data', (chunk) => data += chunk);
                            response.on('end', () => resolveText(data));
                        });
                    }
                });
            });

            req.on('error', err => {
                reject(new MavenClientError(`Request to ${url} failed: ${err.message}`));
            });

            req.end();
        });
    }

    /**
     *
     * @param {MavenRepository} repository
     * @param {String }targetFolder
     * @param {MavenArtifact} mavenArtifact
     * @returns {Promise<void>}
     */
    async downloadAndExtract(repository, targetFolder, mavenArtifact) {
        const downloadUrl = await this.#buildUrl(repository, mavenArtifact)
        this.logger.debug(`Fetching ${downloadUrl} ...`)
        const response = await this.#nativeFetch(downloadUrl, repository.fetchOptions);
        if (!response.ok) {
            throw new MavenClientError(`Failure downloading ${downloadUrl} (${response.status})`);
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
                throw new MavenClientError(`Unsupported extension: ${mavenArtifact.extension}`);
        }
    }

    /**
     * Builds the final artifact URL, handling snapshot and release versions.
     * @param {MavenRepository }repository
     * @param {MavenArtifact} mavenArtifact
     * @returns {Promise<string>}
     */
    async #buildUrl(repository, mavenArtifact) {
        if (mavenArtifact.version.endsWith("-SNAPSHOT")) {
            return await this.#buildSnapshotUrl(repository, mavenArtifact);
        } else {
            return this.#buildReleaseUrl(repository.baseUrl, mavenArtifact);
        }
    }

    /**
     * Retrieves all available versions for a given artifact from a list of repositories.
     * @param {MavenRepository[]} repositories
     * @param {string} groupId groupId of the artifact
     * @param {string} artifactId artifact if of the artifact
     * @param {object} versionScheme The versioning scheme from versioning.js
     * @param {string} version optional, try to find this if metadata discovery fails for a reason
     * @param {string} classifier optional, try to find this if metadata discovery fails for a reason
     * @param {string} extension optional, try to find this if metadata discovery fails for a reason
     *
     * @returns {Promise<{version, repository}[]>}
     */
    async retrieveAvailableVersions(repositories, versionScheme, {groupId, artifactId, fallback: {version, classifier, extension}}) {
        const versionToRepoMap = new Map();
        await Promise.all(repositories.map(async (repository) => {
            const metaDataUrl = this.#buildMetaDataUrlForArtifact(repository.baseUrl, {groupId, artifactId});
            this.logger.debug(`Downloading metadata to extract version from ${metaDataUrl}`);
            try {
                const metaDataFile = new MavenMetaDataFile(await this.#downloadXml(metaDataUrl, repository.fetchOptions), this.logger);
                metaDataFile.getVersions().forEach(discoveredVersion => {
                    if (!versionScheme.valid(discoveredVersion)) {
                        this.logger.info(`Found invalid version ${discoveredVersion} for ${groupId}:${artifactId}, skipping.`);
                    } else if (!versionToRepoMap.has(discoveredVersion)) {
                        versionToRepoMap.set(discoveredVersion, repository);
                    }
                });
            } catch (error) {
                this.logger.warn(`Error when trying to fetch meta data for ${groupId}:${artifactId} from ${repository}: ${error.message}`);
                const fixedVersionUrl = await this.#buildUrl(
                    repository,
                    new MavenArtifact({groupId, artifactId, version, classifier, extension}))
                this.logger.debug(`Probing "${fixedVersionUrl}"...`)
                if (await this.#existsRemotely(fixedVersionUrl, repository.fetchOptions)) {
                    this.logger.debug(`Using fallback version for ${groupId}:${artifactId}:${version}`);
                    versionToRepoMap.set(version, repository)

                } else {
                    this.logger.warn(`Skipping ${groupId}:${artifactId}`);
                }
            }
        }));
        if (!versionToRepoMap.size) {
            throw new MavenClientError(`Unable to find any version for ${groupId}:${artifactId}`);
        }
        const versionList = versionScheme.sort([...versionToRepoMap.keys()]);
        versionList.reverse();
        this.logger.info(`Found ${versionList.length} versions for ${groupId}:${artifactId}`);
        return versionList.map(version => {
            return {
                version: version,
                repository: versionToRepoMap.get(version)
            };
        });
    }

    /**
     * Builds the URL for a snapshot artifact by first fetching its metadata.
     * @param {MavenRepository }repository
     * @param {MavenArtifact} mavenArtifact
     * @returns {Promise<string>}
     */
    async #buildSnapshotUrl(repository, mavenArtifact) {
        const snaphotMetadataUrl =
            [repository.baseUrl]
                .concat(...this.#groupIdAsPathSegments(mavenArtifact.groupId))
                .concat(mavenArtifact.artifactId)
                .concat(mavenArtifact.version)
                .concat(META_DATA_FILE_NAME)
                .join('/');
        const snapshotMetaData = new MavenMetaDataFile(await this.#downloadXml(snaphotMetadataUrl, repository.fetchOptions), this.logger);
        const latestVersion = snapshotMetaData.getLatestSnapshotVersion(mavenArtifact.classifier, mavenArtifact.extension);
        if (!latestVersion) {
            throw new MavenClientError(`Cannot find latest snapshot version info for ${mavenArtifact.extension} in maven metadata: ${snapshotMetaData}`)
        }
        return [repository.baseUrl]
            .concat(...this.#groupIdAsPathSegments(mavenArtifact.groupId))
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

    #buildMetaDataUrlForArtifact(baseUrl, mavenArtifact) {
        return [baseUrl]
            .concat(...this.#groupIdAsPathSegments(mavenArtifact.groupId))
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
    #buildReleaseUrl(baseUrl, mavenArtifact) {
        return [baseUrl]
            .concat(...this.#groupIdAsPathSegments(mavenArtifact.groupId))
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


    async #downloadXml(url, fetchOptions) {
        let metaDataResponse = await this.#nativeFetch(url, fetchOptions)
        let text = await metaDataResponse.text();
        if (!metaDataResponse.ok) {
            throw new MavenClientError(`Failure while downloading xml file: ${metaDataResponse.status} : ${text}`);
        }
        return text;
    }

    async #existsRemotely(url, fetchOptions) {
        const options = Object.assign({}, fetchOptions);
        options.method = 'HEAD';
        let probeResponse = await this.#nativeFetch(url, options);
        return probeResponse.ok
    }

    #groupIdAsPathSegments(groupId) {
        return groupId.split('\.')
    }

    async extractRepositoriesFromSettingsFile(settingsFilePath) {
        this.logger.debug(`Loading repositories from ${settingsFilePath}...`);
        if (!fs.existsSync(settingsFilePath)) {
            this.logger.warn(`Skip loading repos from settings, ${settingsFilePath} does not exist.`);
            return [];
        }
        const mavenSettingsXml = await fs.promises.readFile(settingsFilePath, "utf-8")
        const settingsFile = new MavenSettingsFile(mavenSettingsXml, this.logger);
        return settingsFile.getActiveProfileRepositories();
    }

    findMavenSettingsFile() {
        const USER_SETTINGS = Process.env.HOME + '/.m2/settings.xml';
        if (fs.existsSync(USER_SETTINGS)) {
            return USER_SETTINGS;
        }
        const INSTALL_SETTINGS = Process.env.M2_HOME + '/conf/settings.xml';
        if (fs.existsSync(INSTALL_SETTINGS)) {
            return INSTALL_SETTINGS;
        }
        throw new MavenClientError(`Unable to find maven settings. Looked for: ${[USER_SETTINGS, INSTALL_SETTINGS]}`);
    }
}

class MavenClientError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MavenContentSourceError';
    }
}

module.exports = MavenClient

