import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { assembleConfig, PRIORITY_RULES, UPSTREAM_HOSTS, referencedTargets } from '../config.js';
import { GROUP } from '../policy.js';

const ROOT = path.resolve(os.tmpdir(), 'dsh-mihomo-providers');
const NODE = { name: 'JP 01', type: 'ss', server: '203.0.113.7', port: 443, cipher: 'aes-128-gcm', password: 'pw' };
const NODE2 = { ...NODE, name: 'HK 01', server: '203.0.113.8' };

const build = (raw, extra = {}) => assembleConfig({
  raw,
  nodes: [NODE, NODE2],
  mixedPort: 12070,
  apiPort: 12072,
  apiSecret: 'api-secret',
  proxyPassword: 'inbound-secret',
  providerRoot: ROOT,
  dns: { enable: true, 'enhanced-mode': 'normal', 'proxy-server-nameserver': ['https://1.1.1.1/dns-query'] },
  selected: 'HK 01',
  ...extra,
});

test('the subscription document is inherited instead of being thrown away', () => {
  const { config } = build({
    rules: ['DOMAIN-SUFFIX,google.com,Proxy', 'GEOIP,CN,DIRECT', 'MATCH,Proxy'],
    'proxy-groups': [{ name: 'Proxy', type: 'select', proxies: ['JP 01', 'HK 01'] }],
    'rule-providers': { ads: { type: 'http', behavior: 'domain', url: 'https://example.test/ads.yaml' } },
  });
  assert.ok(config.rules.includes('DOMAIN-SUFFIX,google.com,Proxy'), 'inherited rules survive');
  assert.ok(config.rules.includes('GEOIP,CN,DIRECT'));
  assert.deepEqual(config['proxy-groups'][1], { name: 'Proxy', type: 'select', proxies: ['JP 01', 'HK 01'] });
  assert.ok(config['rule-providers'].ads, 'rule providers survive');
  assert.ok(config['proxy-providers'] === undefined);
});

test('the tunnel-only upstream rides the selected node and DeepSeek stays direct', () => {
  const { config } = build({ rules: ['MATCH,Proxy'], 'proxy-groups': [{ name: 'Proxy', type: 'select', proxies: ['JP 01'] }] });
  assert.equal(config.rules[0], `DOMAIN-SUFFIX,chatgpt.com,${GROUP}`, 'the GPT upstream comes first so no inherited rule can send it direct');
  assert.deepEqual(config.rules.slice(0, UPSTREAM_HOSTS.length), UPSTREAM_HOSTS.map(host => `DOMAIN-SUFFIX,${host},${GROUP}`));
  assert.deepEqual(config.rules.slice(UPSTREAM_HOSTS.length, UPSTREAM_HOSTS.length + PRIORITY_RULES.length), PRIORITY_RULES);
  assert.ok(config.rules.includes('DOMAIN-SUFFIX,deepseek.com,DIRECT'), 'the domestic model API is never tunnelled');
  assert.ok(config.rules.indexOf(`DOMAIN-SUFFIX,chatgpt.com,${GROUP}`) < config.rules.indexOf('MATCH,DSH'), 'it lands before the catch-all');
});

test('the inherited catch-all is retargeted so the node picker still decides', () => {
  const { config, report } = build({
    rules: ['DOMAIN-SUFFIX,google.com,Proxy', 'MATCH,Proxy'],
    'proxy-groups': [{ name: 'Proxy', type: 'select', proxies: ['JP 01'] }],
  });
  assert.equal(config.rules.at(-1), `MATCH,${GROUP}`);
  assert.equal(report.rules, 2, 'the report counts inherited rules, not the prepended ones');
  assert.equal(config.rules.length, UPSTREAM_HOSTS.length + PRIORITY_RULES.length + 2, 'the upstream block, the priority block and the inherited two');
  assert.equal(referencedTargets(config).has('Proxy'), true, 'the inherited group is still referenced');
});

test('a subscription without a catch-all still gets one', () => {
  const { config } = build({ rules: ['DOMAIN-SUFFIX,google.com,DIRECT'] });
  assert.equal(config.rules.at(-1), `MATCH,${GROUP}`);
});

