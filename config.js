import { createHash } from 'node:crypto';
import path from 'node:path';
import { GROUP } from './policy.js';

/**
 * Managed config assembly.
 *
 * The previous design built a config from scratch and kept only `proxies`, so
 * every rule, group, provider and DNS policy the subscription shipped was
 * silently discarded; the plugin then had to guess a rule set of its own. This
 * assembles the other way round: start from the subscription document and
 * overwrite only the keys the plugin must own (ports, controller secret,
 * inbound authentication), which is what FlClash does in
 * `lib/common/task.dart:makeRealProfileTask`.
 *
 * Keeping a document we did not author means every key becomes attack surface,
 * so the same routine also strips or blanks the keys that let a subscription
 * take over the host: inbound servers, listeners, TUN, interface binding,
 * firewall marks, the unauthenticated unix/pipe controllers, an external UI
 * directory, hosts overrides, the sniffer, and local-file providers. Those are
 * not defensive extras — they are the price of inheriting anything at all.
 */

/** Proxy group types mihomo accepts; a group of another type would fail `-t`. */
const GROUP_TYPES = new Set(['select', 'url-test', 'fallback', 'load-balance', 'relay']);

/** Names a group may reference without the subscription having to define them. */
const BUILTIN_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL']);

/**
 * Keys removed outright. Everything here either opens an inbound server, binds
 * the host's interfaces, or lets the document point the core at a path of its
 * choosing; none of it is needed to route outbound traffic.
 */
const STRIPPED = [
  'tunnels', 'listeners', 'iptables', 'ss-config', 'vmess-config', 'tuic-server',
  'sniffer', 'hosts', 'script', 'sub-rules', 'ntp', 'geox-url', 'experimental',
  'interface-name', 'routing-mark', 'captive-portal',
];

/** Policy keys whose copied values must never survive into the managed file. */
const BLANKED = {
  'external-ui': '',
  'external-ui-url': '',
  'external-controller-unix': '',
  'external-controller-pipe': '',
  'external-controller-tls': '',
  'skip-auth-prefixes': [],
  'bind-address': '127.0.0.1',
};

