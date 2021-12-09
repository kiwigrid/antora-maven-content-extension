const semver = require("semver");

function extractVersionFragment(version, fragment) {
    let semanticVersion = semver.parse(version);
    switch (fragment) {
        case 'major': return semanticVersion.major;
        case 'minor': return semanticVersion.major + '.' + semanticVersion.minor;
        case 'patch': return semanticVersion.major + '.' + semanticVersion.minor + '.' + semanticVersion.patch;
        default: return version;
    }
}

function selectVersions(versionRange, limit, limitBy, orderedVersionRepoTupleList, consumer, logger) {
    if (!orderedVersionRepoTupleList || !orderedVersionRepoTupleList.length) {
        logger.debug('No version given.');
        return;
    }
    let usedVersionFragments = new Set();
    if (typeof versionRange === "string") {
        versionRange = new semver.Range(versionRange);
    }
    let idx = 0;
    do {
        let candidate = orderedVersionRepoTupleList[idx];
        if (versionRange.test(candidate.version)) {
            const candidateFragment = extractVersionFragment(candidate.version, limitBy);
            if (!usedVersionFragments.has(candidateFragment)) {
                consumer(candidate);
                usedVersionFragments.add(candidateFragment);
            } else {
                logger.debug('Skipping version ' + candidate.version + ': version fragment already present');
            }
        } else {
            logger.debug('Skipping version ' + candidate.version + ': does not match range "' + versionRange.format() + '"');
        }
    } while (++idx < orderedVersionRepoTupleList.length && usedVersionFragments.size < limit)
}

module.exports = selectVersions
