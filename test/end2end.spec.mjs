import {expect, use} from 'chai';
import * as td from 'testdouble';
import tdChai from 'testdouble-chai';
import chaiFiles from 'chai-files';
import finalhandler from 'finalhandler';
import http from 'http'
import serveStatic from 'serve-static';

import {mkdtemp, writeFile, copyFile, mkdir} from 'fs/promises';
import {join} from 'path';
import {tmpdir} from 'os';
import {spawn} from 'child_process'
import packageJson from '../package.json' with { type: "json" };
import {GenericContainerBuilder, Wait} from "testcontainers";

use(tdChai(td));
use(chaiFiles);
const file = chaiFiles.file;


async function observeAndLogStreams(process, name) {
    await new Promise((resolve, reject) => {
        process.on('error', reject);
        process.on('exit', (code, signal) => {
            if (code === 0) {
                return resolve();
            }
            if (signal) {
                return reject(new Error(`${name} terminated on ${signal}`))
            } else {
                return reject(new Error(`${name} terminated with exit code ${code}`))
            }
        });
        process.stdout.on('data', (data) => {
            console.log(`${name} stdout: ${data}`);
        });
        process.stderr.on('data', (data) => {
            console.log(`${name} stderr: ${data}`);
        });
    });
}

describe('Maven Content Extension', function () {

    const antoraVersions = [
        "3.0.1",
        "3.0.2",
        "3.0.3",
        "3.1.0",
        "3.1.1",
        "3.1.2",
        "3.1.3",
        "3.1.4",
        "3.1.5",
        "3.1.6",
        "3.1.7",
        "3.1.8",
        "3.1.9",
        "3.1.10",
    ];

    const extensionProjectDir = process.cwd();
    const packFileName = `kiwigrid-antora-maven-content-${packageJson.version}.tgz`

    let extensionTarball;
    let testTmpDir;
    let cacheDir;
    let siteDir;
    let mavenRepo;
    let antoraContainer;

    before(async function () {
        const tmpDir = await mkdtemp(join(tmpdir(), 'antora-mvn-content-pack'));
        await observeAndLogStreams(spawn(
            'npm',
            ['pack', '--pack-destination', `${tmpDir}`],
            {
            }
        ), `npm pack`);
        extensionTarball = `${tmpDir}/${packFileName}`;
    })

    beforeEach("create tmp folder and start maven repo", async function () {
        testTmpDir = await mkdtemp(join(tmpdir(), 'antora-mvn-content-tests-'));
        cacheDir = join(testTmpDir, '.cache');
        siteDir = join(testTmpDir, 'site');
        const serve = serveStatic('test/resources/maven-repo')
        mavenRepo = http.createServer(
            function onRequest(req, res) {
                serve(req, res, finalhandler(req, res))
            })
        // Listen
        await new Promise((resolve, reject) => {
            mavenRepo.on('error', e => reject(e));
            mavenRepo.on('listening', () => resolve());
            mavenRepo.listen(8991)
        })
    })

    afterEach("shutdown repo", async function () {
        await new Promise((resolve, reject) => {
            mavenRepo.close(e => e ? reject(e) : resolve());
        });
        await antoraContainer.stop();
    });

    antoraVersions.forEach((version) => {
        it(`works with antora ${version}`, async function () {
            this.timeout(200000)
            const testDockerFile = new Uint8Array(Buffer.from(`
FROM antora/antora:${version}
COPY ${packFileName} /
RUN yarn global add --ignore-engines /${packFileName}`));
            await writeFile(`${testTmpDir}/Dockerfile`, testDockerFile);
            await copyFile(extensionTarball, `${testTmpDir}/${packFileName}`);
            await mkdir(`${testTmpDir}/build`);
            const container = await new GenericContainerBuilder(testTmpDir, "Dockerfile").build()
            antoraContainer = await container
                .withBindMounts([
                    { source: `${process.cwd()}/test/resources/antora-playbook.yaml`, target: "/antora-playbook.yaml", mode: "ro"},
                    { source: `${testTmpDir}`, target: "/antora", mode: "Z"}
                ])
                .withLogConsumer(stream => {
                    stream.on("data", line => console.log(line));
                    stream.on("err", line => console.error(line));
                    stream.on("end", () => console.log(`Antora ${version} container log stream closed`));
                })
                .withNetworkMode("host")
                .withCommand(["--cache-dir=/antora/.cache/antora", "--to-dir=/antora/site", "/antora-playbook.yaml"])
                .withWaitStrategy(Wait.forOneShotStartup())
                .start();

            expect(file(join(siteDir, 'index.html'))).to.exist;
            expect(file(join(siteDir, 'test-component', 'index.html'))).to.exist;
            expect(file(join(siteDir, 'test-component', 'index.html')))
                .to.contain('Hello World from the test component.')
                .and.to.contain(`Antora ${version}`)
        })
    })

})
