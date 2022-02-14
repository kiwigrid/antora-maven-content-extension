"use strict";

const semver = require('semver')

const SemVer = {
    sort: semver.sort,
    parse: semver.parse,
    valid: semver.valid,
    range(range, includePrerelease) {
        return new semver.Range(range, {loose: true, includePrerelease});
    }
}

const Lexicographically = {
    sort(versionsList) {
        return versionsList.sort()
    },

    parse(version) {
        return {
            major: version,
            minor: '0',
            patch: '0'
        }
    },

    valid() {
        return true;
    },

    range(range) {
        const re = new RegExp(range);
        return {
            toString: () => {
                return `LexicographicVersionRange[${range}]`
            },
            test(version) {
                return re.test(version);
            },
            format: () => {
                return range;
            }
        };
    }
}
const DIGITS ='[0-9]+';
const OSGI_QUALIFIER = '[0-9a-z_-]+';
const OSGI_VERSION = `(${DIGITS})(?:\.(${DIGITS})(?:\.(${DIGITS})(?:\.(${OSGI_QUALIFIER}))?)?)?`;
const OSGI_VERSION_REG_EXP = new RegExp(`^${OSGI_VERSION}\$`, 'i');
const OSGI_RANGE_START = '[\\[(]';
const OSGI_RANGE_END = '[\\])]';
const OSGI_RANGE = `(${OSGI_RANGE_START})?${OSGI_VERSION}(?:,${OSGI_VERSION}(${OSGI_RANGE_END}))?`;
const OSGI_RANGE_REG_EXP = new RegExp(`^${OSGI_RANGE}\$`, 'i');
const OSGI = {

    compare(a, b) {
        if (a > b) return 1;
        if (b > a) return -1;
        return 0;
    },

    compareVersions(aVersion, bVersion) {
        const compareResults = [
            this.compare(aVersion.major, bVersion.major),
            this.compare(aVersion.minor, bVersion.minor),
            // OSGI versioning calls it "micro": https://www.eclipse.org/virgo/documentation/virgo-documentation-3.7.0.M01/docs/virgo-user-guide/html/ch02s02.html
            this.compare(aVersion.micro, bVersion.micro)
            // OSGI qualifiers are not used in comparisons.
        ]
        // `find` returns the 1st item satisfying, or undefined
        return compareResults.find(e => e !== 0) || 0;
    },

    sort(versionsList) {
        return versionsList.sort((a, b) => {
            const aVersion = this.parse(a);
            const bVersion = this.parse(b);
            return this.compareVersions(aVersion, bVersion);
        });
    },

    parse(version) {
        const match = version.match(OSGI_VERSION_REG_EXP);
        if (!match) {
            return null;
        }
        return this.versionFromMatch(match)
    },

    versionFromMatch(match, groupOffset = 0) {
        if (match[groupOffset + 1] == null) {
            return null;
        }
        return {
            major: match[groupOffset + 1],
            minor: match[groupOffset + 2] || '0',
            patch: match[groupOffset + 3] || '0',
            // osgi specific alias for patch
            micro: match[groupOffset + 3] || '0',
            qualifier: match[groupOffset + 4] || ''
        };
    },

    valid(version) {
        return this.parse(version) !== null;
    },

    range(range) {
        const match = range.match(OSGI_RANGE_REG_EXP);
        if (!match) {
            return null;
        }
        const lower = this.versionFromMatch(match, 1);
        const lowerInclusive = match[1] === '[' || !match[1];
        const upper = this.versionFromMatch(match, 5);
        const upperInclusive = match[10] === ']';
        return {
            test: version => {
                version = this.parse(version);
                const lowerCompare = this.compareVersions(lower, version);
                if (lowerCompare > 0) {
                    return false;
                }
                if (lowerCompare === 0 && !lowerInclusive) {
                    return false;
                }
                if (!upper) {
                    return true;
                }
                const upperCompare = this.compareVersions(upper, version)
                if (upperCompare > 0) {
                    return true;
                }
                if (upperCompare === 0 && upperInclusive) {
                    return true;
                }
                return false
            },
            format: () => {
                return range;
            },
            toString: () => {
                return `OSGIVersionRange[${range}]`;
            }
        };
    }
}

/**
 * @type {Object.<SemVer|Lexicographically|OSGI, {valid(string): boolean,range(string, string): (null|{test(string): (boolean), format(): string, toString(): string}),sort(string[]): string[],parse(string): (null|{major: int, minor: int, patch: int})}>}
 */
module.exports = { SemVer, Lexicographically, OSGI}
