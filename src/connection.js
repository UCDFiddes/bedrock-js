window.Bedrock = {};

Bedrock.connect = function() {
  Bedrock.socket = new WebSocket('wss://connect.bedrock.io');

  Bedrock.socket.binaryType = 'arraybuffer';

  Bedrock.socket.onopen = function() {
    if (Bedrock._ready) { Bedrock.ready(); }
  };

  Bedrock.socket.onclose = function() {
    delete Bedrock.socket;
    if (Bedrock._notReady) { Bedrock.notReady(); }
    _.delay(function() {
      Bedrock.connect();
    }, 5000);
  };

  Bedrock.socket.onmessage = function(packedMsg) {
    var msg = Bedrock.decodeMessage(packedMsg);

    if (msg.isResponse) { Bedrock.rpc.response(msg); }
    else                { Bedrock.receive(msg); }
  }; 
};

Bedrock.disconnect = function() {
  Bedrock.socket.close();
}

Bedrock.ready = function(fn) {
  Bedrock.ready = fn;
  Bedrock._ready = true;
}
Bedrock.notReady = function(fn) {
  Bedrock.notReady = fn;
  Bedrock._notReady = true;
}