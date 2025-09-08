const dhive = require('@hiveio/dhive');
const axios = require('axios');

const config = require('./config.js');

const {creators, privateKeys, authCodes, delegate, premiumAccounts, walletAccounts} = config;

//connect to rpc
const client = new dhive.Client(['https://hive-api.arcange.eu','https://techcoderx.com','https://api.deathwing.me', 'https://api.openhive.network', 'https://api.c0ff33a.uk'], {
    timeout: 4000,
    failoverThreshold: 20,
    consoleOnFailover: true,
  });

const isEmpty = (obj) => {
    return Object.keys(obj).length === 0;
}
const sleep = (ms) => {
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    });
}

let confirmAccounts = [];
const getPendingAccounts = async (creator) => {
    try {
        const resp = await axios.get(`https://api.esteem.app/api/signup/pending-accounts?creator=${creator}`);
        return Array.isArray(resp.data) ? resp.data : [];
    } catch (err) {
        console.error("Error fetching pending accounts:", err);
        return [];
    }
}

const getPremiumAccounts = async (creator) => {
    try {
        const resp = await axios.get(`https://api.esteem.app/api/signup/pending-paid-accounts?creator=${creator}`);
        return Array.isArray(resp.data) ? resp.data : [];
    } catch (err) {
        console.error("Error fetching Premium pending accounts:", err);
        return [];
    }
}
const getWalletAccounts = async (creator) => {
    try {
        const resp = await axios.get(`https://api.esteem.app/api/signup/pending-wallet-accounts?creator=${creator}`);
        return Array.isArray(resp.data) ? resp.data : [];
    } catch (err) {
        console.error("Error fetching Wallet pending accounts:", err);
        return [];
    }
}
const updPremiumExist = (data) => axios.put(`https://api.esteem.app/api/signup/paid-account-exist`, data);
const updWalletExist = (data) => axios.put(`https://api.esteem.app/api/signup/exist-wallet-accounts`, data);
const updAccountExist = (data) => axios.put(`https://api.esteem.app/api/signup/account-exist`, data);

const pendingPremium = async () => {
    console.log('Premium, UTC: ', new Date().toUTCString());
    let pracs = await getPremiumAccounts(authCodes[0]);
    if (pracs && pracs.length>0) {
        for (let index = 0; index < pracs.length; index++) {
            const accSearch = pracs[index].username;
            let valid = await validateAccount(pracs[index], true);
            if (accSearch.length > 2) {
                console.log(`checking:`, accSearch);
                if (valid) {
                    await createAccount(pracs[index], true);
                    await sleep(3000);
                }
                else {
                    //await updPremiumExist({username: accSearch, creator: authCodes[0]});
                    console.log(`error happened premium, ${accSearch} exist`);
                }
            }
        }
    } else {
        console.log(new Date().toUTCString(), ' exiting, no pending signups');
        if (confirmAccounts.length == 0) {
            await sleep(3000);
            process.exit()
        }
    }
}

const pendingWallet = async () => {
    console.log('Wallet, UTC: ', new Date().toUTCString());
    let walacs = await getWalletAccounts(authCodes[0]);
    if (walacs && walacs.length>0) {
        for (let index = 0; index < walacs.length; index++) {
            const accSearch = walacs[index].username.toLowerCase();
            let valid = await validateAccount(walacs[index], false, true);
            if (accSearch.length > 2) {
                console.log(`checking:`, accSearch);
                if (valid) {
                    await createAccount(walacs[index], false, true);
                    await sleep(3000);
                }
                else {
                    //await updPremiumExist({username: accSearch, creator: authCodes[0]});
                    console.log(`error happened wallet, ${accSearch} exist`);
                }
            }
        }
    } else {
        console.log(new Date().toUTCString(), ' exiting, no pending signups');
        if (confirmAccounts.length == 0) {
            await sleep(3000);
            process.exit()
        }
    }
}

