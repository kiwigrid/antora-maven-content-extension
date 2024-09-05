import { expect, use } from 'chai';
import * as td from 'testdouble';
import tdChai  from 'testdouble-chai';
use(tdChai(td));

let MavenContentSourceExtension, mavenTypes, MavenClient, MavenContentSource, ContentSourceFactory;

describe('antora maven content extension', function () {

    beforeEach(async function () {
        mavenTypes = td.replace('../lib/maven-types')
        MavenClient = td.replace('../lib/maven-client')
        MavenContentSource = td.replace('../lib/maven-content-source', td.constructor(['toString', 'addAsSourceToPlaybook']))
        ContentSourceFactory = td.replace('../lib/content-source-factory')
        MavenContentSourceExtension = (await import('../lib/extension.js')).default
    })

    afterEach(function () {
        td.reset()
    })

    describe('#register', function () {
        it('should be exported', function () {
            expect(MavenContentSourceExtension).to.be.a('function');
            expect(MavenContentSourceExtension.register).to.be.a('function');
        });

        it('should register for "playbookBuilt" event', function () {
            const fakeContext = td.object(['on', 'getLogger', 'require']);
            const fakeConfig = {};
            const onBuiltCaptor = td.matchers.captor()

            MavenContentSourceExtension.register.bind(fakeContext)(fakeContext, fakeConfig);

            expect(fakeContext.on).to.have.been.calledWith('playbookBuilt', onBuiltCaptor.capture());
            expect(onBuiltCaptor.value).to.be.a('function');
        });
    })

    describe('#onPlaybookBuilt', function () {
        let fakeContext;
        let fakeLogger;

        beforeEach(function () {
            fakeContext = td.object(['on', 'getLogger', 'require', 'updateVariables']);
            fakeLogger = td.object();
            td.when(fakeContext.getLogger(td.matchers.anything())).thenReturn(fakeLogger);
        })

        function expectVarUpdate() {
            const varsCaptor = td.matchers.captor();
            expect(fakeContext.updateVariables).to.have.been.calledWith(varsCaptor.capture());
            return varsCaptor.value;
        }

        it('should not modify playbook if there\'s no config', async function () {
            const fakeConfig = {};
            const playbook = {env: {}};
            const extension = new MavenContentSourceExtension(fakeContext, fakeConfig);

            await extension.onPlaybookBuilt({playbook})

            const updatedVars = expectVarUpdate();
            expect(updatedVars).to.deep.equal({playbook});
        });

        it('should produce maven content sources via factory', async function () {
            const fakeConfig = {
                repositories: [
                    {
                        baseUrl: 'http://localhost'
                    }
                ],
                sources: [
                    {
                        artifactId: 'dummy',
                        groupId: 'test',
                        version: '1.0.0'
                    }
                ]
            };
            const playbook = {env: {}};
            const extension = new MavenContentSourceExtension(fakeContext, fakeConfig);

            await extension.onPlaybookBuilt({playbook})

            expect(extension.contentSourceFactory.produceContentSourcesIntoPlaybook).to.have.been.called;
            const updatedVars = expectVarUpdate();
            expect(updatedVars).to.deep.equal({playbook});
        })
    })
});