test('keys that would open an inbound server or bind the host are stripped', () => {
  const { config, report } = build({
    tunnels: ['tcp/9000:1.2.3.4:443'],
    listeners: [{ name: 'in', type: 'mixed', port: 1080 }],
    iptables: { enable: true },
    'ss-config': 'ss.txt',
    'vmess-config': 'vmess.txt',
    'tuic-server': { enable: true },
    sniffer: { enable: true },
    hosts: { 'api.deepseek.com': '203.0.113.99' },
    script: { code: 'x' },
    'sub-rules': { a: ['MATCH,DIRECT'] },
    ntp: { enable: true, server: 'pool.ntp.org' },
    'geox-url': { geoip: 'https://evil.test/geoip.dat' },
    experimental: { 'quic-go-disable-gso': true },
    'interface-name': 'Ethernet',
    'routing-mark': 7,
    tun: { enable: true, stack: 'gvisor', 'auto-route': true },
  });
  for (const key of ['tunnels', 'listeners', 'iptables', 'ss-config', 'vmess-config', 'tuic-server', 'sniffer', 'hosts', 'script', 'sub-rules', 'ntp', 'geox-url', 'experimental', 'interface-name', 'routing-mark']) {
    assert.equal(key in config, false, `${key} must not reach the core`);
  }
  assert.equal(config.tun.enable, false, 'TUN stays off without the helper');
  assert.equal(config.tun['auto-route'], false);
  assert.equal(config.tun['auto-detect-interface'], false);
  assert.equal(config.tun.stack, 'gvisor', 'harmless TUN keys are left alone');
  assert.ok(report.stripped.includes('hosts'));
});

test('the unauthenticated control sockets and the external UI are blanked', () => {
  const { config } = build({
    'external-controller-unix': '/tmp/mihomo.sock',
    'external-controller-pipe': '\\\\.\\pipe\\mihomo',
    'external-controller-tls': '0.0.0.0:9443',
    'external-ui': 'C:/Windows/System32',
    'external-ui-url': 'https://evil.test/ui.zip',
  });
  assert.equal(config['external-controller-unix'], '');
  assert.equal(config['external-controller-pipe'], '');
  assert.equal(config['external-controller-tls'], '');
  assert.equal(config['external-ui'], '');
  assert.equal(config['external-ui-url'], '');
  assert.equal(config['external-controller'], '127.0.0.1:12072');
});

test('the plugin owns ports, authentication and routing mode regardless of the document', () => {
  const { config } = build({
    'mixed-port': 7890, port: 7891, 'socks-port': 7892, 'redir-port': 7893, 'tproxy-port': 7894,
    'allow-lan': true, 'bind-address': '*',
    'external-controller': '0.0.0.0:9090', secret: 'attacker', authentication: ['a:b'], 'skip-auth-prefixes': ['/'],
    mode: 'global', 'log-level': 'debug', ipv6: true, 'find-process-mode': 'strict',
    'geo-auto-update': true, profile: { 'store-selected': true, 'store-fake-ip': true },
  });
  assert.equal(config['mixed-port'], 12070);
  assert.equal(config.port, 0);
  assert.equal(config['socks-port'], 0);
  assert.equal(config['redir-port'], 0);
  assert.equal(config['tproxy-port'], 0);
  assert.equal(config['allow-lan'], false);
  assert.equal(config['bind-address'], '127.0.0.1');
  assert.equal(config['external-controller'], '127.0.0.1:12072');
  assert.equal(config.secret, 'api-secret');
  assert.deepEqual(config.authentication, ['dsh:inbound-secret']);
  assert.deepEqual(config['skip-auth-prefixes'], []);
  assert.equal(config.mode, 'rule');
  assert.equal(config['log-level'], 'warning');
  assert.equal(config.ipv6, false);
  assert.equal(config['find-process-mode'], 'off');
  assert.equal(config['geo-auto-update'], false);
  assert.deepEqual(config.profile, { 'store-selected': false, 'store-fake-ip': false });
});

test('the managed proxy list is the validated set, not the raw document', () => {
  const { config } = build({ proxies: [{ name: 'evil', type: 'ss', server: 'x', port: 1, cipher: 'aes-128-gcm', password: 'p' }] });
  assert.deepEqual(config.proxies.map(node => node.name), ['JP 01', 'HK 01']);
  const { config: plain } = build(null);
  assert.deepEqual(plain['proxy-groups'][0], { name: GROUP, type: 'select', proxies: ['HK 01', 'JP 01'] });
});

test('the selector lists the chosen node first and keeps every node reachable', () => {
  const { config } = build(null);
  assert.deepEqual(config['proxy-groups'][0].proxies, ['HK 01', 'JP 01']);
  assert.equal(config['proxy-groups'][0].type, 'select');
});

