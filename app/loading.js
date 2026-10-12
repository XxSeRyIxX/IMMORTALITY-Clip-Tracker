'use strict';

function checkLoad(signal) {
  if (signal?.aborted) throw new DOMException('A newer load was started.', 'AbortError');
}

function createLoader(setBusy, showError, beforeWork = () => Promise.resolve()) {
  let active = null;

  const run = async work => {
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const { signal } = controller;
    setBusy(true);
    try {
      await beforeWork();
      checkLoad(signal);
      return await work(signal);
    } catch (error) {
      if (!signal.aborted && error?.name !== 'AbortError') showError(error);
    } finally {
      if (active === controller) {
        active = null;
        setBusy(false);
      }
    }
  };

  run.cancel = () => {
    if (!active) return;
    active.abort();
    active = null;
    setBusy(false);
  };

  return run;
}