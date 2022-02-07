function extractVersionFragment(versionScheme, version, fragment) {
    let parsedVersion = versionScheme.parse(version);
    switch (fragment) {
        case 'major': return parsedVersion.major;
        case 'minor': return parsedVersion.major + '.' + parsedVersion.minor;
        case 'patch': return parsedVersion.major + '.' + parsedVersion.minor + '.' + parsedVersion.patch;
        default: return version;
    }
}

function selectVersions(versionScheme, versionRange, limit, limitBy, orderedVersionRepoTupleList, consumer, logger) {
    if (!orderedVersionRepoTupleList || !orderedVersionRepoTupleList.length) {
        logger.debug('No version given.');
        return;
    }
    let usedVersionFragments = new Set();
    if (typeof versionRange === "string") {
        versionRange = versionScheme.range(versionRange);
    }
    let idx = 0;
    do {
        let candidate = orderedVersionRepoTupleList[idx];
        if (versionRange.test(candidate.version)) {
            const candidateFragment = extractVersionFragment(versionScheme, candidate.version, limitBy);
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
