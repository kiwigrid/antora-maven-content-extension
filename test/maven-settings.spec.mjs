import { expect, use } from 'chai';
import * as td from 'testdouble';
import tdChai  from 'testdouble-chai';
use(tdChai(td));
import fs from "fs";

import { MavenSettingsFile }  from "../lib/maven-files.js";
import { MavenRepository } from "../lib/maven-types.js";

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
            fs.readFileSync('test/resources/settings_with_exact_mirror_match_and_repositories_from_2_active_profiles.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectMirroredAndSecondRepo(repositories);
    });

    it('should respect exact exclusion mirror and repositories from 2 active profiles', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings_with_exact_exclusion_mirror_and_repositories_from_2_active_profiles.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectMirroredAndSecondRepo(repositories);
    });

    it('should respect single wildcard mirror and 2 repositories from 1 active profiles', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings_with_single_wildcard_mirror_and_2_repositories_from_1_active_profiles.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectSingleMirroredRepo(repositories);
    });

    it('should respect single wildcard mirror and repository from 1 active profile', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings_with_single_wildcard_mirror_and_repository_from_1_active_profile.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectSingleMirroredRepo(repositories);
    });

    it('should respect single wildcard mirror and repositories from 2 active profiles', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings_with_single_wildcard_mirror_and_repositories_from_2_active_profiles.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectSingleMirroredRepo(repositories);
    });

    it('should respect active by default profiles', function () {
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings_with_active_by_default_profiles.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectSingleMirroredRepo(repositories);
    });

    it('should resolve environment variables for username and password', function () {
        process.env.MAVEN_USER = "user";
        process.env.MAVEN_PASS = "pass";
        const settings = new MavenSettingsFile(
            fs.readFileSync('test/resources/settings_with_single_active_profile_and_repo_with_env_vars_in_server_credentials.xml'),
            logger
        )
        const repositories = settings.getActiveProfileRepositories();
        expectSingleMirroredRepo(repositories);
    });
});
