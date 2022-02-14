const chai = require('chai');
const expect = chai.expect
global.td = require('testdouble')
const tdChai = require('testdouble-chai');
chai.use(tdChai(td));

const selectVersion = require('../lib/version-selector')
const versioning = require('../lib/versioning')

function createVersionRepoList(scheme, ...versions) {
    // version selector expects descending order
    return scheme.sort(versions).reverse().map(version => {
        return {version, repository: "https://www.example.com"};
    })
}

describe('version selector', function () {

    describe('with a SemVer scheme', function () {

        it('should find exact version', function () {
            let selection = []
            selectVersion(
                versioning.SemVer,
                '1.0.0',
                1,
                'any',
                createVersionRepoList(versioning.SemVer, '0.1.0', '1.0.0', '2.0.0', '2.1.0'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['1.0.0'])
        });

        it('should find higher version', function () {
            let selection = []
            selectVersion(
                versioning.SemVer,
                '1.x.x',
                1,
                'any',
                createVersionRepoList(versioning.SemVer, '0.1.0', '1.0.0', '1.1.1', '2.0.0', '2.1.0'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['1.1.1'])
        });

        it('should find 2 highest versions', function () {
            let selection = []
            selectVersion(
                versioning.SemVer,
                '1.x.x',
                2,
                'any',
                createVersionRepoList(versioning.SemVer, '0.1.0', '1.0.0', '1.1.1', '1.2.0', '2.0.0', '2.1.0'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['1.2.0', '1.1.1'])
        });

        it('should find 2 highest major versions >= 1', function () {
            let selection = []
            selectVersion(
                versioning.SemVer,
                '>= 1',
                2,
                'major',
                createVersionRepoList(versioning.SemVer, '0.1.0', '1.0.0', '1.1.1', '1.2.0', '2.0.0', '2.1.0', '2.1.1'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['2.1.1', '1.2.0'])
        });
    })


    describe('with a lexicographical scheme', function () {

        it('should find exact version', function () {
            let selection = []
            selectVersion(
                versioning.Lexicographically,
                '20/01',
                1,
                'any',
                createVersionRepoList(versioning.Lexicographically, '19/01', '19/04', '19/08', '20/01', '21/00'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['20/01'])
        });

        it('should find higher version', function () {
            let selection = []
            selectVersion(
                versioning.Lexicographically,
                '2.*',
                1,
                'any',
                createVersionRepoList(versioning.Lexicographically, '19/00', '19/04', '19/08', '20/00', '21/00'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['21/00'])
        });

        it('should find 2 highest versions', function () {
            let selection = []
            selectVersion(
                versioning.Lexicographically,
                '2.*',
                2,
                'any',
                createVersionRepoList(versioning.Lexicographically, '19/00', '19/04', '19/08', '20/00', '21/00'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['21/00', '20/00'])
        });
    })

    describe('with a OSGI scheme', function () {

        it('should find exact version', function () {
            let selection = []
            selectVersion(
                versioning.OSGI,
                '[1.0.0,1.0.0]',
                1,
                'any',
                createVersionRepoList(versioning.OSGI, '0.1.0', '1.0.0', '2.0.0', '2.1.0'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['1.0.0'])
        });

        it('should find higher version', function () {
            let selection = []
            selectVersion(
                versioning.OSGI,
                '[1,2)',
                1,
                'any',
                createVersionRepoList(versioning.OSGI, '0.1.0', '1.0.0', '1.1.1', '2.0.0', '2.1.0'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['1.1.1'])
        });

        it('should find 2 highest versions below 2.0.0', function () {
            let selection = []
            selectVersion(
                versioning.OSGI,
                '[1,2)',
                2,
                'any',
                createVersionRepoList(versioning.OSGI, '0.1.0', '1.0.0.RANDOM', '1.1.1.META', '1.2.0', '2.0.0.QUALIFier', '2.1.0'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['1.2.0', '1.1.1.META'])
        });

        it('should find 2 highest major versions >= 1', function () {
            let selection = []
            selectVersion(
                versioning.OSGI,
                '1',
                2,
                'major',
                createVersionRepoList(versioning.OSGI, '0.1.0', '1.0.0', '1.1.1', '1.2.0', '2.0.0', '2.1.0', '2.1.1'),
                entry => selection.push(entry.version),
                td.object()
            )
            expect(selection).to.have.members(['2.1.1', '1.2.0'])
        });
    })
});
