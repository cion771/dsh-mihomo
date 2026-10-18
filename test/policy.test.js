import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNodes, parseSubscription, sanitizeDns, isLocalHost, coreEnvironment, validateSubscriptionUrl, redactLog, parseUserInfo, parseSubscriptionMeta, parseImportInfo } from '../policy.js';
import { assembleConfig, PRIORITY_RULES } from '../config.js';

/** Managed document for a parsed subscription, with the values the Host would supply. */
const assemble = (raw, nodes, extra = {}) => assembleConfig({
  raw, nodes, mixedPort: 30001, apiPort: 30002, apiSecret: 'secret',
  proxyPassword: 'password', providerRoot: 'C:/providers', dns: null, ...extra,
}).config;
const fixture = 'proxies:\n  - name: example\n    type: socks5\n    server: example.com\n    port: 443\n';

test('provider usage lines are read in the shapes providers actually send',()=>{
  assert.deepEqual(parseUserInfo('upload=0; download=122190068697; total=0; expire=0'),{upload:0,download:122190068697,total:0,expire:0});
  // Some panels omit the spaces after the separator; that must not discard the whole line.
  assert.deepEqual(parseUserInfo('upload=1;download=2;total=3;expire=1793000000'),{upload:1,download:2,total:3,expire:1793000000});
  assert.deepEqual(parseUserInfo('upload=1; download=2'),{upload:1,download:2,total:0,expire:0});
  // Unknown keys, junk fields and non-numeric values are dropped instead of poisoning the numbers.
  assert.deepEqual(parseUserInfo('upload=1; reset_day=5; download=abc; total=-4; expire=1793000000'),{upload:1,download:0,total:0,expire:1793000000});
  // A millisecond expiry is unambiguous by magnitude, and an absurd one is noise, not a date.
  assert.equal(parseUserInfo('expire=1793000000000').expire,1793000000);
  assert.equal(parseUserInfo('expire=99999999999').expire,0);
  assert.equal(parseUserInfo('upload=1; expire=' + '9'.repeat(30)).expire,0);
  assert.equal(parseUserInfo('nothing useful'),null);
  assert.equal(parseUserInfo(undefined),null);
  assert.equal(parseUserInfo('x'.repeat(5000)),null);
});

test('subscription meta merges headers and body, with the body winning',()=>{
  const header = new Headers({'subscription-userinfo':'upload=1; download=2; total=3; expire=4'});
  assert.deepEqual(parseSubscriptionMeta('proxies: []',header),{userInfo:{upload:1,download:2,total:3,expire:4},updateIntervalHours:null});

  const body = 'profile-update-interval: 6\n#subscription-userinfo: upload=10; download=20; total=30; expire=1793000000\nproxies: []\n';
  assert.deepEqual(parseSubscriptionMeta(body),{userInfo:{upload:10,download:20,total:30,expire:1793000000},updateIntervalHours:6});

  // The provider's own line beats the header, and the header still supplies what the body omits.
  const merged = parseSubscriptionMeta('#subscription-userinfo: upload=10; download=20; total=30; expire=1793000000\n',new Headers({'subscription-userinfo':'upload=99; download=99; total=99; expire=99','profile-update-interval':'3'}));
  assert.deepEqual(merged,{userInfo:{upload:10,download:20,total:30,expire:1793000000},updateIntervalHours:3});

  // 0 is "the provider did not state it", which is why it survives as 0 instead of becoming null.
  assert.deepEqual(parseSubscriptionMeta('',new Headers({'subscription-userinfo':'upload=0; download=122190068697; total=0; expire=0'})),
    {userInfo:{upload:0,download:122190068697,total:0,expire:0},updateIntervalHours:null});

  // An out-of-range or malformed interval is ignored rather than clamped into a wrong schedule.
  for (const raw of ['0','-3','999','half','']) assert.equal(parseSubscriptionMeta('',new Headers({'profile-update-interval':raw})).updateIntervalHours,null,raw);
  assert.deepEqual(parseSubscriptionMeta('proxies: []'),{userInfo:null,updateIntervalHours:null});
});

