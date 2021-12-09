const chai = require('chai');
const expect = chai.expect
global.td = require('testdouble')
const tdChai = require('testdouble-chai');
chai.use(tdChai(td));
const semver = require('semver');

const selectVersion = require('../lib/version-selector')

function createVersionRepoList(...versions) {
    // version selector expects descending order
    return semver.sort(versions).reverse().map(version => {
        return {version, repository: "https://www.example.com"};
    })
}

describe('version selector', function () {

    it('should find exact version', function () {
        let selection = []
        selectVersion(
            '1.0.0',
            1,
            'any',
            createVersionRepoList('0.1.0', '1.0.0', '2.0.0', '2.1.0'),
                entry => selection.push(entry.version),
            td.object()
        )
        expect(selection).to.have.members(['1.0.0'])
    });

    it('should find higher version', function () {
        let selection = []
        selectVersion(
            '1.x.x',
            1,
            'any',
            createVersionRepoList('0.1.0', '1.0.0', '1.1.1', '2.0.0', '2.1.0'),
            entry => selection.push(entry.version),
            td.object()
        )
        expect(selection).to.have.members(['1.1.1'])
    });

    it('should find 2 highest versions', function () {
        let selection = []
        selectVersion(
            '1.x.x',
            2,
            'any',
            createVersionRepoList('0.1.0', '1.0.0', '1.1.1', '1.2.0', '2.0.0', '2.1.0'),
            entry => selection.push(entry.version),
            td.object()
        )
        expect(selection).to.have.members(['1.2.0', '1.1.1'])
    });

    it('should find 2 highest major versions >= 1', function () {
        let selection = []
        selectVersion(
            '>= 1',
            2,
            'major',
            createVersionRepoList('0.1.0', '1.0.0', '1.1.1', '1.2.0', '2.0.0', '2.1.0', '2.1.1'),
            entry => selection.push(entry.version),
            td.object()
        )
        expect(selection).to.have.members(['2.1.1', '1.2.0'])
    });
});
