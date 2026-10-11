import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { Agent, Pool, ProxyAgent, fetch as httpFetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { unzipSync } from 'fflate';
import { GROUP, CORE_VERSION, MAX_CONFIG_BYTES, isLocalHost, parseSubscription, parseNodes, sanitizeDns, validateSubscriptionUrl, controlledConfig, encodeConfig, coreEnvironment, redactLog } from './policy.js';

const MAX_ARCHIVE = 48 * 1024 * 1024;
const MAX_EXE = 100 * 1024 * 1024;
/** Neutral reachability targets; a provider may block one, so any success counts. */
const PROBE_URLS = ['http://www.gstatic.com/generate_204', 'http://cp.cloudflare.com/generate_204', 'http://www.msftconnecttest.com/connecttest.txt'];
const RELEASE_HOSTS = new Set(['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const token = () => randomBytes(24).toString('hex');

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

export async function reservePorts() {
  const servers = [];
  try {
    for (let i = 0; i < 2; i++) {
      const server = createServer(); servers.push(server);
      await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
    }
    return servers.map(s => s.address().port);
  } finally { await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve)))); }
}

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
    this.ports = options.reservePorts ?? reservePorts;
    this.probeImpl = options.probe;
    this.state = { autoStart: false, subscriptionUrl: '', nodes: [], dns: null, insecureTls: 0, selected: '', updatedAt: null };
    this.kernel = null;
    this.phase = 'stopped'; this.error = null;
    this.child = null; this.session = null; this.dispatcher = null; this.logStream = null;
    this.queue = Promise.resolve(); this.disposed = false;
  }
  file(name) { return path.join(this.dataDir,name); }

  async init() {
    await safeDirectory(this.dataDir);
    for (const name of ['state.json','kernel.json','mihomo.exe','managed.yaml']) await safeFile(this.file(name));
    try {
      const stat = await fs.stat(this.file('state.json'));
      if (stat.size > MAX_CONFIG_BYTES * 2) throw new Error('Saved state exceeds the limit.');
      const stored = JSON.parse(await fs.readFile(this.file('state.json'),'utf8'));
      const nodes = stored.nodes?.length ? parseNodes(encodeConfig({proxies:stored.nodes})) : [];
      this.state = {
        autoStart: stored.autoStart === true,
        subscriptionUrl: stored.subscriptionUrl ? validateSubscriptionUrl(stored.subscriptionUrl) : '',
        nodes,
        dns: sanitizeDns(stored.dns),
        insecureTls: nodes.filter(n => n['skip-cert-verify'] === true).length,
        selected: typeof stored.selected === 'string' ? stored.selected : '',
        updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
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
    await this.run({action:'start'}).catch(() => { if (this.phase !== 'running') this.phase = 'error'; });
  }

  status() {
    return {
      phase: this.phase,
      running: this.child !== null && this.child.exitCode === null && !this.child.killed,
      proxyActive: this.dispatcher !== null && getGlobalDispatcher() === this.dispatcher,
      coreInstalled: this.kernel !== null, coreVersion: this.kernel?.version ?? null,
      autoStart: this.state.autoStart,
      subscriptionConfigured: !!this.state.subscriptionUrl,
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
        if (['install','import','refresh'].includes(args.action) && !this.child) this.phase = 'stopped';
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
      case 'start': return this.start(signal);
      case 'stop': await this.stop(); break;
      case 'select': await this.select(args.node,signal); break;
      case 'configure': {
        if (typeof args.autoStart !== 'boolean') throw new Error('Auto-start must be true or false.');
        await this.save({...this.state,autoStart:args.autoStart}); break;
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
      let response;
      try {
        response = await this.fetch(current, {dispatcher:this.baseline, signal:combined,redirect:'manual',headers:{'User-Agent':'DSH-Mihomo/1.0 (Clash Meta)','Accept':official?'application/vnd.github+json':'application/yaml,text/yaml,text/plain,*/*'}});
      } catch (error) {
        if (['UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(error.cause?.code)) throw new Error('Download TLS validation failed. Configure a trusted Node CA (NODE_EXTRA_CA_CERTS) and restart DSH; certificate verification will not be disabled.');
        throw new Error('Download failed. Check bootstrap network connectivity.');
      }
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirects === 5) throw new Error('Download redirect limit exceeded.');
        try { current = new URL(location,current).href; } catch { throw new Error('Download redirect is invalid.'); }
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Download returned HTTP ${response.status}.`); }
      try { return await readBounded(response,limit); } catch (err) { if (err.message.startsWith('Response ')) throw err; throw new Error('Download body could not be read.'); }
    }
    throw new Error('Download redirect limit exceeded.');
  }

  async install(signal) {
    if (this.child || this.dispatcher) throw new Error('Stop the proxy before installing the core.');
    if (process.platform !== 'win32' || !['x64','arm64'].includes(process.arch)) throw new Error('Core auto-install currently supports Windows x64 and ARM64 only.');
    this.phase = 'installing';
    const metadata = await this.download(`https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/${CORE_VERSION}`,{limit:1024*1024,signal,official:true});
    let release; try { release = JSON.parse(metadata); } catch { throw new Error('Official release metadata is invalid.'); }
    if (release.tag_name !== CORE_VERSION || release.draft || release.prerelease) throw new Error('Official stable release metadata did not match the pinned version.');
    const arch = process.arch === 'x64' ? 'amd64-v1' : 'arm64';
    const assetName = `mihomo-windows-${arch}-${CORE_VERSION}.zip`;
    const asset = release.assets?.find(a => a.name === assetName);
    if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !Number.isInteger(asset.size) || asset.size > MAX_ARCHIVE) throw new Error('Official asset or SHA256 digest is missing.');
    const expectedUrl = `https://github.com/MetaCubeX/mihomo/releases/download/${CORE_VERSION}/${assetName}`;
    if (asset.browser_download_url !== expectedUrl) throw new Error('Official asset URL did not match the release.');
    const archive = await this.download(expectedUrl,{limit:MAX_ARCHIVE,signal,official:true});
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

  async importConfig(args,signal) {
    if (this.child || this.dispatcher) throw new Error('Stop the proxy before importing or refreshing nodes.');
    const hasUrl = typeof args.url === 'string' && args.url.trim();
    const hasYaml = typeof args.yaml === 'string' && args.yaml.trim();
    if (!!hasUrl === !!hasYaml) throw new Error('Provide either a subscription URL or YAML, not both.');
    this.phase = 'importing';
    const url = hasUrl ? validateSubscriptionUrl(args.url) : '';
    const text = url ? (await this.download(url,{limit:MAX_CONFIG_BYTES,signal,subscription:true})).toString('utf8') : args.yaml;
    const parsed = parseSubscription(text);
    const previousSelection = this.state.selected;
    await this.save({
      ...this.state,
      nodes: parsed.nodes,
      dns: parsed.dns,
      insecureTls: parsed.insecureTls,
      subscriptionUrl: url,
      selected: parsed.nodes.some(n => n.name === previousSelection) ? previousSelection : parsed.nodes[0].name,
      updatedAt: new Date().toISOString(),
    });
    this.phase = 'stopped';
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
    const [mixedPort,apiPort] = await this.ports();
    this.session = {mixedPort,apiPort,apiSecret:token(),proxyPassword:token(),selected:this.state.selected};
    await atomicWrite(this.file('managed.yaml'),encodeConfig(controlledConfig(this.state.nodes,{...this.session,dns:this.state.dns})));
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
      if (!ready) throw new Error('Core controller did not become ready. Check ports or configuration.');
      const proxies = await this.api('/proxies',{},signal);
      if (!Array.isArray(proxies.proxies?.[GROUP]?.all) || proxies.proxies[GROUP].all.length !== this.state.nodes.length) throw new Error('Core node group is invalid.');
      // Capture the currently active dispatcher, not a stale value from plugin mount.
      this.previousDispatcher = getGlobalDispatcher();
      this.dispatcher = createProcessDispatcher(this.session);
      setGlobalDispatcher(this.dispatcher);
      this.phase = 'running'; this.error = null;
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
    this.phase = 'stopped'; this.error = null;
  }

  async dispose() {
    this.disposed = true;
    await this.queue;
    await this.stop();
    await this.direct.destroy();
  }
}
