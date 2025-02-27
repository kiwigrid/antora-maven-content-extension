"use strict";

const sha1 = require('sha1');
const fs = require('fs');

class MavenContentSource {

    // fields
    #mavenArtifact;
    #repository;
    #cacheFolder;
    #mavenClient;
    #git;
    #hashKey;
    #startPath;
    #startPaths;
    #editUrl;
    #logger;

    toString() {
        return this.#mavenArtifact
            + ' from '
            + this.#repository
            + ' in ' + this.#getCacheFolderName();
    }

    // methods
    constructor({
                    mavenClient,
                    git,
                    repository,
                    mavenArtifact,
                    cacheFolder,
                    logger,
                    startPath,
                    startPaths,
                    editUrl
                }) {
        this.#mavenArtifact = mavenArtifact;
        this.#mavenClient = mavenClient;
        this.#git = git;
        this.#repository = repository;
        this.#cacheFolder = cacheFolder;
        this.#startPath = startPath;
        this.#startPaths = startPaths;
        this.#editUrl = editUrl;
        if (!["zip", "jar", "tgz"].includes(this.#mavenArtifact.extension)) {
            throw new MavenContentSourceError('Unsupported extension "' + this.#mavenArtifact.extension + '", use one of zip, jar, tgz');
        }
        this.#hashKey = this.#computeHashKey();
        this.#logger = logger;
    }

    async #ensureCacheParentFolderExists() {
        await fs.promises.mkdir(this.#cacheFolder, {recursive: true})
    }

    #computeHashKey() {
        return sha1(
            this.#repository.baseUrl
            + this.#mavenArtifact.groupId
            + this.#mavenArtifact.artifactId
            + this.#mavenArtifact.version
            + this.#mavenArtifact.classifier
            + this.#mavenArtifact.extension)
    }

    async #materializeToDisk() {
        await this.#ensureCacheParentFolderExists();
        const cacheFolderName = this.#getCacheFolderName();
        const git = this.#git
        if (fs.existsSync(cacheFolderName)) {
            // already cached.
            return cacheFolderName;
        }
        await fs.promises.mkdir(cacheFolderName);
        await this.#mavenClient.downloadAndExtract(this.#repository, cacheFolderName, this.#mavenArtifact);
        await git.init({
            fs: fs,
            dir: cacheFolderName,
            bare: false,
            defaultBranch: this.#mavenArtifact.version
        })
        const FILE = 0
        const status = await git.statusMatrix({fs, dir: cacheFolderName});
        await Promise.all(status.map(async (row) => {
            const filepath = row[FILE];
            await git.add({
                fs,
                dir: cacheFolderName,
                filepath
            });
        }));
        await git.commit({
            fs,
            dir: cacheFolderName,
            author: {name: 'Antora', email: 'root@example.com'},
            message: 'Initial commit.'
        });
        return cacheFolderName;
    }

    async addAsSourceToPlaybook(playbook) {
        const folder = await this.#materializeToDisk();
        if (!playbook.content) playbook.content = {};
        if (!playbook.content.sources) playbook.content.sources = [];
        // note antora does a deep camel casing during config loading which is why `edit_url` is `editUrl` after
        // loading the playbook 🤦
        let antoraContentSource = {
            url: folder,
            branches: 'HEAD',
            editUrl: false
        };
        if (this.#startPath) {
            antoraContentSource.start_path = this.#startPath;
        }
        if (this.#startPaths) {
            antoraContentSource.start_paths = this.#startPaths;
        }
        if (this.#editUrl) {
            antoraContentSource.editUrl = this.#editUrl;
        }

        this.#logger.info({
            artifact: this.#mavenArtifact,
            path: this.#getCacheFolderName(),
            editUrl: this.#editUrl,
            msg: "Adding " + this + ' to playbook.'
        });
        playbook.content.sources.push(antoraContentSource);
    }

    #getCacheFolderName() {
        return this.#cacheFolder + '/' + this.#hashKey
    }

}

class MavenContentSourceError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MavenContentSourceError';
    }
}

module.exports = MavenContentSource