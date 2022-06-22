const { Signale, log } = require('signale')

const logger = new Signale({
  disabled: false,
  interactive: false,
  config: {
    displayTimestamp: true,
    displayDate: false
  },
  stream: process.stderr,
  scope: 'updater',
  types: {
    await: {
      badge: '…'
    },
    debug: {
      color: 'gray'
    }
  }
});

(() => {
  const loggerDebug = logger.debug
  logger.debug = (...args) => {
    if (process.env.NODE_ENV === 'development') {
      loggerDebug(...args)
    }
  }
})()

module.exports = logger
