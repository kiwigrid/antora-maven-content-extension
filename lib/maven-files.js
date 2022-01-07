"use strict";

const libxml = require("libxmljs2");
const {MavenRepository} = require("./maven-types");
const SETTINGS_XML_NS = 'http://maven.apache.org/SETTINGS/1.0.0'

class MavenXmlFile {

    document;
    logger;

    constructor(xmlText, logger) {
        this.logger = logger;
        this.document = libxml.parseXml(xmlText)
    }

}

class MavenSettingsFile extends MavenXmlFile {
    #NO_MATCH_TRY_NEXT = Symbol();
    #NO_MATCH_STOP = Symbol();
    #MATCH = Symbol();
    #MATCH_WILDCARD = Symbol();

    #mirrorList;
    #activeProfileRepositories;

    constructor(xmlText, logger) {
        super(xmlText, logger.get('MavenSettingsFile'));
        this.#mirrorList = this.#createMirrorList() || [];
        this.logger.debug('Extracted ' + this.#mirrorList.length + ' mirrors.')
        this.#activeProfileRepositories = this.#extractActiveProfileRepositories() || []
        this.logger.debug('Extracted ' + this.#activeProfileRepositories.length + ' repositories.')
    }

    getActiveProfileRepositories() {
        return this.#activeProfileRepositories;
    }

    /**
     *
     * @returns {MavenRepository[]}
     */
    #extractActiveProfileRepositories() {
        this.logger.debug('Settings file parsed ...');
        const activeProfileNamePredicate = this.document
            .find('/xmlns:settings/xmlns:activeProfiles/xmlns:activeProfile/text()', SETTINGS_XML_NS)
            .map(node => 'xmlns:id="' + node.text() + '"')
            .join(" or ");
        this.logger.debug('Found active profiles: ' + activeProfileNamePredicate);
        const activeProfileRepoNodes = this.document.find('/xmlns:settings/xmlns:profiles/xmlns:profile[' + activeProfileNamePredicate + ']/xmlns:repositories/xmlns:repository', SETTINGS_XML_NS)
        let activeProfileRepos = activeProfileRepoNodes?.map(node => {
            this.logger.debug('Found active profile repo: ' + node);
            const repoId = node.get('xmlns:id/text()', SETTINGS_XML_NS)?.text()
            const baseUrl = node.get('xmlns:url/text()', SETTINGS_XML_NS)?.text()
            return this.#createRepositoryWithResolvedMirrors(repoId, baseUrl);
        })
        // mirrors might have made some repositories identical
        return activeProfileRepos.filter((repo, index, array) => {
            for (let i = index - 1; i >= 0; i--) {
                if (array[i].baseUrl === repo.baseUrl) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     *
     * @param {string} repoId
     * @param {string} repoUrl
     * @returns {MavenRepository}
     */
    #createRepositoryWithResolvedMirrors(repoId, repoUrl) {
        const mirror = this.#findMatchingMirror(repoId, repoUrl);
        const mavenRepository = new MavenRepository({
            baseUrl: mirror ? mirror.url : repoUrl,
            fetchOptions: this.#createFetchOptionsForServer(mirror ? mirror.id : repoId)
        });
        this.logger.info('Found repo in maven settings: ' + mavenRepository);
        return mavenRepository;
    }

    /**
     *
     * @returns {id, name, url, mirrorOf, mirrorOfList}[]
     */
    #createMirrorList() {
        return this.document.find('/xmlns:settings/xmlns:mirrors/xmlns:mirror', SETTINGS_XML_NS)
            ?.map(element => {
                return {
                    id: element.get('xmlns:id', SETTINGS_XML_NS)?.text(),
                    name: element.get('xmlns:name', SETTINGS_XML_NS)?.text(),
                    url: element.get('xmlns:url', SETTINGS_XML_NS)?.text(),
                    mirrorOf: element.get('xmlns:mirrorOf', SETTINGS_XML_NS)?.text(),
                }
            })
            .map(mirror => {
                const mirroredIds = mirror.mirrorOf.split(',');
                return Object.assign(
                    mirror,
                    {
                        mirrorOfList: mirroredIds.map(id => {
                            return {
                                pattern: id.startsWith('!') ? id.substr(1) : id,
                                negate: id.startsWith('!')
                            };
                        })
                    });
            });
    }

    #findMatchingMirror(repoId, repoUrl) {
        // need to defer wildcards behind non-wildcards according to maven docs:
        // > The position of wildcards within a comma separated list of repository
        // > identifiers is not important as the wildcards defer to further processing
        // > and explicit includes or excludes stop the processing, overruling any wildcard match.
        MIRROR_LIST: for (const mirror of this.#mirrorList) {
            let deferredMatch = false;
            for (const mirrorOf of mirror.mirrorOfList) {
                switch (this.#mirrorMatches(mirrorOf.pattern, mirrorOf.negate, repoId, repoUrl)) {
                    case this.#MATCH:
                        this.logger.debug('Found mirror of ' + repoId + ': ' + mirror.id);
                        return mirror;
                    case this.#MATCH_WILDCARD:
                        deferredMatch = true;
                        continue;
                    case this.#NO_MATCH_TRY_NEXT:
                        continue;
                    case this.#NO_MATCH_STOP:
                        continue MIRROR_LIST;
                }
            }
            // no direct match terminated the loop yet, look for a wildcard match now:
            if (deferredMatch) {
                this.logger.debug('Found mirror of ' + repoId + ': ' + mirror.id);
                return mirror;
            }
        }
        return null;
    }

    /**
     *
     * @param {string} pattern
     * @param {boolean} negated
     * @param {string} repoId
     * @param {string} repoUrl
     * @returns {symbol}
     */
    #mirrorMatches(pattern, negated, repoId, repoUrl) {
        if (pattern === '*') {
            return negated ? this.#NO_MATCH_TRY_NEXT : this.#MATCH_WILDCARD;
        }
        const isLocalHost = repoUrl.match(/^https?:\/\/localhost[:\/].*/);
        const isHttp = repoUrl.match(/^http:\/\/.*/);
        if (pattern === 'external:*' && !isLocalHost) {
            return negated ? this.#NO_MATCH_TRY_NEXT : this.#MATCH_WILDCARD;
        }
        if (pattern === 'external:http:*' && isHttp && !isLocalHost) {
            return negated ? this.#NO_MATCH_TRY_NEXT : this.#MATCH_WILDCARD;
        }
        if (pattern === repoId) {
            return negated ? this.#NO_MATCH_STOP : this.#MATCH;
        }
        return negated ? this.#MATCH : this.#NO_MATCH_TRY_NEXT;
    }

    #createFetchOptionsForServer(repoId) {
        const fetchOptions = {};
        const serverNode = this.document.get('/xmlns:settings/xmlns:servers/xmlns:server[xmlns:id="' + repoId + '"]', SETTINGS_XML_NS);
        if (serverNode) {
            this.logger.debug('Found active profile repo server: ' + serverNode);
            const userName = serverNode.get('xmlns:username/text()', SETTINGS_XML_NS)?.text()
            const password = serverNode.get('xmlns:password/text()', SETTINGS_XML_NS)?.text()
            const buff = Buffer.from(userName + ':' + password, 'utf-8');
            fetchOptions.headers = {
                'Authorization': 'Basic ' + buff.toString('base64')
            }
        }
        return fetchOptions;
    }

}

class MavenMetaDataFile extends MavenXmlFile {

    /**
     *
     * @param {string} classifier
     * @param {string} extension
     * @returns {string}
     */
    getLatestSnapshotVersion(classifier, extension) {
        return this.document.get(
            '//snapshotVersion[extension="'
            + mavenArtifact.extension
            + '"][classifier="'
            + mavenArtifact.classifier
            + '"]/value/text()')?.text()
    }


    /**
     * @returns {string[]}
     */
    getVersions() {
        return this.document.find("//versions/version/text()").map(node => node.text())
    }
}

module.exports = {
    MavenSettingsFile,
    MavenMetaDataFile
}
