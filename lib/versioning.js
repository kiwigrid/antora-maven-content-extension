"use strict";

const semver = require('semver')

const SemVer = {
    sort: semver.sort,
    parse: semver.parse,
    valid: semver.valid,
    range: (range, includePrerelease) => new semver.Range(range, {loose: true, includePrerelease})
}

const Lexicographically = {
    sort: function(versionsList) {
        return versionsList.sort()
    },

    parse: function(version) {
        return {
            major: version,
            minor: '0',
            patch: '0'
        }
    },

    valid: function(version) {
        return true;
    },

    range: (range, includePrerelease) => {
        const re = new RegExp(range);
        return {
            toString: () => {
                return `LexicographicVersionRange[${range}]`
            },
            test: function(version) {
                return re.test(version);
            },
            format: () => {
                return range;
            }
        };
    }
}
const OSGI_VERSION_REG_EXP = /^([0-9]+)(?:\.([0-9]+)(?:\.([0-9]+)(?:\.([0-9a-z_-]+))?)?)?$/i;
const OSGI_RANGE_REG_EXP = /^([\[(])?([0-9]+(?:\.[0-9]+(?:\.[0-9]+(?:\.[0-9a-z_-]+)?)?)?)(?:,([0-9]+(?:\.[0-9]+(?:\.[0-9]+(?:\.[0-9a-z_-]+)?)?)?)([\])]))?$/i;
const OSGI = {

    compare: function(a, b) {
        if (a > b) return 1;
        if (b > a) return -1;
        return 0;
    },

    compareVersions: function (aVersion, bVersion) {
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

    sort: function(versionsList) {
        return versionsList.sort((a, b) => {
            const aVersion = this.parse(a);
            const bVersion = this.parse(b);
            return this.compareVersions(aVersion, bVersion);
        });
    },

    parse: function(version) {
        const match = version.match(OSGI_VERSION_REG_EXP);
        if (!match) {
            return null;
        }
        return {
            major: match[1],
            minor: match[2] || '0',
            patch: match[3] || '0',
            // osgi specific alias for patch
            micro: match[3] || '0',
            qualifier: match[4] || ''
        }
    },

    valid: function(version) {
        return this.parse(version) !== null;
    },

    range: function(range, includePrerelease) {
        const match = range.match(OSGI_RANGE_REG_EXP);
        if (!match) {
            return null;
        }
        let lower = match[2]
        const lowerInclusive = match[1] === '[' || !match[1];
        let upper = match[3];
        const upperInclusive = match[4] === ']';
        lower = this.parse(lower);
        if (upper) {
            upper = this.parse(upper);
        }
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

module.exports = { SemVer, Lexicographically, OSGI}