test('a provider cache path is confined to the plugin directory', () => {
  const { config } = build({
    'proxy-providers': {
      sub: { type: 'http', url: 'https://example.test/sub.yaml', path: 'C:/Windows/System32/drivers/etc/hosts' },
      local: { type: 'file', path: 'C:/Users/coin/.ssh/id_rsa' },
      inline: { type: 'inline', payload: ['DIRECT'] },
      weird: { type: 'ftp', url: 'ftp://example.test/x' },
    },
  });
  const providers = config['proxy-providers'];
  assert.ok(providers.sub, 'an http provider is kept');
  assert.ok(path.resolve(providers.sub.path).startsWith(path.resolve(ROOT)), `path escaped: ${providers.sub.path}`);
  assert.match(path.basename(providers.sub.path), /^[0-9a-f]{32}\.yaml$/);
  assert.equal(providers.local, undefined, 'a file provider would read a path the document chooses');
  assert.equal(providers.weird, undefined);
  assert.ok(providers.inline, 'an inline provider needs no filesystem access');
});

test('a group left with nothing to choose from is dropped and its rules retargeted', () => {
  const { config, report } = build({
    rules: ['DOMAIN-SUFFIX,ads.example,Empty', 'DOMAIN-SUFFIX,a.example,Partial', 'MATCH,Empty'],
    'proxy-groups': [
      { name: 'Empty', type: 'select', proxies: ['not-a-node'] },
      { name: 'Partial', type: 'select', proxies: ['not-a-node', 'DIRECT'] },
      { name: 'Broken', type: 'url-test', proxies: ['JP 01'], url: 'https://example.test', interval: 300 },
    ],
  });
  assert.deepEqual(report.droppedGroups, ['Empty']);
  assert.equal(config['proxy-groups'].some(group => group.name === 'Empty'), false);
  assert.deepEqual(config['proxy-groups'].find(group => group.name === 'Partial').proxies, ['DIRECT']);
  assert.equal(config.rules.includes(`DOMAIN-SUFFIX,ads.example,${GROUP}`), true, 'a rule pointing at a dropped group goes to the selector');
  assert.equal(config.rules.at(-1), `MATCH,${GROUP}`);
});

test('a group that references a sibling group keeps working', () => {
  const { config } = build({
    'proxy-groups': [
      { name: 'AUTO', type: 'url-test', proxies: ['JP 01', 'HK 01'], url: 'https://example.test', interval: 300 },
      { name: 'Manual', type: 'select', proxies: ['AUTO', 'DIRECT'] },
    ],
  });
  assert.deepEqual(config['proxy-groups'].find(group => group.name === 'Manual').proxies, ['AUTO', 'DIRECT']);
});

test('malformed entries cannot reach the core', () => {
  const { config } = build({
    rules: [null, 42, { rule: 'MATCH,DIRECT' }, '', 'NOT A RULE', 'MATCH,DIRECT'],
    'proxy-groups': [null, 'nope', { name: '', type: 'select', proxies: ['JP 01'] }, { name: 'X', type: 'not-a-type', proxies: ['JP 01'] }],
  });
  assert.deepEqual(config.rules.filter(rule => typeof rule !== 'string'), []);
  assert.equal(config['proxy-groups'].length, 1, 'only the plugin selector survives');
  // 'NOT A RULE' is a string without commas: harmless to the core, and mihomo
  // itself decides on it rather than the assembler silently dropping lines.
  assert.ok(config.rules.includes('MATCH,DIRECT') === false, 'the first catch-all is replaced, not duplicated');
});

test('the dns block is the sanitised one the plugin reviewed', () => {
  const { config } = build({ dns: { enable: true, 'fake-ip-range': '198.18.0.1/16', fallback: ['https://8.8.8.8/dns-query'] } });
  assert.equal(config.dns['fake-ip-range'], undefined, 'an inherited fake-ip range is not carried over');
  assert.deepEqual(config.dns['proxy-server-nameserver'], ['https://1.1.1.1/dns-query']);
  const { config: noDns } = build({}, { dns: null });
  assert.deepEqual(noDns.dns, { enable: false, ipv6: false });
});

test('every rule target resolves so the core cannot reject the document', () => {
  const { config } = build({
    rules: ['DOMAIN-SUFFIX,google.com,Proxy', 'DOMAIN-SUFFIX,x.example,Gone', 'MATCH,Proxy'],
    'proxy-groups': [
      { name: 'Proxy', type: 'select', proxies: ['JP 01', 'Gone'] },
      { name: 'Gone', type: 'select', proxies: ['absent'] },
    ],
  });
  const known = new Set([
    ...config.proxies.map(node => node.name),
    ...config['proxy-groups'].map(group => group.name),
    'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL',
  ]);
  for (const target of referencedTargets(config)) {
    assert.ok(known.has(target), `rule target ${target} has no definition`);
  }
});
