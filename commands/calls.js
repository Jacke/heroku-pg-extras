'use strict'

const co = require('co')
const cli = require('heroku-cli-util')
const pg = require('@heroku-cli/plugin-pg-v5')
const util = require('../lib/util')

function * run (context, heroku) {
  let db = yield pg.fetcher(heroku).database(context.app, context.args.database)

  yield util.ensurePGStatStatement(db)

  let truncatedQueryString = context.flags.truncate
    ? 'CASE WHEN length(query) <= 40 THEN query ELSE substr(query, 0, 39) || \'…\' END'
    : 'query'

  let newTotalExecTimeFieldQuery = `SELECT current_setting('server_version_num')::numeric >= 130000`
  let newTotalExecTimeFieldRaw = yield pg.psql.exec(db, newTotalExecTimeFieldQuery)

  // error checks
  let newTotalExecTimeField = newTotalExecTimeFieldRaw.split("\n")
  if (newTotalExecTimeField.length != 6) {
    throw new Error(`Unable to determine database version`)
  }
  newTotalExecTimeField = newTotalExecTimeFieldRaw.split("\n")[2].trim()

  if (newTotalExecTimeField != "t" && newTotalExecTimeField != "f") {
    throw new Error(`Unable to determine database version, expected "t" or "f", got: "${newTotalExecTimeField}"`)
  }

  let totalExecTimeField = ``
  if (newTotalExecTimeField == "t") {
    totalExecTimeField = "total_exec_time"
  } else {
    totalExecTimeField = "total_time"
  }

  let query = `
SELECT ${truncatedQueryString} AS qry,
interval '1 millisecond' * ${totalExecTimeField} AS exec_time,
to_char((${totalExecTimeField}/sum(${totalExecTimeField}) OVER()) * 100, 'FM90D0') || '%'  AS prop_exec_time,
to_char(calls, 'FM999G999G990') AS ncalls,
interval '1 millisecond' * (blk_read_time + blk_write_time) AS sync_io_time
FROM pg_stat_statements WHERE userid = (SELECT usesysid FROM pg_user WHERE usename = current_user LIMIT 1)
ORDER BY calls DESC LIMIT 10
`

  let output = yield pg.psql.exec(db, query)
  process.stdout.write(output)
}

const cmd = {
  topic: 'pg',
  description: 'show 10 queries that have longest execution time in aggregate',
  needsApp: true,
  needsAuth: true,
  args: [{name: 'database', optional: true}],
  flags: [
    {name: 'truncate', char: 't', description: 'truncate queries to 40 characters'}
  ],
  run: cli.command({preauth: true}, co.wrap(run))
}

module.exports = [
  Object.assign({command: 'calls'}, cmd)
]
