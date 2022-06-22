require('dotenv').config()

const envToArray = (key, defaultValue) => {
  if (process.env[key]) {
    return process.env[key].split(',').map(item => item.trim())
  } else {
    return defaultValue
  }
}

module.exports = {
  account: process.env.GITHUB_ACCOUNT || 'JingBh',
  organizations: envToArray('GITHUB_ORGANIZATIONS', ['ChessTerm']),
  githubApp: {
    appId: process.env.GITHUB_APP_ID || 212691,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY
  }
}
