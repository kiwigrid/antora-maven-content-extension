const chai = require('chai');
const expect = chai.expect
global.td = require('testdouble')
const tdChai = require('testdouble-chai');
chai.use(tdChai(td));
const chaiFiles = require('chai-files');
chai.use(chaiFiles);
const file = chaiFiles.file;
const dir = chaiFiles.dir;
const nock = require('nock')

const { mkdtemp } = require('fs/promises');
const { join } = require('path');
const { tmpdir } = require('os');


describe('Maven Content Extension', function() {

    const scope = nock('https://maven.example.com')
        .get('/com/example/module/maven-metadata.xml')
        .replyWithFile(200, 'test/resources/artifact-metadata01.xml' ,{'Content-Type':'application/xml'})
        .get('/com/example/module/10.0.0/module-10.0.0-docs.zip')
        .replyWithFile(200, 'test/resources/example-component.zip')
    ;

    const antoraVersions = [
        ["3.0.1", require('antoracli-301'), 'antoragen-301']
    ];

    let testTmpDir;
    let cacheDir;
    let siteDir;

    beforeEach("create tmp folder", async function() {
        testTmpDir = await mkdtemp(join(tmpdir(), 'antora-mvn-content-tests-'));
        cacheDir = join(testTmpDir, '.cache');
        siteDir = join(testTmpDir, 'site');
    })

    antoraVersions.forEach(([name, run_func, gen]) => {
        it(`works with antora ${name}`, async function() {
            this.timeout(10000)
            await run_func([
                '--stacktrace',
                'generate',
                `--cache-dir=${cacheDir}`,
                `--to-dir=${siteDir}`,
                `--generator=${gen}`,
                'test/resources/antora-playbook.yaml']);
            expect(file(join(siteDir, 'index.html'))).to.exist;
            expect(file(join(siteDir, 'test-component', 'index.html'))).to.exist;
            expect(file(join(siteDir, 'test-component', 'index.html'))).to.contain('Hello World from the test component.')
        })
    })

})
