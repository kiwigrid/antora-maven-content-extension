import { expect, use } from 'chai';
import * as td from 'testdouble';
import tdChai from 'testdouble-chai';
use(tdChai(td));
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import process from 'process';
import { createRequire } from 'module';

// Use createRequire to load CJS modules from an ESM test file.
const require = createRequire(import.meta.url);

describe('MavenClient', function () {
    this.timeout(10000); // Set timeout for all tests in this suite
    let logger;
    let client;
    let MavenClient;
    let MavenRepository;
    let MavenArtifact;
    let fs, http, https, tar, unzip;

    // A helper to create a mock HTTP/HTTPS response stream
    function mockResponse(statusCode, headers = {}, body = '') {
        const response = new Readable();
        response.push(body);
        response.push(null); // end the stream
        response.statusCode = statusCode;
        response.headers = headers;
        return response;
    }

    // Helper to create a mock Writable stream for pipeline destinations
    function mockWritableStream() {
        return new Writable({
            write(chunk, encoding, callback) {
                callback(); // Discard the data
            },
            final(callback) {
                callback(); // Signal finish
            }
        });
    }

    beforeEach(function () {
        // Mock all dependencies BEFORE requiring the module under test
        fs = td.replace('fs');
        // Replace http/https with objects that have a mockable 'request' function.
        http = td.replace('http', { request: td.func('httpRequest') });
        https = td.replace('https', { request: td.func('httpsRequest') });

        const fakeTar = { extract: td.func() };
        tar = td.replace('tar', fakeTar);

        const fakeUnzip = { Extract: td.func() };
        unzip = td.replace('unzip-stream', fakeUnzip);

        // Clear the require cache
        delete require.cache[require.resolve('../lib/maven-client.js')];
        delete require.cache[require.resolve('../lib/maven-types.js')];

        // Require the CJS modules
        MavenClient = require('../lib/maven-client.js');
        const types = require('../lib/maven-types.js');
        MavenRepository = types.MavenRepository;
        MavenArtifact = types.MavenArtifact;

        logger = td.object(['debug', 'info', 'warn']);
        client = new MavenClient(logger);
    });

    afterEach(function () {
        td.reset();
    });

    describe('downloadAndExtract', function () {
        it('should handle tgz archives', async function () {
            const repository = new MavenRepository({ baseUrl: 'http://localhost' });
            const artifact = new MavenArtifact({ groupId: 'com.example', artifactId: 'dummy', version: '1.0.0', extension: 'tgz' });
            const response = mockResponse(200, {}, 'dummy-tgz-content');

            const requestStream = new EventEmitter();
            requestStream.end = td.func();

            td.when(http.request(td.matchers.anything(), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    callback(response);
                    return requestStream;
                });

            const fakeTarStream = mockWritableStream();
            td.when(tar.extract({ cwd: '/tmp' })).thenReturn(fakeTarStream);

            await client.downloadAndExtract(repository, '/tmp', artifact);

            td.verify(requestStream.end());
        });

        it('should throw an error for unsupported extensions', async function () {
            const repository = new MavenRepository({ baseUrl: 'http://localhost' });
            const artifact = new MavenArtifact({ groupId: 'com.example', artifactId: 'dummy', version: '1.0.0', extension: 'rar' });
            const response = mockResponse(200);

            const requestStream = new EventEmitter();
            requestStream.end = td.func();

            td.when(http.request(td.matchers.anything(), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    callback(response);
                    return requestStream;
                });

            try {
                await client.downloadAndExtract(repository, '/tmp', artifact);
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.contain('Unsupported extension: rar');
            }
        });

        it('should handle HTTP redirects', async function () {
            const repository = new MavenRepository({ baseUrl: 'http://localhost' });
            const artifact = new MavenArtifact({ groupId: 'com.example', artifactId: 'dummy', version: '1.0.0' });
            const redirectResponse = mockResponse(302, { location: 'http://localhost/redirected' });
            const finalResponse = mockResponse(200);

            const redirectRequestStream = new EventEmitter();
            redirectRequestStream.end = td.func();
            const finalRequestStream = new EventEmitter();
            finalRequestStream.end = td.func();

            td.when(http.request(td.matchers.contains({ path: '/com/example/dummy/1.0.0/dummy-1.0.0-docs.zip' }), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    callback(redirectResponse);
                    return redirectRequestStream;
                });

            td.when(http.request(td.matchers.contains({ path: '/redirected' }), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    callback(finalResponse);
                    return finalRequestStream;
                });

            const fakeUnzipStream = mockWritableStream();
            td.when(unzip.Extract({ path: '/tmp' })).thenReturn(fakeUnzipStream);

            await client.downloadAndExtract(repository, '/tmp', artifact);

            td.verify(redirectRequestStream.end());
            td.verify(finalRequestStream.end());
        });

        it('should handle relative path redirects', async function () {
            const repository = new MavenRepository({ baseUrl: 'http://localhost/some/path' });
            const artifact = new MavenArtifact({ groupId: 'com.example', artifactId: 'dummy', version: '1.0.0' });
            const redirectResponse = mockResponse(302, { location: '../redirected/path' }); // Relative redirect
            const finalResponse = mockResponse(200);

            const redirectRequestStream = new EventEmitter();
            redirectRequestStream.end = td.func();
            const finalRequestStream = new EventEmitter();
            finalRequestStream.end = td.func();

            td.when(http.request(td.matchers.contains({ path: '/some/path/com/example/dummy/1.0.0/dummy-1.0.0-docs.zip' }), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    callback(redirectResponse);
                    return redirectRequestStream;
                });

            // The second request should be to the correctly resolved relative path
            const expectedRedirectPath = '/some/path/com/example/dummy/redirected/path';
            td.when(http.request(td.matchers.contains({ host: 'localhost', path: expectedRedirectPath }), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    callback(finalResponse);
                    return finalRequestStream;
                });

            const fakeUnzipStream = mockWritableStream();
            td.when(unzip.Extract({ path: '/tmp' })).thenReturn(fakeUnzipStream);

            await client.downloadAndExtract(repository, '/tmp', artifact);

            td.verify(finalRequestStream.end());
        });

        it('should reject after too many redirects', async function () {
            const repository = new MavenRepository({ baseUrl: 'http://localhost' });
            const artifact = new MavenArtifact({ groupId: 'com.example', artifactId: 'dummy', version: '1.0.0' });
            const redirectResponse = mockResponse(302, { location: 'http://localhost/redirect' });

            const requestStream = new EventEmitter();
            requestStream.end = td.func();

            td.when(http.request(td.matchers.anything(), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    callback(redirectResponse);
                    return requestStream;
                });

            try {
                await client.downloadAndExtract(repository, '/tmp', artifact);
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.contain('Too many redirects');
            }
        });

        it('should reject on HTTP error during download', async function () {
            const repository = new MavenRepository({ baseUrl: 'http://localhost' });
            const artifact = new MavenArtifact({ groupId: 'com.example', artifactId: 'dummy', version: '1.0.0' });
            const errorResponse = mockResponse(404, {}, 'Not Found');

            const requestStream = new EventEmitter();
            requestStream.end = td.func();

            td.when(http.request(td.matchers.anything(), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    callback(errorResponse);
                    return requestStream;
                });

            try {
                await client.downloadAndExtract(repository, '/tmp', artifact);
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.contain('Failure downloading');
                expect(e.message).to.contain('(404)');
            }
        });

        it('should handle request errors', async function () {
            const repository = new MavenRepository({ baseUrl: 'http://localhost' });
            const artifact = new MavenArtifact({ groupId: 'com.example', artifactId: 'dummy', version: '1.0.0' });

            const requestStream = new EventEmitter();
            requestStream.end = td.func();

            td.when(http.request(td.matchers.anything(), td.matchers.isA(Function)))
                .thenDo((options, callback) => {
                    process.nextTick(() => requestStream.emit('error', new Error('ECONNRESET')));
                    return requestStream;
                });

            try {
                await client.downloadAndExtract(repository, '/tmp', artifact);
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.contain('Request to http://localhost');
                expect(e.message).to.contain('failed: ECONNRESET');
            }
        });
    });

    describe('retrieveAvailableVersions', function () {
        it('should use fallback when metadata download fails but artifact exists', async function () {
            const repository = new MavenRepository({ baseUrl: 'https://repo.example.com' });
            const metaDataResponse = mockResponse(404);
            const artifactProbeResponse = mockResponse(200);

            const metaDataRequest = new EventEmitter();
            metaDataRequest.end = td.func();
            const probeRequest = new EventEmitter();
            probeRequest.end = td.func();

            td.when(https.request(td.matchers.contains({ path: '/com/example/dummy/maven-metadata.xml' }), td.matchers.isA(Function)))
                .thenDo((opts, cb) => { cb(metaDataResponse); return metaDataRequest; });
            td.when(https.request(td.matchers.contains({ path: '/com/example/dummy/1.0.0/dummy-1.0.0-docs.zip' }), td.matchers.isA(Function)))
                .thenDo((opts, cb) => { cb(artifactProbeResponse); return probeRequest; });

            const versions = await client.retrieveAvailableVersions([repository], { sort: (v) => v.sort(), valid: () => true }, {
                groupId: 'com.example',
                artifactId: 'dummy',
                fallback: { version: '1.0.0', classifier: 'docs', extension: 'zip' }
            });

            expect(versions).to.have.lengthOf(1);
            expect(versions[0].version).to.equal('1.0.0');
        });

        it('should throw when metadata download fails and fallback probe also fails', async function () {
            const repository = new MavenRepository({ baseUrl: 'https://repo.example.com' });

            // 1. Mock the metadata download (GET) to fail with a 500 server error
            const metaDataResponse = mockResponse(500, {}, 'Internal Server Error');
            const metaDataRequest = new EventEmitter();
            metaDataRequest.end = td.func();
            td.when(https.request(td.matchers.contains({ method: 'GET', path: '/com/example/dummy/maven-metadata.xml' }), td.matchers.isA(Function)))
                .thenDo((opts, cb) => { cb(metaDataResponse); return metaDataRequest; });

            // 2. Mock the subsequent fallback artifact probe (HEAD) to fail with a 404
            const probeResponse = mockResponse(404);
            const probeRequest = new EventEmitter();
            probeRequest.end = td.func();
            td.when(https.request(td.matchers.contains({ method: 'HEAD', path: '/com/example/dummy/1.0.0/dummy-1.0.0-docs.zip' }), td.matchers.isA(Function)))
                .thenDo((opts, cb) => { cb(probeResponse); return probeRequest; });

            try {
                await client.retrieveAvailableVersions([repository], { sort: (v) => v.sort(), valid: () => true }, {
                    groupId: 'com.example',
                    artifactId: 'dummy',
                    fallback: { version: '1.0.0', classifier: 'docs', extension: 'zip' }
                });
                expect.fail('Should have thrown');
            } catch (e) {
                // After the metadata fails AND the fallback probe fails, this is the expected final error.
                expect(e.message).to.equal('Unable to find any version for com.example:dummy');
            }
        });
    });

    describe('#buildSnapshotUrl', function () {
        it('should throw if snapshot metadata is missing the required version', async function () {
            const repository = new MavenRepository({ baseUrl: 'http://localhost' });
            const artifact = new MavenArtifact({ groupId: 'com.example', artifactId: 'dummy', version: '1.0.0-SNAPSHOT', classifier: 'missing', extension: 'zip' });
            const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <versioning>
        <snapshotVersions>
            <snapshotVersion>
                <classifier>docs</classifier>
                <extension>zip</extension>
                <value>1.0.0-2022-1</value>
            </snapshotVersion>
        </snapshotVersions>
    </versioning>
</metadata>`;
            const response = mockResponse(200, {}, metadataXml);
            const requestStream = new EventEmitter();
            requestStream.end = td.func();

            td.when(http.request(td.matchers.anything(), td.matchers.isA(Function))).thenDo((opts, cb) => {
                cb(response);
                return requestStream;
            });

            try {
                await client.downloadAndExtract(repository, '/tmp', artifact);
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e.message).to.contain('Cannot find latest snapshot version info');
            }
        });
    });

    describe('findMavenSettingsFile', function () {
        let originalEnv;

        beforeEach(function () {
            originalEnv = { ...process.env };
            process.env.HOME = '/home/user';
            process.env.M2_HOME = '/opt/maven';
        });

        afterEach(function () {
            process.env = originalEnv;
        });

        it('should find settings in user home first', function () {
            td.when(fs.existsSync('/home/user/.m2/settings.xml')).thenReturn(true);
            const settingsFile = client.findMavenSettingsFile();
            expect(settingsFile).to.equal('/home/user/.m2/settings.xml');
        });

        it('should find settings in M2_HOME as a fallback', function () {
            td.when(fs.existsSync('/home/user/.m2/settings.xml')).thenReturn(false);
            td.when(fs.existsSync('/opt/maven/conf/settings.xml')).thenReturn(true);
            const settingsFile = client.findMavenSettingsFile();
            expect(settingsFile).to.equal('/opt/maven/conf/settings.xml');
        });

        it('should throw if no settings file is found', function () {
            td.when(fs.existsSync(td.matchers.anything())).thenReturn(false);
            expect(() => client.findMavenSettingsFile()).to.throw('Unable to find maven settings');
        });
    });

    describe('extractRepositoriesFromSettingsFile', function () {
        it('should return empty array if settings file does not exist', async function () {
            td.when(fs.existsSync('non-existent-file.xml')).thenReturn(false);
            const repos = await client.extractRepositoriesFromSettingsFile('non-existent-file.xml');
            expect(repos).to.be.an('array').that.is.empty;
            td.verify(logger.warn(td.matchers.contains('does not exist')));
        });
    });
});

