const chai = require('chai');
const expect = chai.expect
global.td = require('testdouble')
const tdChai = require('testdouble-chai');
chai.use(tdChai(td));
const fs = require("fs")

const {MavenSettingsFile} = require("../lib/maven-files");
const {MavenRepository} = require("../lib/maven-types");

const USER_PASS_BASIC_AUTH_HEADERS = {
    Authorization: 'Basic ' + Buffer.from('user:pass', 'utf-8').toString('base64')
}

function expectMirroredAndSecondRepo(repositories) {
    expect(repositories).to.have.lengthOf(2);
    expect(repositories[0]).to.be.instanceof(MavenRepository).and.to.deep.equal({
        baseUrl: 'https://repo.example.com',
        fetchOptions: {headers: USER_PASS_BASIC_AUTH_HEADERS}
    })
    expect(repositories[1]).to.be.instanceof(MavenRepository).and.to.deep.equal({
        baseUrl: 'http://central2',
        fetchOptions: {}
    });
}

function expectSingleMirroredRepo(repositories) {
    expect(repositories).to.have.lengthOf(1);
    expect(repositories[0]).to.be.instanceof(MavenRepository).and.to.deep.equal({
        baseUrl: 'https://repo.example.com',
        fetchOptions: {headers: USER_PASS_BASIC_AUTH_HEADERS}
    })
}

describe('maven settings repository extraction', function () {

    let logger;

    beforeEach(function () {
        logger = td.object(['debug', 'info', 'warn']);
    })

    it('should respect exact mirror match and repositories from 2 active profiles', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings05.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectMirroredAndSecondRepo(repositories);
    });

    it('should respect exact exclusion mirror and repositories from 2 active profiles', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings04.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectMirroredAndSecondRepo(repositories);
    });

    it('should respect single wildcard mirror and 2 repositories from 1 active profiles', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings01.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectSingleMirroredRepo(repositories);
    });

    it('should respect single wildcard mirror and repository from 1 active profile', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings02.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectSingleMirroredRepo(repositories);
    });

    it('should respect single wildcard mirror and repositories from 2 active profiles', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings03.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectSingleMirroredRepo(repositories);
    });
});
