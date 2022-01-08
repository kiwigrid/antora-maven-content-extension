const chai = require('chai');
const expect = chai.expect
global.td = require('testdouble')
const tdChai = require('testdouble-chai');
chai.use(tdChai(td));
const fs = require("fs")

const {MavenMetaDataFile} = require("../lib/maven-files");

describe('maven metadata handling', function () {

    let logger;

    beforeEach(function () {
        logger = td.object(['debug', 'info', 'warn', 'get']);
        td.when(logger.get(td.matchers.anything())).thenReturn(logger);
    })

    it('should find all versions', function () {
        const metaDataFile = new MavenMetaDataFile(
            fs.readFileSync('test/resources/artifact-metadata01.xml'),
            logger
        )
        expect(metaDataFile.getVersions()).to.have.members(['10.1.0-SNAPSHOT', '10.0.0', '9.9.9', '9.9.9-SNAPSHOT', '8.0.0'])
    });

    it('should find snapshot version for an artifact', function () {
        const metaDataFile = new MavenMetaDataFile(
            fs.readFileSync('test/resources/snapshot-metadata01.xml'),
            logger
        )
        expect(metaDataFile.getLatestSnapshotVersion('docs', 'zip')).to.equal('10.1.0-20211020154515-20211020.154121-1')
    });
});
