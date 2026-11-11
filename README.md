# Create account

In order to run this script, you will need auth codes which we provide manually to volunteers with account credits.

Simply rename `config.example.js` to `config.js` and add account and relevant active keys and auth codes, which we will issue.

Run script every 10 or 20 minutes with cron task. It will create few pending accounts and exits automatically.

`yarn`

`node index.js`

## Recovery requests (optional)

Accounts you create name your creator account as their recovery account. `recover.js` lets you help those users get a hacked account back: it broadcasts `request_account_recovery` for requests that Ecency has already verified (the user proved an old owner key and confirmed a code sent to their signup email). The user then finishes the recovery on ecency.com with that old key. The script never sees user keys.

Ask Ecency for a worker token for your creator account, then set:

| Variable | Required | Meaning |
| --- | --- | --- |
| `RECOVERY_WORKER_TOKEN` | yes | Token issued by Ecency for your account |
| `RECOVERY_ACCOUNT` | if `config.js` lists more than one creator | Your creator account |
| `RECOVERY_ACTIVE_WIF` | no | Active key used to sign; if unset, the key for `RECOVERY_ACCOUNT` in `config.js` is used |
| `DRY_RUN` | no | `1` reads and logs decisions without broadcasting or reporting |
| `ONBOARD_URL` | no | Default `https://api.ecency.com` |
| `HIVE_NODES` | no | Comma list of Hive API nodes |
| `POLL_SECONDS` | no | Delay between passes in long running mode, default 15 |
| `MAX_PER_HOUR` | no | Broadcast limit per hour of running |

We recommend adding a dedicated extra key to your creator account's active authority for this and passing it as `RECOVERY_ACTIVE_WIF`, so you can revoke it on its own. The script checks at startup that the key can sign for the account. Start with `DRY_RUN=1` and check the log.

Run it as a service, with the variables in an env file only you can read:

```
[Service]
WorkingDirectory=/path/to/create-account
EnvironmentFile=/path/to/recover.env
ExecStart=/usr/bin/node recover.js
Restart=always
```

or from cron, one pass per run:

`*/5 * * * * cd /path/to/create-account && RECOVERY_WORKER_TOKEN=... node recover.js --once`

Tests: `yarn test`.
