'use strict';

function createNativeBridge(transport) {
  let pending = null;
  let queue = Promise.resolve();

  transport.receiveMessage(raw => {
    if (!pending) return;
    const { resolve, reject } = pending;
    pending = null;
    try {
      const message = JSON.parse(raw);
      if (message?.ok || message?.cancelled) resolve(message);
      else reject(Tracker.saveError(
        message?.error || 'The app could not read that save.',
        message?.hint || 'Use "choose a file" to point at it yourself.'));
    } catch (error) {
      reject(error);
    }
  });

  return (cmd, path) => {
    const request = () => new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try {
        transport.sendMessage(JSON.stringify({ cmd, path }));
      } catch (error) {
        pending = null;
        reject(error);
      }
    });
    queue = queue.then(request, request);
    return queue;
  };
}