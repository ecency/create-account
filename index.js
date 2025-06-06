const dhive = require('@hiveio/dhive');
const request = require("request");
const axios = require('axios');

const config = require('./config.js');

const {creators, privateKeys, authCodes, delegate, premiumAccounts, walletAccounts} = config;

//connect to rpc
const client = new dhive.Client(['https://anyx.io','https://api.hive.blog','https://rpc.ecency.com','https://api.deathwing.me'], {
    timeout: 4000,
    failoverThreshold: 20,
    consoleOnFailover: true,
  });

isEmpty = (obj) => {
    return Object.keys(obj).length === 0;
}
sleep = (ms) => {
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    });
}

let confirmAccounts = [];
const getPendingAccounts = (creator) =>
    axios.get(`https://api.esteem.app/api/signup/pending-accounts?creator=${creator}`).then(resp => resp.data);
const getPremiumAccounts = (creator) =>
    axios.get(`https://api.esteem.app/api/signup/pending-paid-accounts?creator=${creator}`).then(resp => resp.data);
const getWalletAccounts = (creator) =>
    axios.get(`https://api.esteem.app/api/signup/pending-wallet-accounts?creator=${creator}`).then(resp => resp.data);
const updPremiumExist = (data) => axios.put(`https://api.esteem.app/api/signup/paid-account-exist`, data);
const updWalletExist = (data) => axios.put(`https://api.esteem.app/api/signup/exist-wallet-accounts`, data);
const updAccountExist = (data) => axios.put(`https://api.esteem.app/api/signup/account-exist`, data);

pendingPremium = async () => {
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

pendingWallet = async () => {
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

pendingFree = async () => {
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
createAccount = async (user, premium=false, wallet = false) => {
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

        const username = user.username.toLowerCase();

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

validateAccount = async(user, premium=false, wallet = false) => {
    const [account] = await client.database.call('get_accounts', [
        [user.username]
    ]);

    if (account) {
        // account already exist
        let inx = creators.indexOf(account.recovery_account);
        if (inx !== -1) {
            if (wallet) {
                axios.put('https://api.esteem.app/api/signup/pending-wallet-accounts',
                    {
                        id: user._id,
                        creator: authCodes[inx]
                    }
                )
                    .then(resp => {
                        if (isEmpty(resp.data)) {
                            console.log(`validated account: ${user.username}`);
                        }
                    }).catch(e => {
                    console.log(e);
                });
            } else {
                let cuurl = premium?`https://api.esteem.app/api/signup/pending-paid-accounts`:`https://api.esteem.app/api/signup/pending-accounts`;
                axios.put(cuurl,
                    {
                        update_code: user.update_code,
                        creator: authCodes[inx]
                    }
                )
                    .then(resp => {
                        if (isEmpty(resp.data)) {
                            console.log(`validated account: ${user.username}`);
                        }
                    }).catch(e => {
                    console.log(e);
                });
            }
        }
        return false;
    } else {
        return true;
    }
}

if (walletAccounts) {
    pendingWallet();
}
if (premiumAccounts) {
    pendingPremium();
} else {
    pendingFree();
}
