Bedrock.decodeMessage = function(packedMsg) {
  var unpacked = msgpack.decode(packedMsg.data);
  var message = {
    isResponse:     unpacked[0] === 1,
    isNotification: unpacked[0] === 2
  };

  if (message.isResponse) {
    _.extend(message, {
      target: unpacked[1],
      payload: unpacked[2]
    });
  }
  else {
    _.extend(message, {
      channel: unpacked[1],
      data: unpacked[2]
    });
  }

  return message;
};