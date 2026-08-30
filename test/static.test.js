import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('every local HTML resource exists', async () => {
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(reference => !reference.startsWith('http') && !reference.startsWith('#'));

  await Promise.all(references.map(reference => access(resolve(root, reference))));
});

test('HTML has no inline script or style event handlers', async () => {
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>\s*\S/i);
});

test('manifest install icons exist', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const rasterIcons = manifest.icons.filter(icon => icon.type === 'image/png');
  assert.ok(rasterIcons.some(icon => icon.sizes === '192x192'));
  assert.ok(rasterIcons.some(icon => icon.sizes === '512x512'));
  await Promise.all(rasterIcons.map(icon => access(resolve(root, icon.src))));
});

test('third-party document scripts use subresource integrity', async () => {
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const bootstrap = await readFile(resolve(root, 'js/bootstrap.js'), 'utf8');
  const externalScripts = [...html.matchAll(/<script[^>]+src="https:[^"]+"[^>]*>/g)]
    .map(match => match[0]);
  assert.ok(externalScripts.length >= 2);
  for (const script of externalScripts) {
    assert.match(script, /integrity="sha384-/);
    assert.match(script, /crossorigin="anonymous"/);
  }
  assert.match(bootstrap, /@seadong\/opencv-js@4\.10\.0/);
  assert.match(bootstrap, /integrity = 'sha384-/);
});

test('mobile scan flow exposes camera, core filters and comparison controls', async () => {
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const app = await readFile(resolve(root, 'js/app.js'), 'utf8');
  const scanner = await readFile(resolve(root, 'js/scanner.js'), 'utf8');

  for (const id of [
    'camera-zone',
    'camera-video',
    'btn-open-camera',
    'btn-camera-capture',
    'btn-camera-switch',
    'btn-camera-torch',
    'btn-compare',
    'btn-page-left',
    'btn-page-right',
    'flow-nav',
    'filter-auto',
    'filter-document',
    'filter-whiteboard',
    'filter-color'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /cameraStream\?\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
  assert.match(scanner, /case 'auto':/);
});
