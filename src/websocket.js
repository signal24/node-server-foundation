const WebSocket = require('ws');

const server = new WebSocket.Server({
    noServer: true
});

WebSocket.prototype.sendJson = function(obj) {
    this.send(JSON.stringify(obj));
};

module.exports = server;