import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('OpenCV bootstrap waits for Mat without awaiting the broken thenable', async () => {
  const source = await readFile(resolve(root, 'js/bootstrap.js'), 'utf8');
  const scriptListeners = {};
  let readyCalls = 0;

  const scriptElement = {
    addEventListener(type, listener) {
      scriptListeners[type] = listener;
    }
  };
  const window = {
    cv: {
      then() {
        throw new Error('The OpenCV thenable must not be awaited');
      }
    },
    App: { onOpenCvReady: () => { readyCalls++; } },
    setTimeout,
    location: { reload() {} },
    addEventListener() {}
  };
  const document = {
    createElement: () => scriptElement,
    head: { appendChild() {} },
    getElementById: () => null
  };

  vm.runInNewContext(source, { window, document, navigator: {}, console });
  const loading = scriptListeners.load();
  setTimeout(() => { window.cv.Mat = function Mat() {}; }, 20);
  await loading;

  assert.equal(readyCalls, 1);
});
