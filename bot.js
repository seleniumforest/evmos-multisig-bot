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

    let rpcs = (await fs.readFile("./rpcs.txt", { encoding: "utf-8" }))
        .split("\n").map(x => x.trim());

    let contracts = (await fs.readFile("./contracts.txt", { encoding: "utf-8" }))
        .split(/\r?\n|\r|\n/g).map(x => {
            let [contract, alias] = x.split(";");
            return { contract, alias }
        });
    let txsProcessed = [];

    for (let rpc of _.shuffle(rpcs)) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(rpc);
            const fromBlock = await getFromBlock(provider);
            if (!fromBlock)
                continue;

            const toBlock = await provider.getBlockNumber();

            for (let { contract, alias } of contracts) {
                try {
                    ethers.utils.getAddress(contract)
                } catch {
                    continue;
                }

                const parsedLogs = await getParsedLogs(
                    provider,
                    contract,
                    fromBlock,
                    toBlock <= fromBlock ? undefined : toBlock
                );
                console.log(`found ${parsedLogs.length} transactions on contract ${contract} from block ${fromBlock} to block ${toBlock}`);

                for (let { log } of parsedLogs) {
                    let txhash = log.transactionHash.toString();

                    if (!txsProcessed.includes(txhash))
                        await notify(alias || contract, log.blockNumber, txhash);

                    txsProcessed.push(txhash);
                }

                //avoid possible 429's
                await new Promise(res => setTimeout(res, 1000));
            }

            await fs.writeFile("./latestBlock.txt", toBlock.toString());
            break;
        }
        catch (e) {
            console.warn(`${new Date()} error = ${JSON.stringify(e)}`)
        }
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

async function getFromBlock(provider) {
    let savedBlock;
    try {
        let fileResult = await fs.readFile("./latestBlock.txt", { encoding: "utf-8" });
        savedBlock = Number(fileResult);
    } catch { }

    let rpcBlock = await provider.getBlockNumber();
    if (!savedBlock)
        return rpcBlock;

    //rpc is out of sync
    if (savedBlock > rpcBlock)
        return null;

    //latestBlock is outdated and it's not possible to get logs from rpc, so just start from latest block
    if (rpcBlock - savedBlock > 9999)
        return rpcBlock

    return savedBlock;
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

function run() {
    try {
        main();
    } catch (e) {
        console.log(`${new Date()} + ${JSON.stringify(e)}`)
    }
}

setInterval(run, 60000);
run()