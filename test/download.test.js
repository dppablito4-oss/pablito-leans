import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadBlob } from '../js/export/download.js';

test('exports enter the browser download flow and keep the blob alive long enough', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const link = { click() { events.push(['download', this.href, this.download]); }, remove() { events.push(['remove']); } };
  globalThis.document = {
    createElement(tag) { assert.equal(tag, 'a'); return link; },
    body: { appendChild(element) { assert.equal(element, link); events.push(['append']); } }
  };
  URL.createObjectURL = blob => { assert.equal(blob.type, 'application/pdf'); return 'blob:browser-download'; };
  URL.revokeObjectURL = url => events.push(['revoke', url]);
  t.after(() => {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  downloadBlob(new Blob(['sample'], { type: 'application/pdf' }), 'documento.pdf');
  assert.deepEqual(events, [['append'], ['download', 'blob:browser-download', 'documento.pdf'], ['remove']]);
  t.mock.timers.tick(59_999);
  assert.equal(events.length, 3);
  t.mock.timers.tick(1);
  assert.deepEqual(events.at(-1), ['revoke', 'blob:browser-download']);
});
