# Antora Maven Content Source Extension

This extension allows [Antora](https://docs.antora.org/antora/3.0/) to retrieve content from maven coordinates in addition to git repositories.
If parts of the documentation are generated or post-processed it's usually more convenient to package and publish the docs to a maven repository instead of making the build commit generated files into a git repo.
Also, it's probably more common for Java hackers to refer to published artifacts than to git repos.

WARNING: This extension expects maven artifacts to be versioned according to [SemVer](https://www.npmjs.com/package/semver)

## Usage

Publish an artifact (`zip`, `jar` and `tgz` supported) to a maven repository. Make sure the archive content adheres to
the [antora folder structure](https://docs.antora.org/antora/3.0/standard-directories/) (somewhere, since start paths
are supported, too).

Make sure it's available for antora (i.e. installed globally or along the playbook):

```shell
npm i @kiwigrid/antora-maven-content
```
Then add the extension to the playbook:

```yaml
antora:
  extensions:
    - require: "@kiwigrid/antora-maven-content"
      mavenSettings: true                  # defaults to false, true resolves to '$HOME/.m2/settings.xml' or '$M2_HOME/conf/settings.xml', a string is taken as is
      repositories: # optional
        - baseUrl: https://www.example.com # required
          fetchOptions: # optional
            headers:
              "Authorization": "Basic <base64 encoded user:password>"
      sources:
        - groupId: "com.example"      # required
          artifactId: "antora-module" # required
          version: "1.x.x"            # defaults to '*'
          limit: 3                    # defaults to 1
          limitBy: minor              # defaults to 'major', one of 'major', 'minor', 'patch', 'any'
          includeSnapshots: true      # defaults to false, true has no effect if includePrerelease is false as SNAPSHOTS are SemVer pre releases
          includePrerelease: true     # defaults to true
          classifier: ""              # defaults to 'docs'
          extension: "tgz"            # defaults to 'zip'
          startPath: ~                # defaults to null
          startPaths: "docs/*"        # defaults to null
# ...
```

With above example configuration the extension is going to download all available versions for `com.example:antora-module` and picks the 3 highest versions which:

* match the [SemVer Range](https://www.npmjs.com/package/semver#user-content-ranges) `1.x.x`
* do not equal an already picked version when reduced to the `minor` version
* for example:

    | Available Versions | Picked Versions |
    | --- | ---
    | 0.9.0 | 1.0.2
    | 0.9.1 | 1.1.0
    | 0.9.2 | 1.2.1
    | 1.0.0 |
    | 1.0.1 |
    | 1.0.2 |
    | 1.1.0 |
    | 1.2.0 |
    | 1.2.1 |
    | 2.0.0 |

For each picked version a corresponding playbook content source entry is created which:

* points to a local transient cached on-demand git repository the artifact has been extracted to
* is configured with the same [start path(s)](https://docs.antora.org/antora/3.0/playbook/content-source-start-paths/)

### Maven `settings.xml`

If `mavenSettings` is given a maven settings.xml is parsed for repositories and authentication data. The value of the
option can be `true` to use `$HOME/.m2/settings.xml` or `$M2_HOME/conf/settings.xml` or a string pointing to a settings
file. Only repositories of profiles which are active by default are extracted, mirrors are properly resolved.

## Contributions

[Are welcome!](CONTRIBUTING.md)
