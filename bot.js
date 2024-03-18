const { ethers } = require('ethers');
const fs = require("fs/promises");
const _ = require("lodash");
const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.TG_BOT_API_KEY);
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

async function main() {
    console.log(`${new Date()}: checking txs`);

    let rpcs = await getReliableRpcs();
    let fromBlock = await getFromBlock(rpcs);
    if (!fromBlock) {
        throw new Exception("wrong fromBlock");
    }

    let contracts = (await fs.readFile("./contracts.txt", { encoding: "utf-8" }))
        .split(/\r?\n|\r|\n/g)
        .map(x => {
            let [contract, alias] = x.split(";");
            return { contract, alias }
        })
        .filter(x => x.contract);

    let collectedLogs = [];
    for (let { rpc } of _.shuffle(rpcs)) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(rpc);
            const rpcBlock = await awaitWithTimeout(provider.getBlockNumber(), 10000)
            if (rpcBlock <= fromBlock)
                continue;
            const toBlock = rpcBlock;

            for (let { contract, alias } of contracts) {
                try {
                    ethers.utils.getAddress(contract);
                } catch {
                    console.warn(`wrong contract ${contract}`);
                    continue;
                }

                const parsedLogs = await getParsedLogs(
                    provider,
                    contract,
                    fromBlock,
                    toBlock
                );

                collectedLogs.push({
                    parsedLogs,
                    contract: { contract, alias },
                    fromBlock,
                    toBlock,
                    rpc
                });

                //avoid possible 429's
                await new Promise(res => setTimeout(res, 1000));
            }

            await fs.writeFile("./latestBlock.txt", (toBlock + 1).toString());
            break;
        }
        catch (e) {
            console.warn(`${new Date()} error = ${JSON.stringify(e)}`);
            collectedLogs = [];
        }
    }

    for (let {
        parsedLogs,
        contract,
        fromBlock,
        rpc,
        toBlock
    } of collectedLogs) {
        console.log(`found ${parsedLogs.length} txs on ${contract.contract} from ${fromBlock} to ${toBlock} rpc ${rpc}`);
        for (const { log } of parsedLogs) {
            try {
                await notify(contract.alias || contract.contract, log.blockNumber, log.transactionHash.toString());
            } catch (e) { console.error(`${new Date()} + ${JSON.stringify(e)}`) }
        }
        //avoid possible 429's
        await new Promise(res => setTimeout(res, 1000));
    }

    console.log(`${new Date()}: finished checking txs`);
};

async function notify(contract, block, txhash) {
    await bot.telegram.sendMessage(
        process.env.TG_CHANNEL,
        `Multisig ${contract} \n` +
        `Block ${block} \n` +
        `<a href='https://escan.live/tx/${txhash}'>TX link</a>`,
        {
            parse_mode: "HTML",
            disable_web_page_preview: true
        })
}

async function getFromBlock(reliableRpcs) {
    let savedBlock;
    try {
        let fileResult = await fs.readFile("./latestBlock.txt", { encoding: "utf-8" });
        savedBlock = Number(fileResult);
    } catch { }

    let rpcLatestBlock = Math.max(...reliableRpcs.map(x => x.height));
    if (!savedBlock)
        return rpcLatestBlock;

    if (Math.abs(savedBlock - rpcLatestBlock) > 9999)
        return rpcLatestBlock;

    return savedBlock;
}

async function getReliableRpcs() {
    let rpcs = (await fs.readFile("./rpcs.txt", { encoding: "utf-8" }))
        .split(/\r?\n|\r|\n/g).map(x => x.trim());

    let blocks = await Promise.allSettled(rpcs.map(async rpc => {
        const provider = new ethers.providers.JsonRpcProvider(rpc);
        return {
            rpc,
            height: await awaitWithTimeout(provider.getBlockNumber(), 10000)
        };
    }));

    let responses = _.chain(blocks)
        .filter(x => x.status === "fulfilled")
        .map(x => x.value);

    let [reliableBlock] = responses
        .groupBy("height")
        .map((g, k) => {
            return [k, g]
        })
        .sort((a, b) => b[1].length - a[1].length)
        .at(0)
        .valueOf();

    let reliableRpcs = responses
        .filter(x => Math.abs(x.height - Number(reliableBlock[0])) < 5)
        .valueOf();

    return reliableRpcs;
}

async function getParsedLogs(provider, address, fromBlock, toBlock) {
    let result = [];
    let logs = await provider.getLogs({ address, fromBlock, toBlock });

    for (let log of logs) {
        try {
            const iface = new ethers.utils.Interface(abi);
            const parsed = iface.parseLog(log);
            result.push({
                log,
                parsed
            });
        } catch {
        }
    }

    return result;
}

function awaitWithTimeout(promise, timeout, timeoutError = new Error('Operation timed out')) {
    // Create a promise that rejects in <timeout> milliseconds
    let timeoutPromise = new Promise((_, reject) => {
        let id = setTimeout(() => {
            clearTimeout(id);
            reject(timeoutError);
        }, timeout);
    });

    // Returns a race between our timeout and the passed in promise
    return Promise.race([promise, timeoutPromise]);
}

const abi = [{
    "anonymous": false,
    "inputs": [
        { "indexed": false, "name": "to", "type": "address" },
        { "indexed": false, "name": "value", "type": "uint256" },
        { "indexed": false, "name": "data", "type": "bytes" },
        { "indexed": false, "name": "operation", "type": "uint8" },
        { "indexed": false, "name": "safeTxGas", "type": "uint256" },
        { "indexed": false, "name": "baseGas", "type": "uint256" },
        { "indexed": false, "name": "gasPrice", "type": "uint256" },
        { "indexed": false, "name": "gasToken", "type": "address" },
        { "indexed": false, "name": "refundReceiver", "type": "address" },
        { "indexed": false, "name": "signatures", "type": "bytes" },
        { "indexed": false, "name": "additionalInfo", "type": "bytes" }
    ],
    "name": "SafeMultiSigTransaction",
    "type": "event"
}];

async function run() {
    while (true) {
        try {
            await main();
        } catch (e) {
            console.error(`${new Date()} + ${JSON.stringify(e)}`);
        } finally {
            await new Promise(res => setTimeout(res, 60000));
        }
    }
}

run()