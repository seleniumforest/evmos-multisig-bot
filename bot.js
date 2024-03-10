const { ethers } = require('ethers');
const fs = require("fs/promises");
const _ = require("lodash");
const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.TG_BOT_API_KEY);
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

setInterval(main, 60000)
main();

async function main() {
    console.log(`${new Date()}: checking txs`);

    let rpcs = (await fs.readFile("./rpcs.txt", { encoding: "utf-8" }))
        .split("\n").map(x => x.trim());

    let contracts = (await fs.readFile("./contracts.txt", { encoding: "utf-8" }))
        .split("\n").map(x => x.trim());

    for (let rpc of _.shuffle(rpcs)) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(rpc);
            const fromBlock = await getFromBlock(provider);
            if (!fromBlock)
                continue;

            const toBlock = await provider.getBlockNumber();

            for (let contract of contracts) {
                const parsedLogs = await getParsedLogs(
                    provider,
                    contract.trim(),
                    fromBlock,
                    toBlock <= fromBlock ? undefined : toBlock
                );
                console.log(`found ${parsedLogs.length} transactions on contract ${contract} from block ${fromBlock} to block ${toBlock}`);

                for (let { log } of parsedLogs) {
                    await bot.telegram.sendMessage(
                        process.env.TG_CHANNEL,
                        `contract ${contract} block ${log.blockNumber} txhash: ${log.transactionHash.toString()}`
                    )
                }
            }

            await fs.writeFile("./latestBlock.txt", toBlock.toString());
            return;
        }
        catch (e) {
            console.warn(`error = ${JSON.stringify(e)}`)
        }
    }
    console.log(`${new Date()}: finished checking txs`);
};

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