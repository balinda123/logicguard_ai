#!/usr/bin/env node
'use strict';

const { main } = require('./stagehand/worker');

if (process.argv[2] !== 'stagehand-worker') {
  process.stderr.write('LEGACY_SIDECAR_COMMAND_REMOVED\n');
  process.exitCode = 2;
} else {
  main().catch(() => {
    process.stderr.write('STAGEHAND_WORKER_START_FAILED\n');
    process.exitCode = 1;
  });
}
