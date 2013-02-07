Bedrock.rpc = {};

Bedrock.rpc.request = function(method, args) {
  args = args || [];

  Bedrock.rpc.targets     = Bedrock.rpc.targets || {};

  var deferred            = Q.defer();
  var id                  = _.uniqueId();
  Bedrock.rpc.targets[id] = deferred;

  var message             = [0, id, method, args];
  var packed              = msgpack.encode(message);

  Bedrock.socket.send(packed);

  return deferred.promise;
};

Bedrock.rpc.notify = function(method, args) {
  args = args || [];

  var message = [2, method, args];
  var packed  = msgpack.encode(message);

  Bedrock.socket.send(packed);
};

Bedrock.rpc.response = function(msg) {
  if (msg.payload.ok) {
    Bedrock.rpc.targets[msg.target].resolve(msg.payload.body);
  }
  else {
    Bedrock.rpc.targets[msg.target].reject(msg.payload.body);
  }

  delete Bedrock.rpc.targets[msg.target];
};