Bedrock.on = function(channels, fn) {
  return Bedrock.rpc.request('messaging.subscribe', [channels]).then(function(scopedChannels) {
    Bedrock.handlers = Bedrock.handlers || {};
    _.each(scopedChannels, function(channel) {
      Bedrock.handlers[channel] = Bedrock.handlers[channel] || [];
      Bedrock.handlers[channel].push(fn);
    });
  });
};

Bedrock.receive = function(msg) {
  _.each(Bedrock.handlers[msg.channel], function(handler) {
    handler(msg.data);
  });
};

Bedrock.send = function(channel, msg) {
  Bedrock.rpc.notify('messaging.publish', [channel, msg]);
};