const pendingFree = async () => {
    console.log('Free, UTC: ', new Date().toUTCString());
    let pacs = await getPendingAccounts(authCodes[0]);

    //console.log('pending accounts', pacs);
    if (pacs && pacs.length>0) {
        for (let index = 0; index < pacs.length; index++) {
            const accSearch = pacs[index].username;
            let valid = await validateAccount(pacs[index]);
            if (accSearch.length > 2) {
                console.log(`checking:`, accSearch);
                if (valid) {
                    await createAccount(pacs[index]);
                    await sleep(3000);
                }
                else {
                    //await updAccountExist({username: accSearch, creator: authCodes[0]});
                    console.log(`error happened, ${accSearch} exist`);
                }
            }
        }
    } else {
        console.log(new Date().toUTCString(), ' exiting, no pending signups');
        if (confirmAccounts.length == 0) {
            await sleep(3000);
            process.exit()
        }
    }
};

//create with RC function
const createAccount = async (user, premium=false, wallet = false) => {
    let creator = "";
    let ind = -1;
    let PKey = "";
    let acode = "";

    const creatorsStat = await client.database.call('get_accounts', [
        creators
    ]);
    for (let index = 0; index < creatorsStat.length; index++) {
        const element = creatorsStat[index];
        if (element.pending_claimed_accounts > 0) {
            ind = index;
            break;
        }
    }
    if (ind !== -1) {
        creator = creators[ind];
        PKey = privateKeys[ind];
        acode = authCodes[ind];

        user.username = user.username.toLowerCase();
        const username = user.username;
        //pub keys

        if (wallet) {
            user.update_code = user.id;
            user.owner = user.meta.ownerPublicKey;
            user.active = user.meta.activePublicKey;
            user.posting = user.meta.postingPublicKey;
            user.memo = user.meta.memoPublicKey;
        }
        const update_code = user.update_code;
        const memoKey = user.memo;
        const ownerAuth = {
            weight_threshold: 1,
            account_auths: [],
            key_auths: [[user.owner, 1]],
        };
        const activeAuth = {
            weight_threshold: 1,
            account_auths: [],
            key_auths: [[user.active, 1]],
        };
        const postingAuth = {
            weight_threshold: 1,
            account_auths: [['ecency.app', 1]],
            key_auths: [[user.posting, 1]],
        };

        //private active key of creator account

        const privateKey = dhive.PrivateKey.fromString(
            PKey
        );

        let ops = [];

        //create operation to transmit
        const create_op = [
            'create_claimed_account',
            {
                creator: creator,
                new_account_name: username,
                owner: ownerAuth,
                active: activeAuth,
                posting: postingAuth,
                memo_key: memoKey,
                json_metadata: '',
                extensions: [],
            },
        ];
        ops.push(create_op);
        if (parseFloat(delegate) > 0) {
            const delegate_op = [
                'delegate_vesting_shares',
                {
                    delegator: creator,
                    delegatee: username,
                    vesting_shares: delegate //9500.123456 VESTS ~5HP or 19000.246912 VESTS ~10HP
                },
            ];
            ops.push(delegate_op);
        }
        if (premium) {
            const point_transfer = {
                id: "ecency_point_transfer",
                required_auths: [creator],
                required_posting_auths: [],
                json: JSON.stringify({"sender":creator,"receiver":username,"amount":"300.000 POINT","memo":"Premium bonus"})
            };
            ops.push(["custom_json", point_transfer]);
        }
        console.log(`attempting to create account: ${username} with ${creator}`);

        //broadcast operation to blockchain
        try {
            let result = await client.broadcast.sendOperations(ops, privateKey);
            if (result && result.id) {
                confirmAccounts.push(username);
                if (premium) {
                    const params = {
                        id: "rc",
                        required_auths: [],
                        required_posting_auths: [creator],
                        json: JSON.stringify(["delegate_rc",{"from":creator,"delegatees":[username],"max_rc":15000000000}])
                    };
                    client.broadcast.sendOperations([['custom_json', params]], privateKey).then(
                        function(result) {
                            if (result && result.id) {
                                console.log('RC delegated');
                            } else {
                                console.log(JSON.stringify(result))
                            }
                    });
                }
                if (wallet) {
                    axios.put(`https://api.esteem.app/api/signup/pending-wallet-accounts`,
                        {
                            id: update_code,
                            creator: acode
                        }
                    )
                        .then(resp => {
                            if (isEmpty(resp.data)) {
                                console.log(`verified creation: ${username}`);
                            }
                        }).catch(e => {
                        console.log('axios update',e);
                    });
                } else {
                    axios.put(premium?`https://api.esteem.app/api/signup/pending-paid-accounts`:`https://api.esteem.app/api/signup/pending-accounts`,
                        {
                            update_code: update_code,
                            creator: acode
                        }
                    )
                        .then(resp => {
                            if (isEmpty(resp.data)) {
                                console.log(`verified creation: ${username}`);
                            }
                        }).catch(e => {
                        console.log('axios update',e);
                    });
                }
            }
        } catch (error) {
            console.log(`error happened with ${username}`, error);
            if (premium){
                await updPremiumExist({username: username, creator: acode});
            } else {
                if (wallet) {
                    await updWalletExist({username: username, creator: acode});
                } else {
                    await updAccountExist({username: username, creator: acode});
                }
            }
        }
    }
};

