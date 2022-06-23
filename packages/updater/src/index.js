const {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync
} = require('fs')
const { join, dirname } = require('path')

const { App } = require('octokit')
const { parse: parseYaml } = require('yaml')
const rimraf = require('rimraf')

const config = require('./config')
const logger = require('./logger')

logger.start('Updater started')

const outputDir = join(dirname(__dirname), 'output')
rimraf(outputDir, (err) => {
  if (!err) {
    logger.debug('Output directory cleared')
  }

  mkdirSync(outputDir)
});

// main
(async function () {
  const result = { organizations: [] }

  const app = new App(config.githubApp)

  logger.await('Checking app installations')
  for await (const { octokit, installation } of app.eachInstallation.iterator()) {
    const accName = installation.account.login
    const accType = installation.account.type
    const accLogger = logger.scope('updater', accName)

    const accInfo = {
      name: installation.account.login,
      avatar: installation.account.avatar_url,
      url: installation.account.html_url,
      repos: []
    }

    if (config.account === accName) {
      logger.info(`Found user account @${accName}`)
      result.account = accInfo
    } else if (accType === 'Organization') {
      if (config.organizations.indexOf(accName) === -1) {
        logger.debug(`Skipping organization ${accName} according to config`)
        continue
      }

      logger.info(`Found organization @${accName}`)
      result.organizations.push(accInfo)
    }

    accLogger.await('Checking repositories')
    const reposIterator = octokit.paginate.iterator(
      accType === 'User' ? octokit.rest.repos.listForUser : octokit.rest.repos.listForOrg,
      {
        username: accType === 'User' ? accName : undefined,
        org: accType === 'Organization' ? accName : undefined
      }
    )

    for await (const { data: repos } of reposIterator) {
      for (repo of repos) {
        const repoName = repo.name

        if (repo.private) {
          accLogger.debug(`Skipping private repository ${repoName}`)
          continue
        }

        const overrideDir = join(dirname(__dirname), 'overrides', accName, repoName)
        if (existsSync(join(overrideDir, 'ignore'))) {
          accLogger.debug(`Skipping repository ${repoName} as it's ignored`)
          continue
        }

        if (accType === 'Organization') {
          accLogger.debug(`Checking permissions of repository ${repoName}`)
          const { data: { permission } } = await octokit.rest.repos.getCollaboratorPermissionLevel({
            owner: accName,
            repo: repoName,
            username: config.account
          })

          if (permission !== 'admin' && permission !== 'write') {
            accLogger.debug(`Skipping inaccessible repository ${repoName}`)
            continue
          }
        }

        accLogger.info(`Found repository ${repoName}`)
        const repoInfo = {
          meta: {
            name: repoName,
            forkOf: null,
            isVariant: false,
            isArchived: repo.archived,
            stargazers: repo.stargazers_count,
            forks: repo.forks
          },
          url: repo.clone_url,
          description: repo.description
        }

        if (repo.homepage) { repoInfo.landingURL = repo.homepage }
        if (repo.fork) {
          accLogger.debug(`Checking parent of repository ${repoName}`)
          const parentData = (await octokit.graphql(`
            query($accName: String!, $repoName: String!) {
              repository(owner: $accName, name: $repoName) {
                parent {
                  name
                  owner {
                    login
                  }
                  url
                }
              }
            }
          `, {
            accName,
            repoName
          })).repository.parent

          repoInfo.meta.forkOf = { owner: parentData.owner.login, name: parentData.name }
          repoInfo.isBasedOn = parentData.url + '.git'
        }

        accLogger.debug(`Checking tags of repository ${repoName}`)
        const tagData = (await octokit.graphql(`
          query($accName: String!, $repoName: String!) {
            repository(owner: $accName, name: $repoName) {
              refs(first: 1, refPrefix: "refs/tags/", orderBy: {
                field: TAG_COMMIT_DATE,
                direction: DESC
              }) {
                nodes {
                  name
                  target {
                    ... on Commit {
                      committedDate
                    }
                  }
                }
              }
            }
          }
        `, {
          accName,
          repoName
        })).repository.refs.nodes
        if (tagData.length > 0) {
          repoInfo.softwareVersion = tagData[0].name[0] === 'v' ?
            tagData[0].name.substring(1) :
            tagData[0].name
          repoInfo.releaseDate = tagData[0].target.committedDate
        }

        if (repo.archived) { repoInfo.developmentStatus = 'obsolete' }

        if (repo.description) {
          repoInfo.description = {
            en: {
              shortDescription: repo.description
            }
          }
        }

        if (repo.license) {
          repoInfo.legal = {
            license: repo.license.spdx_id
          }
        }

        let hasManifest = false

        accLogger.debug(`Looking for manifest in repository ${repoName}`)
        try {
          const { data } = await octokit.rest.repos.getContent({
            mediaType: {
              format: 'raw'
            },
            owner: accName,
            repo: repoName,
            path: 'publiccode.yml'
          })

          Object.assign(repoInfo, parseYaml(data))

          hasManifest = true
        } catch (e) {
          accLogger.debug(`No manifest found in repository ${repoName}`)
        }

        try {
          Object.assign(repoInfo, parseYaml(readFileSync(join(overrideDir, 'override.yml'), 'utf8')))
          accLogger.debug(`Found override for repository ${repoName}`)

          hasManifest = true
        } catch (e) {}

        if (hasManifest) {
          if (repo.fork) {
            repoInfo.meta.isVariant = repoInfo.url === repo.clone_url
          } else {
            repoInfo.meta.isVariant = !!repoInfo.isBasedOn
          }
        }

        accInfo.repos.push(repoInfo)
      }
    }
  }

  return result
})().then((result) => {
  logger.success('Updater finished')

  logger.info('Writing results')
  writeFileSync(
    join(outputDir, 'index.json'),
    JSON.stringify(result, null, 2),
    'utf8'
  )
}).catch(e => {
  logger.fatal(e)
})
