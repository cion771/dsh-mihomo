import { parseDocument, stringify } from 'yaml';
import { isIP } from 'node:net';

export const GROUP = 'DSH';
export const CORE_VERSION = 'v1.19.32';
export const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(['ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic', 'http', 'socks5', 'snell', 'anytls']);
const NODE_KEYS = new Set(['name','type','server','port','udp','udp-over-tcp','udp-over-tcp-version','ip-version','cipher','password','username','uuid','alterId','network','tls','servername','sni','alpn','skip-cert-verify','fingerprint','client-fingerprint','ws-opts','http-opts','h2-opts','grpc-opts','reality-opts','smux','flow','packet-encoding','global-padding','authenticated-length','plugin','plugin-opts','protocol','protocol-param','obfs','obfs-param','obfs-password','up','down','up-speed','down-speed','auth','auth-str','recv-window-conn','recv-window','disable-mtu-discovery','fast-open','hop-interval','ports','token','heartbeat-interval','reduce-rtt','request-timeout','udp-relay-mode','congestion-controller','max-open-streams','max-udp-relay-packet-size','version','idle-session-check-interval','idle-session-timeout','min-idle-session']);
const FORBIDDEN = new Set(['interface-name', 'routing-mark', 'dialer-proxy', 'certificate', 'private-key', 'ca', 'ca-str', 'client-fingerprint-path']);
/** DoH/DoT/DoQ endpoint forms a subscription may legitimately use for its own proxy-server lookups. */
const DNS_URL = /^(?:https|tls|quic|h3):\/\/[^\s"'`]{1,400}$/;
const DNS_POLICY_KEY = /^[*+]?\.?[a-z0-9][a-z0-9.\-]{0,251}$/i;

export function isLocalHost(hostname) {
  let host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.startsWith('::ffff:')) {
    const tail = host.slice(7);
    if (tail.includes('.')) host = tail;
    else { const parts = tail.split(':'); if (parts.length === 2) { const n = parseInt(parts[0],16)*65536+parseInt(parts[1],16); host = [n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join('.'); } }
  }
  if (isIP(host) === 4) {
    const [a,b] = host.split('.').map(Number);
    return a === 0 || a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(host) === 6) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return false;
}

export function validateSubscriptionUrl(input) {
  if (typeof input !== 'string' || input.length > 8192) throw new Error('Subscription URL is invalid.');
  let url; try { url = new URL(input.trim()); } catch { throw new Error('Subscription URL is invalid.'); }
  if (url.username || url.password || url.hash) throw new Error('Use a subscription URL without URL credentials or fragments.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) throw new Error('Subscription must use HTTPS (HTTP is allowed only for a local endpoint).');
  return url.href;
}

function inspectNode(value, depth = 0) {
  if (depth > 16) throw new Error('Node configuration is too deeply nested.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { if (value.length > 2048) throw new Error('Node array is too large.'); value.forEach(v => inspectNode(v,depth+1)); return; }
  if (typeof value !== 'object') throw new Error('Unsupported node value.');
  for (const [key,v] of Object.entries(value)) {
    if (key === 'skip-cert-verify') {
      // Honoured as the provider states it: a subscription that requires this
      // cannot work without it, and silently rewriting it breaks every node.
      if (typeof v !== 'boolean') throw new Error('skip-cert-verify must be a boolean.');
      continue;
    }
    if (['__proto__','constructor','prototype'].includes(key) || FORBIDDEN.has(key) || /(?:^|[-_])(path|file|script|command|exec)(?:$|[-_])/.test(key) && !['path'].includes(key)) throw new Error('File paths, scripts, interface binding, and proxy chaining are not accepted in nodes.');
    // WebSocket/HTTP transport path is a URL path, not a filesystem path.
    inspectNode(v,depth+1);
  }
}

function validDnsEntry(entry) {
  if (typeof entry !== 'string' || entry.length < 1 || entry.length > 512) return false;
  if (isIP(entry.replace(/^\[|\]$/g, '')) !== 0) return true;
  return DNS_URL.test(entry);
}

/**
 * Keep only the parts of a subscription's DNS block that resolve *proxy server*
 * hostnames. Providers legitimately hand out nodes whose `server` is a private
 * name that only their own DoH can resolve; dropping that block makes every such
 * node unreachable. Everything else is discarded: fake-ip, hosts files, generic
 * `nameserver-policy`, and any DNS listener stay out of the managed config.
 */
export function sanitizeDns(raw) {
  if (!raw || typeof raw !== 'object' || raw.enable !== true) return null;
  const clean = list => (Array.isArray(list) ? list : []).filter(validDnsEntry).slice(0, 8);
  const out = { enable: true, ipv6: false, 'use-hosts': false, 'use-system-hosts': false, 'enhanced-mode': 'normal' };
  const bootstrap = clean(raw['default-nameserver']);
  out['default-nameserver'] = bootstrap.length ? bootstrap : ['223.5.5.5', '119.29.29.29'];
  const nameserver = clean(raw.nameserver);
  if (nameserver.length) out.nameserver = nameserver;
  const proxyServers = clean(raw['proxy-server-nameserver']);
  if (proxyServers.length) out['proxy-server-nameserver'] = proxyServers;
  const policy = {};
  for (const [key, value] of Object.entries(raw['proxy-server-nameserver-policy'] ?? {})) {
    if (!DNS_POLICY_KEY.test(key)) continue;
    const list = clean(value);
    if (list.length) policy[key] = list;
  }
  if (Object.keys(policy).length) out['proxy-server-nameserver-policy'] = policy;
  if (!out.nameserver && !out['proxy-server-nameserver'] && !Object.keys(policy).length) return null;
  return out;
}

/** Parse Clash/Mihomo YAML into managed nodes plus the sanitized proxy-server DNS block. */
export function parseSubscription(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new Error('Configuration exceeds 8 MiB.');
  const doc = parseDocument(text, { uniqueKeys: true, customTags: [] });
  if (doc.errors.length) throw new Error('Invalid Clash/Mihomo YAML.');
  let data; try { data = doc.toJS({ maxAliasCount: 0 }); } catch { throw new Error('YAML aliases are not accepted.'); }
  const rawNodes = Array.isArray(data) ? data : data?.proxies ?? data?.payload;
  if (!Array.isArray(rawNodes) || rawNodes.length < 1 || rawNodes.length > 2048) throw new Error('Provide Clash/Mihomo YAML with 1–2048 inline proxies; provider-only and base64/URI subscriptions are not supported.');
  const names = new Set(['DIRECT', 'REJECT', GROUP, 'GLOBAL']);
  const nodes = rawNodes.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid proxy node.');
    if (Object.keys(raw).some(key => !NODE_KEYS.has(key))) throw new Error('Unsupported node setting; only reviewed outbound settings are accepted.');
    inspectNode(raw);
    const node = JSON.parse(JSON.stringify(raw));
    if (!TYPES.has(node.type)) throw new Error('Unsupported proxy type.');
    if (typeof node.name !== 'string' || !node.name.trim() || node.name.length > 200 || /[\u0000-\u001f]/.test(node.name) || names.has(node.name)) throw new Error('Node names must be unique, non-reserved, and at most 200 characters.');
    if (typeof node.server !== 'string' || !node.server || node.server.length > 1024 || typeof node.port !== 'number' || !Number.isInteger(node.port) || node.port < 1 || node.port > 65535) throw new Error('Every proxy needs a server and a numeric port.');
    // Plugins are Mihomo built-ins only, never an executable filename.
    if (node.plugin && !['obfs','v2ray-plugin','shadow-tls','restls'].includes(node.plugin)) throw new Error('Unknown Shadowsocks plugin.');
    names.add(node.name);
    return node;
  });
  return { nodes, dns: sanitizeDns(data?.dns), insecureTls: nodes.filter(n => n['skip-cert-verify'] === true).length };
}

export function parseNodes(text) { return parseSubscription(text).nodes; }

export function controlledConfig(nodes, { mixedPort, apiPort, apiSecret, proxyPassword, selected, dns }) {
  const names = nodes.map(n => n.name);
  if (selected && names.includes(selected)) names.splice(names.indexOf(selected),1), names.unshift(selected);
  return {
    'mixed-port': mixedPort,
    port: 0, 'socks-port': 0, 'redir-port': 0, 'tproxy-port': 0,
    'allow-lan': false, 'bind-address': '127.0.0.1',
    authentication: [`dsh:${proxyPassword}`], 'skip-auth-prefixes': [],
    'external-controller': `127.0.0.1:${apiPort}`,
    secret: apiSecret, mode: 'rule', 'log-level': 'warning', ipv6: false,
    tun: { enable: false }, dns: dns ? { ...dns } : { enable: false, ipv6: false },
    'profile': { 'store-selected': false, 'store-fake-ip': false },
    proxies: nodes,
    'proxy-groups': [{ name: GROUP, type: 'select', proxies: names }],
    rules: [`MATCH,${GROUP}`],
  };
}

export function encodeConfig(config) { return stringify(config, { lineWidth: 0 }); }
export function coreEnvironment(dataDir, env = process.env) {
  const out = { HOME: dataDir, USERPROFILE: dataDir, SKIP_SAFE_PATH_CHECK: 'false' };
  for (const key of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP']) if (env[key]) out[key] = env[key];
  return out;
}

/** Redact anything URL-shaped or secret-looking before text reaches a model or session log. */
export function redactLog(text) {
  return String(text)
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/gi, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<token>')
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, '<token>');
}