const validateAccount = async (user, premium = false, wallet = false) => {
    user.username = user.username.toLowerCase();
    try {
        const [account] = await client.database.call('get_accounts', [
            [user.username]
        ]);

        if (account) {
            // If created this session, skip update (already handled)
            if (confirmAccounts.includes(user.username)) {
                console.log(`✅ Skipping existence update for ${user.username}, recently created.`);
                return false;
            }

            const creatorIndex = creators.indexOf(account.recovery_account);
            const creator = creatorIndex !== -1 ? authCodes[creatorIndex] : authCodes[0];

            if (creatorIndex !== -1) {
                const updateData = wallet
                    ? { id: user.update_code || user.id, creator } // wallet uses `id` not `update_code`
                    : { update_code: user.update_code, creator };

                const endpoint = wallet
                    ? `https://api.esteem.app/api/signup/pending-wallet-accounts`
                    : premium
                        ? `https://api.esteem.app/api/signup/pending-paid-accounts`
                        : `https://api.esteem.app/api/signup/pending-accounts`;

                try {
                    await axios.put(endpoint, updateData);
                } catch (err) {
                    const status = err.response && err.response.status;
                    // Treat 400/406 as already updated by another run
                    if (status !== 400 && status !== 406) {
                        throw err;
                    }
                    console.log(`⚠️ ${user.username} already marked as created on API.`);
                }

                console.log(`✅ Marked ${user.username} as successfully created (status 3).`);
            } else {
                // 🚫 Someone else created this account — mark as status 6
                const existUpdater = wallet ? updWalletExist : premium ? updPremiumExist : updAccountExist;
                try {
                    await existUpdater({ username: user.username, creator });
                } catch (err) {
                    // If API responds with 406, it means account already marked as existing
                    if (!(err.response && err.response.status === 406)) {
                        throw err;
                    }
                    console.log(`⚠️ ${user.username} already marked as existing on API.`);
                }

                console.log(`⚠️ ${user.username} exists but recovery doesn't match — marked as status 6.`);
            }

            return false;
        } else {
            return true;
        }
    } catch (err) {
        console.error(`❌ Error validating account ${user.username}:`, err);
        return false;
    }
};


(async () => {
    try {
        if (walletAccounts) await pendingWallet();
        if (premiumAccounts) await pendingPremium();
        else await pendingFree();
    } catch (err) {
        console.error('❌ Fatal error during execution:', err);
        process.exit(1);
    }
})();
