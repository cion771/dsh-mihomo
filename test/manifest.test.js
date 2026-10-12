// A DSH runtime validates every `@deepseek-ai/dsh*` peer at boot and silently skips a bundle
// whose range the running version does not satisfy, so an exact prerelease pin turns an ordinary
// DSH upgrade into a plugin that is simply absent — no error screen, no tool, no settings page.
// v1.3.1 pinned `0.2.1-alpha.1` and stopped loading on 0.2.1-alpha.2 for exactly this reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import semver from 'semver';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dshPeers = Object.entries(manifest.peerDependencies ?? {})
  .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'));

test('the manifest declares the dsh packages it is built against', () => {
  assert.ok(dshPeers.length > 0, 'at least one @deepseek-ai/dsh* peer is required');
});

test('every dsh peer range accepts the 0.2.1 prerelease line and later 0.2.x patches', () => {
  for (const [name, range] of dshPeers) {
    for (const runtime of ['0.2.1-alpha.1', '0.2.1-alpha.2', '0.2.1', '0.2.5']) {
      assert.equal(semver.satisfies(runtime, range, { includePrerelease: true }), true,
        `${name} range ${range} must accept dsh ${runtime}, or DSH silently skips this bundle`);
    }
  }
});

test('every dsh peer range still excludes other minor and major lines', () => {
  for (const [name, range] of dshPeers) {
    for (const runtime of ['0.1.0', '0.3.0', '1.0.0']) {
      assert.equal(semver.satisfies(runtime, range, { includePrerelease: true }), false,
        `${name} range ${range} must not claim compatibility with dsh ${runtime}`);
    }
  }
});

test('the manifest points dsh at the bundle patch and the client entry it ships', () => {
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh?.client?.platform, 'web');
  for (const file of ['index.js', 'client.js', 'timezone.js', 'controller.js', 'policy.js']) {
    assert.ok(manifest.files.includes(file), `${file} must be published with the bundle`);
  }
});