test('imports nodes, neutralising dangerous top-level subscription settings',()=>{
  const parsed = parseSubscription(fixture+'tun:\n  enable: true\nexternal-controller: 0.0.0.0:9090\nlisteners:\n  - port: 8888\nscript: evil\n');
  const conf = assemble(parsed.raw, parsed.nodes, { dns: parsed.dns, selected: parsed.nodes[0].name });
  assert.equal(conf.tun.enable,false);assert.equal(conf.dns.enable,false);assert.equal(conf['allow-lan'],false);
  assert.equal(conf['bind-address'],'127.0.0.1');assert.equal(conf['external-controller'],'127.0.0.1:30002');
  assert.deepEqual(conf.authentication,['dsh:password']);assert.deepEqual(conf['skip-auth-prefixes'],[]);
  assert.deepEqual(conf.rules.slice(0,PRIORITY_RULES.length),PRIORITY_RULES);
  assert.equal(conf.rules.at(-1),'MATCH,DSH');
  for(const k of ['listeners','tunnels','script'])assert.equal(conf[k],undefined);
  assert.equal(conf['external-controller-pipe'],'');
});

test('same-region and local traffic is routed around the tunnel',()=>{
  const parsed = parseSubscription(fixture);
  const rules = assemble(parsed.raw, parsed.nodes).rules;
  // The model API answers from the same region; tunnelling it adds a round trip and risks a
  // foreign exit being throttled, so it must match a pre-MATCH rule.
  assert.ok(rules.includes('DOMAIN-SUFFIX,deepseek.com,DIRECT'));
  assert.ok(rules.includes('DOMAIN-SUFFIX,cn,DIRECT'));
  // The catch-all stays last: anything not exempted still has to leave through the proxy.
  assert.equal(rules.filter(r=>r.startsWith('MATCH,')).length,1);
  assert.equal(rules.indexOf('MATCH,DSH'),rules.length-1);
  // Every exemption sorts before the catch-all, so none of them can be dead weight.
  for(const rule of PRIORITY_RULES) assert.ok(rules.indexOf(rule)<rules.indexOf('MATCH,DSH'),rule);
});

test('loopback/private literals bypass, public hosts do not',()=>{
  for(const host of ['localhost','app.localhost','127.77.8.9','[::1]','0.0.0.0','[::ffff:127.0.0.1]','[::ffff:7f00:1]','10.1.2.3','192.168.1.5','172.31.1.5','[fc00::1]']) assert.equal(isLocalHost(host),true,host);
  for(const host of ['api.example.com','8.8.8.8','172.32.1.5','[2606:4700:4700::1111]'])assert.equal(isLocalHost(host),false,host);
});

test('node validation rejects aliases, duplicate names and file credentials',()=>{
  assert.throws(()=>parseNodes('proxies: &nodes [*nodes]'));
  assert.throws(()=>parseNodes(fixture+fixture.split('proxies:\n')[1]));
  assert.throws(()=>parseNodes(fixture+'    skip-cert-verify: "true"\n'));
  assert.throws(()=>parseNodes(fixture+'    private-key: C:\\secret.key\n'));
  assert.throws(()=>parseNodes(fixture+'    dialer-proxy: other\n'));
  assert.throws(()=>parseNodes('c3M6Ly9leGFtcGxl'));
});

// A provider whose nodes use a private hostname resolvable only by its own DoH, and whose
// nodes require skipping certificate verification. Both must survive import, or no node works.
const providerYaml = `
dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-filter: ['*']
  use-hosts: true
  nameserver: ['223.5.5.5', 'not a resolver']
  proxy-server-nameserver:
    - 'https://public-dns.example.com:843/dns-query/11111111-2222-3333-4444-555555555555'
    - 'https://47.116.33.162:8443/dns-query/11111111-2222-3333-4444-555555555555#skip-cert-verify=true'
  proxy-server-nameserver-policy:
    'private.node': ['https://public-dns.example.com:843/dns-query/11111111-2222-3333-4444-555555555555']
    '../evil': ['8.8.8.8']
  nameserver-policy:
    'bank.example': ['1.2.3.4']
proxies:
  - {name: a, type: anytls, server: private.node, port: 443, skip-cert-verify: true, sni: cdn.example.com}
  - {name: b, type: http, server: 10.0.0.1, port: 8080, skip-cert-verify: false}
tun:
  enable: true
listeners:
  - port: 8888
`;

