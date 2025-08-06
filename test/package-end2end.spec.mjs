import { expect, use } from 'chai';
import * as td from 'testdouble';
import tdChai  from 'testdouble-chai';
use(tdChai(td));
import chaiFiles from 'chai-files';
use(chaiFiles);
const file = chaiFiles.file;
import finalhandler from 'finalhandler';
import http from 'http'
import serveStatic from 'serve-static';

import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process'


describe('Maven Content Extension', function () {

    const antoraVersions = [
        ["3.0.1", 'antoracli-301', 'antoragen-301'],
        ["3.0.2", 'antoracli-302', 'antoragen-302'],
        ["3.0.3", 'antoracli-303', 'antoragen-303'],
        ["3.1.0", 'antoracli-310', 'antoragen-310'],
        ["3.1.1", 'antoracli-311', 'antoragen-311'],
        ["3.1.2", 'antoracli-312', 'antoragen-312'],
        ["3.1.3", 'antoracli-313', 'antoragen-313'],
        ["3.1.4", 'antoracli-314', 'antoragen-314'],
        ["3.1.5", 'antoracli-315', 'antoragen-315'],
        ["3.1.6", 'antoracli-316', 'antoragen-316'],
        ["3.1.7", 'antoracli-317', 'antoragen-317'],
        ["3.1.8", 'antoracli-318', 'antoragen-318'],
        ["3.1.9", 'antoracli-319', 'antoragen-319'],
        ["3.1.10", 'antoracli-3110', 'antoragen-3110']
    ];

    let testTmpDir;
    let cacheDir;
    let siteDir;
    let mavenRepo;

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
    });

    antoraVersions.forEach(([name, antoraModule, generatorModule]) => {
        it(`works with antora package ${name}`, async function () {
            this.timeout(10000)

            const antoraProcess = spawn(
                `node_modules/${antoraModule}/bin/antora`,
                 [  '--stacktrace',
                    'generate',
                    `--cache-dir=${cacheDir}`,
                    `--to-dir=${siteDir}`,
                    `--generator=${generatorModule}`,
                    'test/resources/antora-playbook.yaml'
                ]
            );
            await new Promise((resolve, reject) => {
                antoraProcess.on('error', reject);
                antoraProcess.on('exit', (code, signal) => {
                    if (code === 0) {
                        return resolve();
                    }
                    if (signal) {
                        return reject(new Error(`Terminated on ${signal}`))
                    } else {
                        return reject(new Error(`Terminated with exit code ${code}`))
                    }
                });
                antoraProcess.stdout.on('data',  (data) => {
                    console.log(`antora ${name} stdout: ${data}`);
                });
                antoraProcess.stderr.on('data',  (data) => {
                    console.log(`antora ${name} stderr: ${data}`);
                });
            });

            expect(file(join(siteDir, 'index.html'))).to.exist;
            expect(file(join(siteDir, 'test-component', 'index.html'))).to.exist;
            expect(file(join(siteDir, 'test-component', 'index.html')))
                .to.contain('Hello World from the test component.')
                .and.to.contain(`Antora ${name}`)
        })
    })

})
