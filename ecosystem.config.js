module.exports = {
    apps: [{
        name: "multisigbot",
        script: "./bot.js",
        node_args: "--env-file=.env",
        error_file: "multisigbot-err.log",
        out_file: "multisigbot-out.log"
    },
    {
        name: "server",
        script: "./server.js",
        error_file: "server-err.log",
        out_file: "server-out.log"
    }]
}