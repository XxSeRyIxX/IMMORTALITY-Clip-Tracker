'use strict';

/** What the shell's error codes say, in the interface language. */
const NATIVE_ERRORS = {
  'no-save': reply => [I18n.t('error.noSave'), I18n.t('hint.checked', reply.detail || '')],
  'no-file': () => [I18n.t('error.noFile'), ''],
  'gone': reply => [I18n.t('error.gone', I18n.fileLabel(reply.name)), I18n.t('hint.chooseAgain')],
  'too-big': reply => [I18n.t('error.tooBig', I18n.fileLabel(reply.name)), I18n.t('hint.tooBig')],
  'not-save': reply => [I18n.t('error.notSave', I18n.fileLabel(reply.name)), I18n.t('hint.notSave')],
  'failed': reply => [I18n.t('error.failed'), reply.detail || ''],
};

function createNativeBridge(transport) {
  let pending = null;
  let queue = Promise.resolve();

  transport.receiveMessage(raw => {
    if (!pending) return;
    const { resolve, reject } = pending;
    pending = null;
    try {
      const message = JSON.parse(raw);
      if (message?.ok || message?.cancelled) {
        resolve(message);
        return;
      }
      const [error, hint] = Object.hasOwn(NATIVE_ERRORS, message?.code)
        ? NATIVE_ERRORS[message.code](message)
        : [I18n.t('error.native'), I18n.t('hint.native')];
      reject(Tracker.saveError(error, hint));
    } catch (error) {
      reject(error);
    }
  });

  return (cmd, path) => {
    const request = () => new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try {
        // The language words the shell's own file dialog.
        transport.sendMessage(JSON.stringify({ cmd, path, lang: I18n.lang() }));
      } catch (error) {
        pending = null;
        reject(error);
      }
    });
    queue = queue.then(request, request);
    return queue;
  };
}
