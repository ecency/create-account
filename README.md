# Create account

In order to run this script, you will need auth codes which we provide manually to volunteers with account credits.

Simply rename `config.example.js` to `config.js` and add account and relevant active keys and auth codes, which we will issue.

Run script every 10 or 20 minutes with cron task. It will create few pending accounts and exits automatically.

`yarn`

`node index.js`

## Recovery requests (optional)

Accounts you create name your creator account as their recovery account. `recover.js` lets you help those users get a hacked account back: it broadcasts `request_account_recovery` for requests that Ecency has already verified (the user proved an old owner key and confirmed a code sent to their signup email). The user then finishes the recovery on ecency.com with that old key. The script never sees user keys.

It needs Node 18 or newer and reaches Ecency through the public API (`https://api.ecency.com`), so no extra network setup is needed.

Ask Ecency for a worker token for your creator account, then put the settings in an env file, for example `recover.env`, readable only by you (`chmod 600 recover.env`):

```
RECOVERY_WORKER_TOKEN=...
RECOVERY_ACCOUNT=youraccount
DRY_RUN=1
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `RECOVERY_WORKER_TOKEN` | yes | Token issued by Ecency for your account |
| `RECOVERY_ACCOUNT` | if `config.js` lists more than one creator | Your creator account |
| `RECOVERY_ACTIVE_WIF` | no | Active key used to sign; if unset, the key for `RECOVERY_ACCOUNT` in `config.js` is used |
| `DRY_RUN` | no | `1` reads and logs decisions without broadcasting or reporting |
| `ONBOARD_URL` | no | Default `https://api.ecency.com`; must be https |
| `HIVE_NODES` | no | Comma list of Hive API nodes |
| `POLL_SECONDS` | no | Delay between passes in long running mode, default 15, at most 3600 |
| `MAX_PER_HOUR` | no | Broadcast limit per hour of running |

We recommend adding a dedicated extra key to your creator account's active authority for this and passing it as `RECOVERY_ACTIVE_WIF`, so you can revoke it on its own. The script checks at startup that the key can sign for the account. Requests for any other recovery account are skipped and logged as an error; if you see that, `RECOVERY_ACCOUNT` and the token do not belong together. Start with `DRY_RUN=1`, check the log, then remove it.

Recommended: run it as a long running service.

```
[Service]
WorkingDirectory=/path/to/create-account
EnvironmentFile=/path/to/create-account/recover.env
ExecStart=/usr/bin/node recover.js
Restart=always
```

Fallback: cron, one pass per run. Keep the token out of the crontab and the command line:

`*/5 * * * * cd /path/to/create-account && node --env-file=recover.env recover.js --once`

(`--env-file` needs Node 20.6+; on Node 18 use `set -a; . ./recover.env; set +a; node recover.js --once`.) With `--once` the per-hour limit and the retry counters for failed reads and broadcasts start fresh on every run, which is why the service mode is preferred.

Tests: `yarn test`.
