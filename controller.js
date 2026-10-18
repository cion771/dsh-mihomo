import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { Agent, Pool, ProxyAgent, fetch as httpFetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { unzipSync } from 'fflate';
import { normalizeTimeZone } from './timezone.js';
import { GROUP, CORE_VERSION, MAX_CONFIG_BYTES, isLocalHost, parseSubscription, parseSubscriptionMeta, parseImportInfo, parseNodes, sanitizeDns, validateSubscriptionUrl, encodeConfig, coreEnvironment, redactLog } from './policy.js';
import { assembleConfig } from './config.js';

const MAX_ARCHIVE = 48 * 1024 * 1024;
const MAX_EXE = 100 * 1024 * 1024;
/** Neutral reachability targets; a provider may block one, so any success counts. */
const PROBE_URLS = ['http://www.gstatic.com/generate_204', 'http://cp.cloudflare.com/generate_204', 'http://www.msftconnecttest.com/connecttest.txt'];
/** Connections reported back to the panel; the list is a snapshot, not an archive. */
const MAX_LIVE_CONNECTIONS = 40;
const RELEASE_HOSTS = new Set(['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const token = () => randomBytes(24).toString('hex');

/**
 * The inherited subscription document is re-read from state.json on every start,
 * so it is validated like any other stored input: a plain object of bounded size,
 * never a value that would make the core load something we did not inspect.
 */
function recoverRaw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    return JSON.stringify(raw).length > MAX_CONFIG_BYTES ? null : raw;
  } catch { return null; }
}

async function safeDirectory(dir) {
  const full = path.resolve(dir);
  await fs.mkdir(full, { recursive: true, mode: 0o700 });
  let current = full;
  for (;;) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Managed storage must not contain symlinks or junctions.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return full;
}

async function safeFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Managed file is not a regular file.');
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

async function atomicWrite(file, bytes) {
  await safeDirectory(path.dirname(file));
  await safeFile(file);
  const temp = `${file}.${token()}.tmp`;
  try {
    await fs.writeFile(temp, bytes, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

async function readBounded(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Response exceeds the download limit.'); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let total = 0; const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error('Response exceeds the download limit.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/**
 * Automatic refresh runs on a coarse tick that only compares timestamps. A fixed short interval
 * costs nothing, lets a changed interval take effect at once, and makes a laptop that was asleep
 * refresh on the next tick instead of waiting out a long timer.
 */
const REFRESH_TICK_MS = 5 * 60 * 1000;

/** Restore a persisted usage snapshot; every field must look like something a provider could send. */
function normalizeUserInfo(value) {
  if (!value || typeof value !== 'object') return null;
  const count = key => (Number.isSafeInteger(value[key]) && value[key] >= 0 ? value[key] : 0);
  return { upload: count('upload'), download: count('download'), total: count('total'), expire: count('expire') };
}

function normalizeTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** The import-time plan snapshot: text the provider baked into node names, kept only as a fallback. */
function normalizeImportInfo(value) {
  if (!value || typeof value !== 'object') return null;
  const remaining = typeof value.remaining === 'string' ? value.remaining.slice(0, 24) : null;
  const expireOn = typeof value.expireOn === 'string' ? value.expireOn.slice(0, 10) : null;
  const at = normalizeTimestamp(value.at);
  return remaining === null && expireOn === null ? null : { remaining, expireOn, at };
}

/** 0 disables automatic refresh; anything else is a whole number of hours within a month. */
export function normalizeRefreshHours(value) {
  return Number.isInteger(value) && value >= 0 && value <= 720 ? value : 0;
}

/**
 * Reserves the loopback ports the core will bind. A previously used mixed port is
 * preferred so the address published to other clients survives a restart; when it
 * is taken the kernel picks a fresh one and the published value is rewritten.
 */
export async function reservePorts(preferred) {
  const servers = [];
  const listen = (server, port) => new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  try {
    const first = createServer(); servers.push(first);
    try {
      await listen(first, Number.isInteger(preferred) && preferred > 0 ? preferred : 0);
    } catch {
      await listen(first, 0);
    }
    const second = createServer(); servers.push(second);
    await listen(second, 0);
    return servers.map(s => s.address().port);
  } finally { await Promise.all(servers.map(s => new Promise(resolve => s.close(() => resolve())))); }
}

/**
 * Environment-reader clients (notably the Codex/GPT upstream, which resolves its
 * proxy from `HTTPS_PROXY`/`NO_PROXY` and plain `node:https`, never from the
 * undici global dispatcher) can only be routed by these variables. Same-region
 * and loopback hosts stay direct: DeepSeek needs no tunnel, and sending the
 * local port through itself would loop.
 */
const PROXY_ENV_KEYS = ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy','BILI_UPSTREAM_PROXY','BILI_UPSTREAM_PROXY_MODE'];
const PROXY_ENV_DIRECT = 'localhost,127.0.0.1,deepseek.com,.cn';
/** Where billion-context reads its own settings; mirrored so it can find us. */
export const UPSTREAM_CONFIG = path.join(os.homedir(), '.config', 'billion-context', 'billion-context.json');

export function createProcessDispatcher({ mixedPort, proxyPassword }) {
  const proxy = `http://127.0.0.1:${mixedPort}`;
  const authorization = `Basic ${Buffer.from(`dsh:${proxyPassword}`).toString('base64')}`;
  return new Agent({ factory(origin, options) {
    if (isLocalHost(new URL(origin).hostname)) return new Pool(origin, options);
    return new ProxyAgent({ ...options, uri: proxy, token: authorization, proxyTunnel: true });
  } });
}

export class MihomoController {
  constructor(dataDir, options = {}) {
    this.dataDir = path.resolve(dataDir);
    this.direct = new Agent(); // Bootstrap and controller requests never use our process proxy.
    this.baseline = getGlobalDispatcher();
    this.fetch = options.fetch ?? httpFetch;
    this.spawn = options.spawn ?? spawn;
    this.upstreamConfig = options.upstreamConfig ?? null;
    this.ports = options.reservePorts ?? reservePorts;
    this.probeImpl = options.probe;
    this.state = { timeZone: null, autoStart: false, subscriptionUrl: '', nodes: [], raw: null, dns: null, insecureTls: 0, insecureSubscriptionTls: false, proxyEnv: true, mixedPort: 0, selected: '', updatedAt: null, userInfo: null, userInfoAt: null, importInfo: null, autoRefreshHours: 0, lastRefreshAt: null, lastRefreshErrorAt: null, lastRefreshError: null };
    this.kernel = null;
    this.phase = 'stopped'; this.error = null;
    this.child = null; this.session = null; this.dispatcher = null; this.logStream = null;
    this.queue = Promise.resolve(); this.disposed = false;
    this.refreshTimer = null; this.refreshing = false;
    this.relaxed = null;
    this.envSaved = null;
    this.report = null;
  }
  file(name) { return path.join(this.dataDir,name); }

  /**
   * A direct dispatcher that accepts any certificate, created only when the
   * operator asks for it. It exists for one host: a subscription endpoint whose
   * own TLS is broken (an expired or self-signed provider certificate), where
   * the alternative is that refresh, usage and config inheritance stop working
   * until a third party fixes their server. It is never used for the core
   * download, whose bytes are then checked against a pinned digest, and never
   * installed globally, so model and tool traffic keep normal verification.
   */
  relaxedDispatcher() {
    this.relaxed ??= new Agent({ connect: { rejectUnauthorized: false } });
    return this.relaxed;
  }

  /**
   * Publishes the running proxy to environment-reading clients and remembers the
   * previous values so stop() can put the process back exactly as it was. A
   * crash without stop() would leave them set, which is why they are also cleared
   * by dispose() and re-applied only while a session exists.
   */
  applyProxyEnv() {
    if (this.state.proxyEnv !== true || this.envSaved || !this.session) return;
    // No credentials in the URL: loopback is exempt from the inbound account, and
    // a password here would be inherited by every child process the Host starts.
    const proxy = `http://127.0.0.1:${this.session.mixedPort}`;
    const saved = {};
    for (const key of PROXY_ENV_KEYS) saved[key] = process.env[key];
    for (const key of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy']) process.env[key] = proxy;
    const merged = [saved.NO_PROXY, saved.no_proxy, PROXY_ENV_DIRECT].map(v => v?.trim?.()).filter(Boolean).join(',');
    process.env.NO_PROXY = merged;
    process.env.no_proxy = merged;
    // billion-context reads these directly and gives them priority over anything else.
    process.env.BILI_UPSTREAM_PROXY = proxy;
    process.env.BILI_UPSTREAM_PROXY_MODE = 'manual';
    this.envSaved = saved;
  }

  /**
   * billion-context relays the model traffic and resolves its upstream proxy once,
   * at start-up. Its default mode is a deliberate "direct" that ignores
   * HTTP(S)_PROXY, so the environment above cannot reach it; its own settings file
   * is the supported channel. The file is only rewritten when the value differs,
   * it is never created from nothing when it holds other settings we cannot read,
   * and `upstreamProxyMode: manual` is written with it so the value is not ignored.
   */
  async publishUpstream() {
    if (this.state.proxyEnv !== true || !this.session || !this.upstreamConfig) return null;
    const file = this.upstreamConfig;
    const want = `http://127.0.0.1:${this.session.mixedPort}`;
    let current;
    try {
      const raw = await fs.readFile(file, 'utf8');
      current = raw.trim() ? JSON.parse(raw) : {};
    } catch (error) {
      if (error.code !== 'ENOENT') return null;
      current = {};
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    if (current.upstreamProxy === want && current.upstreamProxyMode === 'manual') return want;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, `${JSON.stringify({ ...current, upstreamProxy: want, upstreamProxyMode: 'manual' }, null, 2)}\n`);
    return want;
  }

  /** Removes only the two keys publishUpstream owns, leaving the rest untouched. */
  async retractUpstream() {
    const file = this.upstreamConfig;
    if (!file) return false;
    let current;
    try { current = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return false; }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
    if (!('upstreamProxy' in current) && !('upstreamProxyMode' in current)) return false;
    const { upstreamProxy, upstreamProxyMode, ...rest } = current;
    await atomicWrite(file, `${JSON.stringify(rest, null, 2)}\n`);
    return true;
  }

  clearProxyEnv() {
    if (!this.envSaved) return;
    for (const key of PROXY_ENV_KEYS) {
      if (this.envSaved[key] === undefined) delete process.env[key];
      else process.env[key] = this.envSaved[key];
    }
    this.envSaved = null;
  }

  /**
   * Assemble the document the core serves: the subscription's own routing and
   * groups, with the keys the plugin owns (ports, controller secret, inbound
   * authentication, TUN) overwritten. `report` records what was inherited and
   * what had to be dropped so the panel can say so instead of guessing.
   */
  managedConfig(state = this.state, session = this.session) {
    if (!session) throw new Error('The proxy has not reserved ports yet.');
    const { config, report } = assembleConfig({
      raw: state.raw,
      nodes: state.nodes,
      mixedPort: session.mixedPort,
      apiPort: session.apiPort,
      apiSecret: session.apiSecret,
      proxyPassword: session.proxyPassword,
      providerRoot: this.file('providers'),
      dns: state.dns,
      selected: state.selected,
    });
    this.report = report;
    return config;
  }

  async init() {
    await safeDirectory(this.dataDir);
    await safeDirectory(path.join(this.dataDir,'providers'));
    for (const name of ['state.json','kernel.json','mihomo.exe','managed.yaml']) await safeFile(this.file(name));
    try {
      const stat = await fs.stat(this.file('state.json'));
      if (stat.size > MAX_CONFIG_BYTES * 2) throw new Error('Saved state exceeds the limit.');
      const stored = JSON.parse(await fs.readFile(this.file('state.json'),'utf8'));
      const nodes = stored.nodes?.length ? parseNodes(encodeConfig({proxies:stored.nodes})) : [];
      // Older state files predate the snapshot field, so recover it from the node names that were
      // saved with them: otherwise an already-imported plan would stay invisible until the next
      // successful download, which is exactly what an unreachable subscription prevents.
      const recovered = normalizeImportInfo(stored.importInfo)
        ?? (parseImportInfo(nodes) ? { ...parseImportInfo(nodes), at: normalizeTimestamp(stored.updatedAt) } : null);
      this.state = {
        timeZone: normalizeTimeZone(stored.timeZone ?? ''),
        autoStart: stored.autoStart === true,
        subscriptionUrl: stored.subscriptionUrl ? validateSubscriptionUrl(stored.subscriptionUrl) : '',
        nodes,
        raw: recoverRaw(stored.raw),
        dns: sanitizeDns(stored.dns),
        insecureTls: nodes.filter(n => n['skip-cert-verify'] === true).length,
        insecureSubscriptionTls: stored.insecureSubscriptionTls === true,
        // Absent in older state files, which predate the option: those installs
        // asked for the tunnel to be usable by GPT clients, so default it on.
        proxyEnv: stored.proxyEnv !== false,
      mixedPort: Number.isInteger(stored.mixedPort) && stored.mixedPort > 0 ? stored.mixedPort : 0,
        selected: typeof stored.selected === 'string' ? stored.selected : '',
        updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
        userInfo: normalizeUserInfo(stored.userInfo),
        userInfoAt: normalizeTimestamp(stored.userInfoAt),
        importInfo: recovered,
        autoRefreshHours: normalizeRefreshHours(stored.autoRefreshHours),
        lastRefreshAt: normalizeTimestamp(stored.lastRefreshAt),
        lastRefreshErrorAt: normalizeTimestamp(stored.lastRefreshErrorAt),
        lastRefreshError: typeof stored.lastRefreshError === 'string' ? stored.lastRefreshError.slice(0, 300) : null,
      };
    } catch (err) { if (err.code !== 'ENOENT') throw new Error('Saved configuration cannot be read safely.'); }
    try {
      const stat = await fs.stat(this.file('kernel.json'));
      if (stat.size > 8192) throw new Error('Invalid kernel record.');
      const record = JSON.parse(await fs.readFile(this.file('kernel.json'),'utf8'));
      if (record.version === CORE_VERSION && /^[a-f0-9]{64}$/.test(record.exeSha256)) this.kernel = record;
    } catch (err) { if (err.code !== 'ENOENT') this.error = 'Kernel record is invalid; reinstall the official core.'; }
    return this;
  }

  async autostart() {
    if (!this.state.autoStart) return;
    // A cold Host start can lose the race with the 61 MB core's first page-in — antivirus and a
    // cold disk routinely push the controller past the readiness window while the config itself is
    // fine. Retrying once with freshly picked ports turns that transient failure into a working
    // proxy instead of a panel that only comes back when the user clicks Start by hand.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await this.run({action:'start'}); } catch { /* run() records the phase and the reason */ }
      if (this.phase === 'running') return;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (this.phase !== 'running') this.phase = 'error';
  }

  startAutoRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => { this.autoRefreshTick().catch(() => {}); }, REFRESH_TICK_MS);
    this.refreshTimer.unref?.();
  }

  /**
   * One background refresh attempt. Failures are recorded for the UI instead of thrown: an
   * unattended timer that rejects would either be swallowed silently or surface as a crash.
   */
  async autoRefreshTick(now = Date.now()) {
    if (this.disposed || this.refreshing || !this.refreshDue(now)) return false;
    this.refreshing = true;
    try {
      await this.run({action:'refresh'});
      return true;
    } catch (error) {
      this.error = null;
      // The failure still counts as an attempt, so the next try waits a whole interval.
      await this.save({ ...this.state, lastRefreshError: String(error.message).slice(0,300), lastRefreshErrorAt: new Date().toISOString() }).catch(() => {});
      return false;
    } finally { this.refreshing = false; }
  }

  /**
   * Derived quota view. A `total` or `expire` of 0 means the provider did not state it, which is
   * not the same as a quota of zero, so both surface as null rather than a misleading number.
   */
  usageView(now = Date.now()) {
    const info = this.state.userInfo;
    if (!info) return null;
    const used = info.upload + info.download;
    const total = info.total > 0 ? info.total : null;
    const expire = info.expire > 0 ? info.expire : null;
    return {
      upload: info.upload, download: info.download, used, total,
      remaining: total === null ? null : Math.max(0, total - used),
      percentUsed: total === null ? null : Math.min(100, Math.round((used / total) * 1000) / 10),
      expire,
      expiresAt: expire === null ? null : new Date(expire * 1000).toISOString(),
      daysLeft: expire === null ? null : Math.ceil((expire * 1000 - now) / 86400000),
      expired: expire !== null && expire * 1000 <= now,
      readAt: this.state.userInfoAt,
    };
  }

  /** The most recent refresh attempt, successful or not, as a timestamp; null when never attempted. */
  lastRefreshBasis() {
    const stamps = [this.state.lastRefreshAt, this.state.lastRefreshErrorAt]
      .map(value => (value ? Date.parse(value) : NaN))
      .filter(value => !Number.isNaN(value));
    return stamps.length ? Math.max(...stamps) : null;
  }

  /** When the next automatic refresh falls due; null when automatic refresh is off or unconfigured. */
  nextRefreshAt(now = Date.now()) {
    const hours = this.state.autoRefreshHours;
    if (!hours || !this.state.subscriptionUrl) return null;
    return new Date(Math.max(now, (this.lastRefreshBasis() ?? now) + hours * 3600000)).toISOString();
  }

  /**
   * Whether a refresh is due. A failed attempt counts as an attempt, so a subscription that stays
   * broken is retried once per interval instead of on every tick.
   */
  refreshDue(now = Date.now()) {
    const hours = this.state.autoRefreshHours;
    if (!hours || !this.state.subscriptionUrl) return false;
    const basis = this.lastRefreshBasis();
    return basis === null || now - basis >= hours * 3600000;
  }

  status() {
    return {
      phase: this.phase,
      running: this.child !== null && this.child.exitCode === null && !this.child.killed,
      proxyActive: this.dispatcher !== null && getGlobalDispatcher() === this.dispatcher,
      coreInstalled: this.kernel !== null, coreVersion: this.kernel?.version ?? null,
      inherited: this.report ? {
        subscription: this.report.inherited,
        groups: this.report.groups,
        rules: this.report.rules,
        stripped: this.report.stripped,
        droppedGroups: this.report.droppedGroups,
        droppedProviders: this.report.droppedProviders,
      } : null,
      timeZone: this.state.timeZone,
      timeZoneScope: 'Model date/time interpretation in all Host sessions; not browser/system clocks or saved reminders.',
      autoStart: this.state.autoStart,
      proxyEnv: this.state.proxyEnv,
      proxyEnvActive: this.envSaved !== null,
      mixedPort: this.session?.mixedPort ?? (this.state.mixedPort || null),
      subscriptionConfigured: !!this.state.subscriptionUrl,
      usage: this.usageView(),
      importInfo: this.state.importInfo,
      autoRefreshHours: this.state.autoRefreshHours,
      /** Whether the subscription download is allowed to accept a broken certificate. */
      insecureSubscriptionTls: this.state.insecureSubscriptionTls,
      lastRefreshAt: this.state.lastRefreshAt,
      nextRefreshAt: this.nextRefreshAt(),
      lastRefreshError: this.state.lastRefreshError,
      nodeCount: this.state.nodes.length, nodes: this.state.nodes.map(n => ({name:n.name,type:n.type})),
      selected: this.state.selected || this.state.nodes[0]?.name || '',
      updatedAt: this.state.updatedAt, error: this.error,
      /** How many imported nodes ask for TLS verification to be skipped. */
      tlsVerificationDisabled: this.state.insecureTls,
      /** Whether proxy-server hostnames are resolved by the subscription's own resolvers. */
      proxyServerDns: this.state.dns ? 'subscription' : 'system',
      dnsSecurityNote: this.state.dns ? 'Node hostnames are resolved by the subscription provider DNS; this is required by this subscription.' : null,
      scope: 'DSH main-process global fetch only; all sessions in this Host.',
      exclusions: ['system proxy','TUN','browser traffic','subprocesses and workers','telemetry','DSH pinned web_fetch transport','SDKs with their own dispatcher'],
    };
  }

  async save(next = this.state) {
    await atomicWrite(this.file('state.json'), JSON.stringify(next,null,2));
    this.state = next;
  }

  run(args, signal) {
    if (!args || typeof args !== 'object' || typeof args.action !== 'string') return Promise.reject(new Error('Action is required.'));
    if (args.action === 'status') return Promise.resolve(this.status());
    const execute = async () => {
      if (this.disposed) throw new Error('Plugin has been unloaded.');
      signal?.throwIfAborted();
      this.error = null;
      try {
        const result = await this.perform(args,signal);
        return result ?? this.status();
      } catch (error) {
        // Raw network/process errors can contain URLs, credentials, config fragments, or ANSI output.
        const message = /^(Subscription |Configuration |Provide |Invalid |Node |Every |Unsupported |File paths|Unknown Shadowsocks|TLS |YAML |Managed |Saved |Kernel |Core |Install |Select |No |Cannot |Plugin |Action |Response |Official |Download |Unexpected |Proxy |Connectivity |Use a subscription|Stop |Start |Auto-start|The selected node|The node answered)/.test(error.message) ? error.message : 'Operation failed. Check connectivity or the imported configuration.';
        this.error = message;
        if (['install','import','refresh'].includes(args.action)) this.phase = this.child ? 'running' : 'stopped';
        throw new Error(message);
      }
    };
    const result = this.queue.then(execute);
    this.queue = result.catch(() => {});
    return result;
  }

  async perform(args,signal) {
    switch (args.action) {
      case 'install': return this.install(signal);
      case 'import': return this.importConfig(args,signal);
      case 'refresh': {
        if (!this.state.subscriptionUrl) throw new Error('No subscription URL is saved.');
        return this.importConfig({url:this.state.subscriptionUrl},signal);
      }
      case 'usage': return this.usage(signal);
      case 'traffic': return this.traffic(signal);
      case 'start': return this.start(signal);
      case 'stop': await this.stop(); break;
      case 'select': await this.select(args.node,signal); break;
      case 'configure': {
        if (args.autoStart === undefined && args.timeZone === undefined && args.autoRefreshHours === undefined && args.insecureSubscriptionTls === undefined && args.proxyEnv === undefined) throw new Error('Configuration requires autoStart, timeZone, autoRefreshHours, insecureSubscriptionTls, or proxyEnv.');
        const next = {...this.state};
        if (args.autoStart !== undefined) {
          if (typeof args.autoStart !== 'boolean') throw new Error('Auto-start must be true or false.');
          next.autoStart = args.autoStart;
        }
        if (args.timeZone !== undefined) next.timeZone = normalizeTimeZone(args.timeZone);
        if (args.autoRefreshHours !== undefined) {
          if (!Number.isInteger(args.autoRefreshHours) || args.autoRefreshHours < 0 || args.autoRefreshHours > 720) throw new Error('Invalid auto-refresh interval; use 0 to disable it or 1–720 hours.');
          next.autoRefreshHours = args.autoRefreshHours;
        }
        if (args.insecureSubscriptionTls !== undefined) {
          if (typeof args.insecureSubscriptionTls !== 'boolean') throw new Error('Subscription certificate verification must be on or off.');
          next.insecureSubscriptionTls = args.insecureSubscriptionTls;
        }
        if (args.proxyEnv !== undefined) {
          if (typeof args.proxyEnv !== 'boolean') throw new Error('Proxy environment export must be on or off.');
          next.proxyEnv = args.proxyEnv;
        }
        await this.save(next);
        // The switch must take effect on the running session, not only after a restart.
        if (next.proxyEnv) { this.applyProxyEnv(); await this.publishUpstream(); } else { this.clearProxyEnv(); await this.retractUpstream(); }
        break;
      }
      case 'test': return this.test(signal);
      case 'latency': return this.latency(signal);
      default: throw new Error('Unknown action.');
    }
  }

  /**
   * Measure every imported node's own round trip through the core's delay endpoint.
   * Bounded by a worker pool and an overall deadline so the caller always gets an answer.
   */
  async latency(signal) {
    if (!this.child) throw new Error('Start the proxy before measuring latency.');
    const names = this.state.nodes.map(n => n.name);
    const results = new Array(names.length);
    const query = new URLSearchParams({ url: PROBE_URLS[0], timeout: '4000' }).toString();
    const deadline = Date.now() + 18000;
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (Date.now() > deadline) return;
        const index = cursor++;
        if (index >= names.length) return;
        const name = names[index];
        try {
          const body = await this.api(`/proxies/${encodeURIComponent(name)}/delay?${query}`, {}, signal, 15000);
          results[index] = { name, delayMs: typeof body.delay === 'number' ? body.delay : null };
        } catch (error) {
          results[index] = { name, delayMs: null, error: error.message };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, names.length) }, worker));
    return {
      results: names.map((name, index) => results[index] ?? { name, delayMs: null, error: 'not tested within the time limit' }),
      testedAt: new Date().toISOString(),
      state: this.status(),
    };
  }

  async download(url, { limit, signal, official = false, subscription = false } = {}) {
    let current = url;
    const deadline = AbortSignal.timeout(120000);
    const combined = signal ? AbortSignal.any([signal,deadline]) : deadline;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const target = new URL(current);
      if (official && (target.protocol !== 'https:' || !RELEASE_HOSTS.has(target.hostname) || target.username || target.password)) throw new Error('Official download redirected to an untrusted host.');
      if (subscription) validateSubscriptionUrl(current);
      // Verification is skipped for one target only: a subscription download the
      // operator explicitly allowed, never the core (whose digest is the check
      // that matters) and never process-wide.
      const insecure = subscription && !official && this.state.insecureSubscriptionTls === true;
      let response;
      try {
        response = await this.fetch(current, {dispatcher:insecure?this.relaxedDispatcher():this.baseline, signal:combined,redirect:'manual',headers:{'User-Agent':'DSH-Mihomo/1.0 (Clash Meta)','Accept':official?'application/vnd.github+json':'application/yaml,text/yaml,text/plain,*/*'}});
      } catch (error) {
        const code = error.cause?.code ?? error.code;
        // An expired or untrusted provider certificate is a different problem from a plain network
        // failure, and the operator's fix differs entirely, so the reason must not be flattened.
        if (insecure) throw new Error('Download failed. Check bootstrap network connectivity.');
        if (code === 'CERT_HAS_EXPIRED') throw new Error('Download TLS validation failed: the subscription server certificate has expired. Ask the provider to renew it, or turn on "do not verify the subscription certificate" and read the warning first.');
        if (['UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_UNTRUSTED','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) throw new Error('Download TLS validation failed. Configure a trusted Node CA (NODE_EXTRA_CA_CERTS) and restart DSH, or turn on "do not verify the subscription certificate" and read the warning first.');
        throw new Error('Download failed. Check bootstrap network connectivity.');
      }
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirects === 5) throw new Error('Download redirect limit exceeded.');
        try { current = new URL(location,current).href; } catch { throw new Error('Download redirect is invalid.'); }
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Download returned HTTP ${response.status}.`); }
      try { const bytes = await readBounded(response,limit); return { bytes, headers: response.headers }; }
      catch (err) { if (err.message.startsWith('Response ')) throw err; throw new Error('Download body could not be read.'); }
    }
    throw new Error('Download redirect limit exceeded.');
  }

  async install(signal) {
    if (this.child || this.dispatcher) throw new Error('Stop the proxy before installing the core.');
    if (process.platform !== 'win32' || !['x64','arm64'].includes(process.arch)) throw new Error('Core auto-install currently supports Windows x64 and ARM64 only.');
    this.phase = 'installing';
    const metadata = (await this.download(`https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/${CORE_VERSION}`,{limit:1024*1024,signal,official:true})).bytes;
    let release; try { release = JSON.parse(metadata); } catch { throw new Error('Official release metadata is invalid.'); }
    if (release.tag_name !== CORE_VERSION || release.draft || release.prerelease) throw new Error('Official stable release metadata did not match the pinned version.');
    const arch = process.arch === 'x64' ? 'amd64-v1' : 'arm64';
    const assetName = `mihomo-windows-${arch}-${CORE_VERSION}.zip`;
    const asset = release.assets?.find(a => a.name === assetName);
    if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !Number.isInteger(asset.size) || asset.size > MAX_ARCHIVE) throw new Error('Official asset or SHA256 digest is missing.');
    const expectedUrl = `https://github.com/MetaCubeX/mihomo/releases/download/${CORE_VERSION}/${assetName}`;
    if (asset.browser_download_url !== expectedUrl) throw new Error('Official asset URL did not match the release.');
    const archive = (await this.download(expectedUrl,{limit:MAX_ARCHIVE,signal,official:true})).bytes;
    if (archive.length !== asset.size || sha256(archive) !== asset.digest.slice(7)) throw new Error('Official archive SHA256 verification failed.');
    let expanded = 0;
    let files;
    try {
      files = unzipSync(archive,{filter(entry) {
        if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize > MAX_EXE || (expanded += entry.originalSize) > MAX_EXE) throw new Error('Archive expansion limit.');
        if (!/^mihomo-windows-[a-z0-9-]+\.exe$/.test(entry.name)) throw new Error('Unexpected archive file.');
        return true;
      }});
    } catch { throw new Error('Official archive contains unexpected paths or exceeds the expansion limit.'); }
    const entries = Object.entries(files);
    if (entries.length !== 1) throw new Error('Official archive must contain exactly one executable.');
    const bytes = Buffer.from(entries[0][1]);
    if (bytes.length < 1024 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error('Official executable is not a Windows PE binary.');
    const staging = this.file(`core-${token()}.exe`);
    try {
      await fs.writeFile(staging,bytes,{flag:'wx',mode:0o700});
      const result = await this.execCore(staging,['-v'],signal,true);
      if (!result.includes(CORE_VERSION)) throw new Error('Core executable version did not match the pinned release.');
      await safeFile(this.file('mihomo.exe'));
      await fs.rename(staging,this.file('mihomo.exe'));
      const record = {version:CORE_VERSION,asset:assetName,archiveSha256:asset.digest.slice(7),exeSha256:sha256(bytes),installedAt:new Date().toISOString()};
      await atomicWrite(this.file('kernel.json'),JSON.stringify(record,null,2));
      this.kernel = record;
    } finally { await fs.rm(staging,{force:true}); }
    this.phase = 'stopped';
    return this.status();
  }

  async execCore(exe,args,signal,collect = false) {
    signal?.throwIfAborted();
    const child = this.spawn(exe,args,{cwd:this.dataDir,env:coreEnvironment(this.dataDir),shell:false,windowsHide:true,stdio:collect?['ignore','pipe','ignore']:'ignore'});
    let output = '';
    if (collect) child.stdout.on('data',chunk => { if (output.length < 4096) output += chunk.toString('utf8').slice(0,4096-output.length); });
    const kill = () => child.kill();
    const timer = setTimeout(kill,15000);
    signal?.addEventListener('abort',kill,{once:true});
    try {
      const [code] = await once(child,'exit');
      signal?.throwIfAborted();
      if (code !== 0) throw new Error('Core executable validation failed.');
      return output;
    } catch { throw new Error('Core executable validation failed.'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort',kill); }
  }

  /**
   * Replace the node set from a subscription URL or pasted YAML.
   *
   * A saved subscription may refresh while the proxy runs: the candidate config is validated with
   * the core's own `-t` first and swapped in only after it passes, then applied through the core's
   * reload endpoint. A subscription that turns out to be broken therefore leaves the running proxy
   * on its previous nodes. Pasted YAML still requires a stop, because there is no saved source to
   * fall back to.
   */
  async importConfig(args,signal) {
    const hasUrl = typeof args.url === 'string' && args.url.trim();
    const hasYaml = typeof args.yaml === 'string' && args.yaml.trim();
    if (!!hasUrl === !!hasYaml) throw new Error('Provide either a subscription URL or YAML, not both.');
    const active = this.child !== null || this.dispatcher !== null;
    if (hasYaml && active) throw new Error('Stop the proxy before importing pasted YAML; only a saved subscription can refresh while it runs.');
    this.phase = 'importing';
    const url = hasUrl ? validateSubscriptionUrl(args.url) : '';
    let text = args.yaml;
    let meta = null;
    if (url) {
      const { bytes, headers } = await this.download(url,{limit:MAX_CONFIG_BYTES,signal,subscription:true});
      text = bytes.toString('utf8');
      meta = parseSubscriptionMeta(text, headers);
    }
    const parsed = parseSubscription(text);
    const previousSelection = this.state.selected;
    const updatedAt = new Date().toISOString();
    const importInfo = parseImportInfo(parsed.nodes);
    const next = {
      ...this.state,
      nodes: parsed.nodes,
      raw: parsed.raw,
      dns: parsed.dns,
      insecureTls: parsed.insecureTls,
      subscriptionUrl: url,
      selected: parsed.nodes.some(n => n.name === previousSelection) ? previousSelection : parsed.nodes[0].name,
      updatedAt,
      importInfo: importInfo ? { ...importInfo, at: updatedAt } : null,
    };
    if (url) {
      next.lastRefreshAt = updatedAt;
      next.lastRefreshError = null;
      next.lastRefreshErrorAt = null;
      if (meta?.userInfo) { next.userInfo = meta.userInfo; next.userInfoAt = updatedAt; }
    }
    if (active) await this.reloadRunning(next,signal);
    else { await this.save(next); this.phase = 'stopped'; }
    return this.status();
  }

  /**
   * Move the running core onto a new node set without dropping the proxy. The previous file is kept
   * in memory and put back if the core refuses the reload, so a failed refresh is never fatal.
   */
  async reloadRunning(next,signal) {
    const target = this.file('managed.yaml');
    const staging = this.file(`staging-${token()}.yaml`);
    const config = encodeConfig(this.managedConfig(next));
    let previous = null;
    try {
      await atomicWrite(staging,config);
      await this.execCore(this.file('mihomo.exe'),['-t','-d',this.dataDir,'-f',staging],signal);
      previous = await fs.readFile(target).catch(() => null);
      await fs.rename(staging,target);
      await this.api('/configs?force=true',{method:'PUT',body:JSON.stringify({path:target})},signal,20000);
      const { proxies } = await this.api('/proxies',{},signal);
      if (!Array.isArray(proxies?.[GROUP]?.all) || proxies[GROUP].all.length !== next.nodes.length) throw new Error('node group mismatch');
      await this.api(`/proxies/${encodeURIComponent(GROUP)}`,{method:'PUT',body:JSON.stringify({name:next.selected})},signal);
    } catch {
      await fs.rm(staging,{force:true}).catch(() => {});
      if (previous) {
        // Restore the file the core is still serving, then re-apply it in case it already reloaded.
        await atomicWrite(target,previous).catch(() => {});
        await this.api('/configs?force=true',{method:'PUT',body:JSON.stringify({path:target})},undefined,20000).catch(() => {});
      }
      if (!this.child) throw new Error('Core exited while reloading the subscription; start the proxy again.');
      throw new Error('Core rejected the refreshed subscription; the running proxy keeps its previous nodes.');
    }
    await this.save(next);
    this.session.selected = next.selected;
    this.phase = 'running';
  }

  /**
   * Read the provider's quota without touching the imported nodes. Subscriptions report usage in a
   * `subscription-userinfo` header or body comment; a provider that omits it can never show a
   * remaining balance, which is a fact about the provider rather than a failure of this plugin.
   */
  async usage(signal) {
    if (!this.state.subscriptionUrl) throw new Error('No subscription URL is saved.');
    const { bytes, headers } = await this.download(this.state.subscriptionUrl,{limit:MAX_CONFIG_BYTES,signal,subscription:true});
    const meta = parseSubscriptionMeta(bytes.toString('utf8'),headers);
    if (!meta.userInfo) throw new Error('Subscription usage is not reported by this provider (no subscription-userinfo).');
    await this.save({ ...this.state, userInfo: meta.userInfo, userInfoAt: new Date().toISOString() });
    return this.status();
  }

  async start(signal) {
    if (this.child && this.dispatcher) return this.status();
    if (this.dispatcher && !this.child) await this.stop();
    if (!this.kernel) throw new Error('Install the official core first.');
    if (!this.state.nodes.length) throw new Error('No nodes are imported.');
    await safeDirectory(this.dataDir);
    await safeFile(this.file('mihomo.exe'));
    const stat = await fs.stat(this.file('mihomo.exe'));
    if (stat.size > MAX_EXE || sha256(await fs.readFile(this.file('mihomo.exe'))) !== this.kernel.exeSha256) throw new Error('Kernel executable integrity check failed; reinstall it.');
    this.phase = 'starting';
    const [mixedPort,apiPort] = await this.ports(this.state.mixedPort || undefined);
    this.session = {mixedPort,apiPort,apiSecret:token(),proxyPassword:token(),selected:this.state.selected};
    await atomicWrite(this.file('managed.yaml'),encodeConfig(this.managedConfig(this.state)));
    try {
      await this.execCore(this.file('mihomo.exe'),['-t','-d',this.dataDir,'-f',this.file('managed.yaml')],signal);
      signal?.throwIfAborted();
      await this.openLog();
      const child = this.spawn(this.file('mihomo.exe'),['-d',this.dataDir,'-f',this.file('managed.yaml')],{cwd:this.dataDir,env:coreEnvironment(this.dataDir),shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
      this.child = child;
      if (this.logStream) {
        child.stdout?.pipe(this.logStream,{end:false});
        child.stderr?.pipe(this.logStream,{end:false});
      }
      const exited = () => {
        if (this.child !== child) return;
        this.child = null; this.phase = 'error';
        this.logTail().then(detail => {
          this.error = `Core exited unexpectedly${detail ? ` — ${detail}` : ''}. Public fetch stays blocked until Stop (log: core.log).`;
        }, () => { this.error = 'Core exited unexpectedly. Public fetch stays blocked until Stop (log: core.log).'; });
      };
      child.once('exit',exited); child.once('error',exited);
      const deadline = Date.now()+15000;
      let ready = false;
      while (Date.now()<deadline) {
        signal?.throwIfAborted();
        if (this.child !== child) throw new Error(`Core exited during startup${await this.logTail().then(d => d ? ` — ${d}` : '', () => '')}.`);
        try { const version = await this.api('/version',{},signal,750); if (version.version?.includes(CORE_VERSION)) { ready = true; break; } } catch {}
        await wait(120,undefined,{signal});
      }
      if (!ready) throw new Error(`Core controller did not become ready. Check ports or configuration.${await this.logTail().then(d => d ? ` — ${d}` : '', () => '')}`);
      const proxies = await this.api('/proxies',{},signal);
      if (!Array.isArray(proxies.proxies?.[GROUP]?.all) || proxies.proxies[GROUP].all.length !== this.state.nodes.length) throw new Error('Core node group is invalid.');
      // Capture the currently active dispatcher, not a stale value from plugin mount.
      this.previousDispatcher = getGlobalDispatcher();
      this.dispatcher = createProcessDispatcher(this.session);
      setGlobalDispatcher(this.dispatcher);
      this.phase = 'running'; this.error = null;
      // Remember the port so the address handed to other clients stays valid.
      if (this.state.mixedPort !== mixedPort) await this.save({...this.state,mixedPort});
      this.applyProxyEnv();
      await this.publishUpstream();
      try {
        // Never leave the Host on a proxy that cannot carry its own traffic.
        await (this.probeImpl ?? (sig => this.probe(sig)))(signal);
      } catch (error) {
        await this.stop();
        this.phase = 'error';
        throw error;
      }
      return this.status();
    } catch (err) {
      await this.stop();
      if (this.phase !== 'error') this.phase = 'error';
      throw err;
    }
  }

  /** Node-level reachability plus a real round trip through DSH's own global fetch. */
  async probe(signal) {
    let lastNodeError = null;
    for (const url of PROBE_URLS) {
      const query = new URLSearchParams({ url, timeout: '5000' }).toString();
      try {
        await this.api(`/proxies/${encodeURIComponent(GROUP)}/delay?${query}`, {}, signal, 20000);
        lastNodeError = null;
        break;
      } catch (error) { lastNodeError = error.message; }
    }
    if (lastNodeError) {
      const stale = this.state.subscriptionUrl && !this.state.dns;
      throw new Error(`The selected node could not reach any test target (${lastNodeError}).${stale ? ' This subscription was imported without its DNS settings; click Refresh subscription, then start again.' : ' Pick another node, or refresh the subscription.'}`);
    }
    let lastFetchError = null;
    for (const url of PROBE_URLS) {
      const started = Date.now();
      let response;
      try {
        response = await globalThis.fetch(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
      } catch (error) {
        const code = error?.cause?.code || error?.code;
        lastFetchError = `DSH fetch through the local proxy failed${code ? ` (${code})` : ''}`;
        continue;
      }
      await response.body?.cancel();
      if (response.ok) return { url, statusCode: response.status, fetchMs: Date.now() - started };
      lastFetchError = `connectivity check returned HTTP ${response.status}`;
    }
    throw new Error(`The node answered its own check, but ${lastFetchError}. The process proxy was rolled back.`);
  }

  async api(route,init = {},signal,timeout = 10000) {
    if (!this.session) throw new Error('Core is not running.');
    const deadline = AbortSignal.timeout(timeout);
    const combined = signal ? AbortSignal.any([signal,deadline]) : deadline;
    let response;
    try {
      response = await this.fetch(`http://127.0.0.1:${this.session.apiPort}${route}`,{...init,dispatcher:this.direct,signal:combined,redirect:'error',headers:{'Authorization':`Bearer ${this.session.apiSecret}`,'Content-Type':'application/json',...init.headers}});
    } catch { throw new Error('Core controller request failed.'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Core controller returned HTTP ${response.status}.`); }
    if (response.status === 204) return {};
    const bytes = await readBounded(response,1024*1024);
    try { return JSON.parse(bytes); } catch { throw new Error('Core controller response is invalid.'); }
  }

  async select(node,signal) {
    if (typeof node !== 'string' || !this.state.nodes.some(n=>n.name===node)) throw new Error('Select a node from the imported list.');
    const next = {...this.state,selected:node};
    if (this.child) {
      const {proxies} = await this.api('/proxies',{},signal);
      if (!proxies?.[GROUP]?.all?.includes(node)) throw new Error('Select a node from the active group.');
      const previous = proxies[GROUP].now;
      await this.api(`/proxies/${encodeURIComponent(GROUP)}`,{method:'PUT',body:JSON.stringify({name:node})},signal);
      try { await this.save(next); }
      catch (err) { await this.api(`/proxies/${encodeURIComponent(GROUP)}`,{method:'PUT',body:JSON.stringify({name:previous})}).catch(()=>{}); throw err; }
    } else await this.save(next);
  }

  /**
   * Live traffic, read from the core rather than counted here. The totals are cumulative for the
   * running core, so the panel derives the current rate from two reads instead of the plugin
   * keeping a sampler of its own; nothing is logged and no connection metadata leaves the process.
   */
  async traffic(signal) {
    const payload = await this.api('/connections',{},signal);
    const connections = Array.isArray(payload?.connections) ? payload.connections : [];
    const live = connections
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        host: typeof item.metadata?.host === 'string' && item.metadata.host
          ? item.metadata.host
          : (typeof item.metadata?.destinationIP === 'string' ? item.metadata.destinationIP : ''),
        chain: Array.isArray(item.chains) ? item.chains.filter(step => typeof step === 'string').slice(0,3) : [],
        rule: typeof item.rule === 'string' ? item.rule : '',
        download: Number(item.download) || 0,
        upload: Number(item.upload) || 0,
      }))
      .sort((a,b) => (b.download + b.upload) - (a.download + a.upload))
      .slice(0, MAX_LIVE_CONNECTIONS);
    return {
      up: Number(payload?.uploadTotal) || 0,
      down: Number(payload?.downloadTotal) || 0,
      active: connections.length,
      at: new Date().toISOString(),
      connections: live,
    };
  }

  async test(signal) {
    if (!this.child || !this.dispatcher || getGlobalDispatcher() !== this.dispatcher) throw new Error('Proxy is not active. Start it before testing.');
    const started = Date.now();
    const result = await (this.probeImpl ?? (sig => this.probe(sig)))(signal);
    return {ok:true,statusCode:result.statusCode,latencyMs:Date.now()-started,url:result.url,node:this.state.selected,state:this.status()};
  }

  async openLog() {
    await this.closeLog();
    try {
      const stream = createWriteStream(this.file('core.log'), { flags: 'w', mode: 0o600 });
      stream.on('error', () => {});
      this.logStream = stream;
    } catch { this.logStream = null; }
  }

  async closeLog() {
    const stream = this.logStream; this.logStream = null;
    if (stream) await new Promise(resolve => stream.end(resolve)).catch(() => {});
  }

  /** Last error lines from the core log, redacted; the full log stays on disk for the user. */
  async logTail() {
    try {
      const stat = await fs.stat(this.file('core.log'));
      if (!stat.size) return '';
      const length = Math.min(stat.size, 16384);
      const handle = await fs.open(this.file('core.log'), 'r');
      try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, stat.size - length);
        const lines = buffer.toString('utf8').split(/\r?\n/).filter(line => /error|fatal|panic|fail/i.test(line));
        return redactLog(lines.slice(-2).join(' ')).slice(0, 300);
      } finally { await handle.close(); }
    } catch { return ''; }
  }

  async stop() {
    const dispatcher = this.dispatcher;
    if (dispatcher && getGlobalDispatcher() === dispatcher) setGlobalDispatcher(this.previousDispatcher);
    this.dispatcher = null;
    if (dispatcher) await dispatcher.destroy().catch(()=>{});
    const child = this.child; this.child = null;
    if (child && child.exitCode === null) {
      const settled = once(child,'exit').catch(()=>{});
      child.kill();
      await Promise.race([settled,wait(3000)]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([settled,wait(2000)]); }
    }
    await this.closeLog();
    this.session = null;
    this.clearProxyEnv();
    this.phase = 'stopped'; this.error = null;
  }

  async dispose() {
    this.disposed = true;
    this.clearProxyEnv();
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    await this.queue;
    await this.stop();
    if (this.relaxed) { await this.relaxed.destroy(); this.relaxed = null; }
    await this.direct.destroy();
  }
}
