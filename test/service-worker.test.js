import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('offline cache ignores extension and non-HTTP requests', async () => {
  const listeners = {};
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    URL,
    self: { location: { origin: 'https://example.com' },
      addEventListener(type, handler) { listeners[type] = handler; } }
  });
  for (const url of ['chrome-extension://extension-id/script.js', 'data:text/plain,test', 'blob:https://example.com/id']) {
    let intercepted = false;
    listeners.fetch({ request: { method: 'GET', url }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