test('provider TLS and proxy-server DNS requirements survive import, unsafe parts do not',()=>{
  const { nodes, dns, insecureTls } = parseSubscription(providerYaml);
  assert.equal(nodes.length,2);
  assert.equal(nodes[0]['skip-cert-verify'],true,'node TLS setting must be honoured, not rewritten');
  assert.equal(nodes[1]['skip-cert-verify'],false);
  assert.equal(nodes[0].sni,'cdn.example.com');
  assert.equal(insecureTls,1);
  // fake-ip, hosts files and generic DNS policy must not reach the core
  assert.equal(dns['enhanced-mode'],'normal');assert.equal(dns['use-hosts'],false);assert.equal(dns['use-system-hosts'],false);assert.equal(dns.ipv6,false);
  assert.equal(dns['fake-ip-filter'],undefined);assert.equal(dns['nameserver-policy'],undefined);
  assert.deepEqual(dns.nameserver,['223.5.5.5']);
  assert.equal(dns['proxy-server-nameserver'].length,2);
  assert.deepEqual(Object.keys(dns['proxy-server-nameserver-policy']),['private.node']);
  const conf = assemble(null, nodes, { dns });
  assert.equal(conf.dns.enable,true);assert.equal(conf.tun.enable,false);assert.equal(conf.listeners,undefined);
  assert.equal(conf.script,undefined);assert.equal(conf['external-ui'],'');
});

test('sanitizeDns refuses a DNS block that cannot resolve proxy servers',()=>{
  assert.equal(sanitizeDns(undefined),null);
  assert.equal(sanitizeDns({enable:false}),null);
  assert.equal(sanitizeDns({enable:true,'enhanced-mode':'fake-ip'}),null);
  assert.equal(sanitizeDns({enable:true,'default-nameserver':['1.1.1.1']}),null);
});

test('controlled selection is persisted in group order',()=>{
  const nodes=parseNodes(fixture);nodes.push({...nodes[0],name:'second'});
  assert.deepEqual(assemble(null, nodes, { selected:'second' })['proxy-groups'][0].proxies,['second','example']);
});

test('child environment strips hooks, overrides, path escape and proxy settings',()=>{
  const env=coreEnvironment('owned',{SystemRoot:'C:\\Windows',CLASH_POST_UP:'evil.exe',CLASH_CONFIG_STRING:'evil',CLASH_OVERRIDE_SECRET:'evil',SAFE_PATHS:'C:\\',SKIP_SAFE_PATH_CHECK:'true',HTTP_PROXY:'evil',PATH:'evil',NODE_OPTIONS:'evil'});
  assert.deepEqual(env,{HOME:'owned',USERPROFILE:'owned',SKIP_SAFE_PATH_CHECK:'false',SystemRoot:'C:\\Windows'});
});

test('subscription URL policies do not allow plaintext public credentials',()=>{
  assert.equal(validateSubscriptionUrl('https://example.com/secret?token=x'),'https://example.com/secret?token=x');
  assert.equal(validateSubscriptionUrl('http://127.0.0.1:123/config'),'http://127.0.0.1:123/config');
  for(const url of ['http://example.com','https://user:pass@example.com','file:///secret','https://example.com/#secret'])assert.throws(()=>validateSubscriptionUrl(url));
});

test('log redaction removes endpoints and tokens before text leaves the Host',()=>{
  const line = 'level=error msg="dial https://public-dns-muck.sailing.example:843/dns-query/11111111-2222-3333-4444-555555555555 failed"';
  const out = redactLog(line);
  assert.ok(!out.includes('sailing.example'));
  assert.ok(!out.includes('11111111-2222-3333-4444-555555555555'));
});

test('the plan a provider writes into node names is readable without downloading it again',()=>{
  const nodes = [
    { name: '剩余流量：98.79 GB', type: 'vless', server: 'info.example', port: 1 },
    { name: '套餐到期：2026-11-11', type: 'vless', server: 'info.example', port: 2 },
    { name: 'JP日本 01 | IEPL', type: 'vless', server: 'jp.example', port: 443 },
  ];
  assert.deepEqual(parseImportInfo(nodes), { remaining: '98.79 GB', expireOn: '2026-11-11' });
  // Chinese colon, missing space and a half-width colon are all seen in the wild.
  assert.deepEqual(parseImportInfo([{ name: '剩余流量:1.5TB' }, { name: '到期：2027-01-02' }]),
    { remaining: '1.5TB', expireOn: '2027-01-02' });
  // Only one of the two facts is enough to be worth showing.
  assert.deepEqual(parseImportInfo([{ name: '剩余流量：12 GB' }]), { remaining: '12 GB', expireOn: null });
  // Ordinary node names must never be mistaken for a plan.
  assert.equal(parseImportInfo([{ name: 'JP日本 01 | IEPL' }, { name: 'HK 02' }]), null);
  assert.equal(parseImportInfo([]), null);
  assert.equal(parseImportInfo(null), null);
});