const RULE_TYPES = /^[A-Z][A-Z0-9-]{0,39}$/;
const MAX_RULES = 20000;
const MAX_GROUPS = 512;
const MAX_PROVIDERS = 128;
const MAX_RULE_LENGTH = 4096;
const PROVIDER_URL = /^https?:\/\/[^\s"'`]{1,2048}$/i;

const md5 = value => createHash('md5').update(value).digest('hex');

/**
 * Rules the plugin wins before any inherited routing. Private ranges must not
 * reach a remote node (it would fail and leak nothing useful), and the model API
 * is domestic: tunnelling it adds a foreign round trip to every request.
 */
export const PRIORITY_RULES = [
  'DOMAIN-SUFFIX,deepseek.com,DIRECT',
  'DOMAIN-SUFFIX,cn,DIRECT',
  'DOMAIN-SUFFIX,localhost,DIRECT',
  'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
  'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
  'IP-CIDR6,::1/128,DIRECT,no-resolve',
  'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
];

/**
 * Hosts that only answer through the tunnel. The Codex/GPT upstream is why this
 * list exists: it is reachable only via the node while DeepSeek is not, so these
 * are pinned to the selector and a provider rule cannot quietly send them direct.
 */
export const UPSTREAM_HOSTS = ['chatgpt.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Target of a rule line, or null when the line is malformed or not a string. */
function ruleTargetOf(rule) {
  if (typeof rule !== 'string' || rule.length > MAX_RULE_LENGTH) return null;
  const fields = rule.split(',').map(field => field.trim());
  if (fields.length < 2 || !RULE_TYPES.test(fields[0])) return null;
  // MATCH/FINAL carry no payload, so their target is the second field.
  const targetAt = ['MATCH', 'FINAL'].includes(fields[0].toUpperCase()) ? 1 : 2;
  if (fields.length <= targetAt) return null;
  return { fields, targetAt };
}

function retarget(rule, replace) {
  const parsed = ruleTargetOf(rule);
  if (!parsed) return rule;
  const { fields, targetAt } = parsed;
  const next = replace.get(fields[targetAt]);
  if (!next) return rule;
  fields[targetAt] = next;
  return fields.join(',');
}

/**
 * Keep the groups the subscription defined, repairing references to things that
 * are not present (a node our validator refused, a provider we dropped) and
 * dropping groups left with nothing to choose from. A group whose members are
 * all missing would make `-t` fail, which would take the whole proxy down.
 */
function repairGroups(raw, { nodes, providerNames, selected }) {
  const groupNames = new Set();
  for (const group of Array.isArray(raw['proxy-groups']) ? raw['proxy-groups'] : []) {
    if (isPlainObject(group) && typeof group.name === 'string' && group.name.trim()) groupNames.add(group.name);
  }
  const nodeNames = new Set(nodes.map(node => node.name));
  const usable = new Set([...nodeNames, ...BUILTIN_TARGETS, ...providerNames, GROUP]);
  // A group may reference a sibling group, so names that survive stay usable.
  const dropped = new Map();

  const groups = [];
  const source = Array.isArray(raw['proxy-groups']) ? raw['proxy-groups'] : [];
  for (const group of source.slice(0, MAX_GROUPS)) {
    if (!isPlainObject(group)) continue;
    const name = typeof group.name === 'string' ? group.name.trim() : '';
    if (!name || name === GROUP || !GROUP_TYPES.has(String(group.type).toLowerCase())) continue;
    if (typeof group.type !== 'string') continue;
    const members = (Array.isArray(group.proxies) ? group.proxies : [])
      .filter(member => typeof member === 'string')
      .filter(member => member === name ? false : (usable.has(member) || groupNames.has(member)));
    const next = { ...group, name, proxies: [...new Set(members)] };
    if (!next.proxies.length) { dropped.set(name, GROUP); continue; }
    groups.push(next);
  }
  // A rule that names a dropped group is sent to the plugin's selector instead
  // of failing the whole configuration.
  const replace = new Map(dropped);
  for (const group of groups) {
    const members = group.proxies.map(member => replace.get(member) ?? member);
    group.proxies = [...new Set(members)];
  }
  const names = nodes.map(node => node.name);
  if (selected && names.includes(selected)) {
    names.splice(names.indexOf(selected), 1);
    names.unshift(selected);
  }
  const selector = { name: GROUP, type: 'select', proxies: names };
  return { groups: [selector, ...groups], replace, dropped: [...dropped.keys()] };
}

/**
 * Rewrite provider cache paths into the plugin's own directory. A provider's
 * `path` is where the core writes the downloaded document, so an unconstrained
 * one lets a subscription choose which file the core overwrites.
 */
function confineProviders(raw, { providerRoot, report }) {
  const providerNames = new Set();
  for (const section of ['proxy-providers', 'rule-providers']) {
    const providers = raw[section];
    if (!isPlainObject(providers)) { delete raw[section]; continue; }
    const kept = {};
    let count = 0;
    for (const [name, entry] of Object.entries(providers)) {
      if (count >= MAX_PROVIDERS) break;
      if (!isPlainObject(entry)) continue;
      const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
      if (type === 'file') {
        // A file provider reads a local path the subscription names.
        report.droppedProviders.push(`${section}:${name}`);
        continue;
      }
      if (type === 'inline') {
        const payload = entry.payload ?? entry.proxies ?? entry.rules;
        if (!Array.isArray(payload) || payload.length > 10000) continue;
        kept[name] = { ...entry, type: 'inline' };
        count += 1;
        if (section === 'proxy-providers') providerNames.add(name);
        continue;
      }
      if (type !== 'http' || !PROVIDER_URL.test(String(entry.url ?? ''))) {
        report.droppedProviders.push(`${section}:${name}`);
        continue;
      }
      const safeName = String(name).slice(0, 100);
      kept[safeName] = {
        ...entry,
        type: 'http',
        path: path.join(providerRoot, `${md5(`${section}/${safeName}/${entry.url}`)}.yaml`),
      };
      count += 1;
      if (section === 'proxy-providers') providerNames.add(safeName);
    }
    if (Object.keys(kept).length) raw[section] = kept;
    else delete raw[section];
  }
  return providerNames;
}

/**
 * Assemble the managed document.
 *
 * @param {object} options
 * @param {object|null} options.raw parsed subscription document, or null when
 *   the plugin has only validated nodes (pasted config, restored state)
 * @param {object[]} options.nodes validated inline proxies
 * @param {number} options.mixedPort inbound proxy port
 * @param {number} options.apiPort controller port
 * @param {string} options.apiSecret controller secret
 * @param {string} options.proxyPassword inbound auth password
 * @param {string} options.providerRoot directory the core may cache providers in
 * @param {object|null} options.dns sanitised proxy-server DNS block
 * @param {string|null} options.selected selected node
 */
export function assembleConfig(options) {
  const {
    raw, nodes, mixedPort, apiPort, apiSecret, proxyPassword,
    providerRoot, dns = null, selected = null,
  } = options;
  const report = {
    inherited: Boolean(raw), groups: 0, rules: 0, droppedGroups: [],
    droppedProviders: [], stripped: [], retargeted: 0,
  };

  const base = isPlainObject(raw) ? structuredClone(raw) : {};
  for (const key of STRIPPED) {
    if (key in base) { delete base[key]; report.stripped.push(key); }
  }
  // Inbound servers and the unauthenticated control sockets stay closed; the
  // plugin talks to the controller over a loopback TCP port with a secret.
  for (const [key, value] of Object.entries(BLANKED)) base[key] = value;
  if ('tun' in base) {
    const tun = isPlainObject(base.tun) ? base.tun : {};
    base.tun = { ...tun, enable: false, 'auto-route': false, 'auto-detect-interface': false };
  }

  const providerNames = confineProviders(base, { providerRoot, report });
  const { groups, replace, dropped } = repairGroups(base, { nodes, providerNames, selected });
  report.groups = groups.length;
  report.droppedGroups = dropped;

  const inherited = (Array.isArray(base.rules) ? base.rules : [])
    .filter(rule => typeof rule === 'string' && rule.length > 0 && rule.length <= MAX_RULE_LENGTH)
    .slice(0, MAX_RULES)
    .map(rule => {
      const next = retarget(rule, replace);
      if (next !== rule) report.retargeted += 1;
      return next;
    });
  // The subscription's own final MATCH must land on the plugin's selector, or
  // the node picker would have no effect on traffic the subscription routes.
  let matched = false;
  const rules = [];
  for (let index = 0; index < inherited.length; index += 1) {
    const rule = inherited[index];
    const parsed = ruleTargetOf(rule);
    const isFinal = parsed && ['MATCH', 'FINAL'].includes(parsed.fields[0].toUpperCase());
    if (isFinal) {
      if (matched) continue;
      matched = true;
      rules.push(parsed ? replaceRuleTarget(rule, parsed, GROUP) : rule);
      continue;
    }
    rules.push(rule);
  }
  if (!matched) rules.push(`MATCH,${GROUP}`);
  report.rules = rules.length;

  // Hosts that are unreachable without the tunnel go through the selector the
  // operator picked, ahead of every inherited rule.
  const upstreamRules = UPSTREAM_HOSTS.map(host => `DOMAIN-SUFFIX,${host},${GROUP}`);

  const config = {
    ...base,
    'mixed-port': mixedPort,
    port: 0, 'socks-port': 0, 'redir-port': 0, 'tproxy-port': 0,
    'allow-lan': false,
    'bind-address': '127.0.0.1',
    'external-controller': `127.0.0.1:${apiPort}`,
    secret: apiSecret,
    authentication: [`dsh:${proxyPassword}`],
    'skip-auth-prefixes': [],
    mode: 'rule',
    'log-level': 'warning',
    ipv6: false,
    'find-process-mode': 'off',
    'geo-auto-update': false,
    tun: { ...(isPlainObject(base.tun) ? base.tun : {}), enable: false, 'auto-route': false, 'auto-detect-interface': false },
    dns: dns ? { ...dns } : { enable: false, ipv6: false },
    profile: { 'store-selected': false, 'store-fake-ip': false },
    proxies: nodes,
    'proxy-groups': groups,
    rules: [...upstreamRules, ...PRIORITY_RULES, ...rules],
  };
  for (const key of ['proxy-providers', 'rule-providers']) if (!(key in config)) delete config[key];
  return { config, report };
}

function replaceRuleTarget(rule, parsed, target) {
  const fields = parsed.fields;
  fields[parsed.targetAt] = target;
  return fields.join(',');
}

/** Every target a rule line can point at, for validating an assembled document. */
export function referencedTargets(config) {
  const seen = new Set();
  for (const rule of Array.isArray(config?.rules) ? config.rules : []) {
    const parsed = ruleTargetOf(rule);
    if (parsed) seen.add(parsed.fields[parsed.targetAt]);
  }
  return seen;
}
