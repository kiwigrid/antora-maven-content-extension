"use strict";

const {MavenRepository} = require("./maven-types");
const {
    evaluateXPathToNodes,
    evaluateXPathToString,
    evaluateXPathToFirstNode,
    evaluateXPathToStrings
} = require("fontoxpath");
const {sync} = require('slimdom-sax-parser')

class MavenXmlFile {

    document;
    logger;

    constructor(xmlText, logger) {
        this.logger = logger;
        this.document = sync(xmlText)
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
        super(xmlText, logger);
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
        const activeProfileNamePredicate = evaluateXPathToStrings(
            '/settings/activeProfiles/activeProfile/text(),/settings/profiles/profile[activation/activeByDefault/text()="true"]/id/text()',
            this.document
        ).map(profile => `id="${profile}"`)
            .join(" or ");
        this.logger.debug('Found active profiles: ' + activeProfileNamePredicate);
        if (!activeProfileNamePredicate) {
            return [];
        }
        const activeProfileRepoNodes = evaluateXPathToNodes('/settings/profiles/profile[' + activeProfileNamePredicate + ']/repositories/repository', this.document)
        let activeProfileRepos = activeProfileRepoNodes?.map(node => {
            this.logger.debug('Found active profile repo: ' + node);
            const repoId = evaluateXPathToString('id/text()', node);
            const baseUrl = evaluateXPathToString('url/text()', node);
            return this.#createRepositoryWithResolvedMirrors(repoId, baseUrl);
        })
        // mirrors might have made some repositories identical
        return activeProfileRepos?.filter((repo, index, array) => {
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
        return evaluateXPathToNodes('/settings/mirrors/mirror', this.document)
            ?.map(element => {
                return {
                    id: evaluateXPathToString('id/text()', element),
                    name: evaluateXPathToString('name/text()', element),
                    url: evaluateXPathToString('url/text()', element),
                    mirrorOf: evaluateXPathToString('mirrorOf/text()', element),
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
        const serverNode = evaluateXPathToFirstNode('/settings/servers/server[id="' + repoId + '"]', this.document);
        if (serverNode) {
            this.logger.debug('Found active profile repo server: ' + serverNode);
            const userName = evaluateXPathToString('username/text()', serverNode);
            const password = evaluateXPathToString('password/text()', serverNode);
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
        return evaluateXPathToString(
            '//snapshotVersion[extension="'
            + extension
            + '"][classifier="'
            + classifier
            + '"]/value/text()', this.document)
    }


    /**
     * @returns {string[]}
     */
    getVersions() {
        return evaluateXPathToStrings('//versions/version/text()', this.document);
    }
}

module.exports = {
    MavenSettingsFile,
    MavenMetaDataFile
}
