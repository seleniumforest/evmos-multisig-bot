const express = require('express');
const fs = require("fs");

const app = express();
const port = 3000;

app.get('/', (_, res) => {
    try {
        let file = fs.readFileSync("./latestBlock.txt", { encoding: "utf8" });
        let stat = fs.statSync("./latestBlock.txt");

        res.send({
            latestHeight: file,
            timestamp: stat.ctime
        })
    } catch (e) {
        return res.sendStatus(500);
    }
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})