const dhive = require('@hiveio/dhive');
const request = require("request");
const axios = require('axios');

const config = require('./config.js');

const {creators, privateKeys, authCodes, delegate} = config;

//connect to rpc
const client = new dhive.Client(['https://rpc.ecency.com', 'https://api.hive.blog'], {
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

pendingAccounts = async () => {
    console.log('UTC: ', new Date().toUTCString());
    const getPendingAccounts = () =>
        axios.get(`https://api.esteem.app/api/signup/pending-accounts?creator=${authCodes[0]}`).then(resp => resp.data);
    const pacs = await getPendingAccounts();
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
createAccount = async (user) => {
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

        const username = user.username;
        const update_code = user.update_code;

        //pub keys
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
        console.log(`attempting to create account: ${username} with ${creator}`);
        //broadcast operation to blockchain
        client.broadcast.sendOperations(ops, privateKey).then(
            function(result) {
                if (result && result.block_num) {
                    confirmAccounts.push(username);
                    setTimeout(function(){
                        axios.put(`https://api.esteem.app/api/signup/pending-accounts`,
                            {
                                update_code: update_code,
                                creator: acode
                            }
                        )
                        .then(resp => {
                            if (isEmpty(resp.data)) {
                                console.log(`created account: ${username} with ${creator}`);
                            }
                        }).catch(e => {
                            console.log(e);
                        });
                    }, 30000);
                }
            },
            function(error) {
                console.log(`error happened with ${username}`, error);
            }
        );
    }
};

validateAccount = async(user) => {
    const [account] = await client.database.call('get_accounts', [
        [user.username]
    ]);

    if (account) {
        // account already exist
        let inx = creators.indexOf(account.recovery_account);
        if (inx !== -1) {
            axios.put(`https://api.esteem.app/api/signup/pending-accounts`,
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
        return false;
    } else {
        return true;
    }
}

pendingAccounts();