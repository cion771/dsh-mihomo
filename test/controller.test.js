import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { MihomoController, createProcessDispatcher } from '../controller.js';
import { CORE_VERSION } from '../policy.js';
import { zipSync } from 'fflate';

async function listen(server) { await new Promise(r=>server.listen(0,'127.0.0.1',r)); return server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(r=>server.close(r)); }

test('real global fetch uses authenticated CONNECT for public hosts and bypasses loopback', async()=>{
  const origin=createServer((req,res)=>res.end(req.headers.host));
  const originPort=await listen(origin); let tunnels=0;
  const proxy=createServer(); const sockets=new Set();
  proxy.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  proxy.on('connect',(req,socket,head)=>{
    tunnels++;
    assert.equal(req.headers['proxy-authorization'],'Basic '+Buffer.from('dsh:secret').toString('base64'));
    assert.equal(req.url,'example.com:80');
    const upstream=connect(originPort,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
    socket.on('close',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
  });
  const proxyPort=await listen(proxy); const old=getGlobalDispatcher();
  const dispatcher=createProcessDispatcher({mixedPort:proxyPort,proxyPassword:'secret'});
  try {
    setGlobalDispatcher(dispatcher);
    assert.equal(await (await globalThis.fetch('http://example.com/resource',{signal:AbortSignal.timeout(5000)})).text(),'example.com');
    assert.equal(await (await globalThis.fetch(`http://127.0.0.1:${originPort}/local`,{signal:AbortSignal.timeout(5000)})).text(),`127.0.0.1:${originPort}`);
    assert.equal(tunnels,1);
  } finally {setGlobalDispatcher(old);await dispatcher.destroy();for(const s of sockets)s.destroy();await close(proxy);await close(origin);}
});

test('controller lifecycle validates core, switches nodes, fails closed and restores dispatcher',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-test-'));
  const bytes=Buffer.from('mock executable');
  await fs.writeFile(path.join(dir,'mihomo.exe'),bytes);
  await fs.writeFile(path.join(dir,'kernel.json'),JSON.stringify({version:CORE_VERSION,exeSha256:createHash('sha256').update(bytes).digest('hex')}));
  const old=getGlobalDispatcher();const calls=[];let ownedChild;let selected='first';
  const fakeSpawn=(exe,args,options)=>{
    calls.push({exe,args,options});const child=new EventEmitter();child.exitCode=null;child.killed=false;child.signalCode=null;child.stdout=new PassThrough();
    child.kill=()=>{child.killed=true;child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));return true;};
    if(args.includes('-t'))queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0);});else ownedChild=child;
    return child;
  };
  const fakeFetch=async(url,init)=>{
    assert.equal(new URL(url).hostname,'127.0.0.1');assert.match(init.headers.Authorization,/^Bearer [a-f0-9]{48}$/);
    if(url.endsWith('/version'))return Response.json({version:CORE_VERSION});
    if(init.method==='PUT'){selected=JSON.parse(init.body).name;return new Response(null,{status:204});}
    return Response.json({proxies:{DSH:{all:['first','second'],now:selected}}});
  };
  const controller=await new MihomoController(dir,{spawn:fakeSpawn,fetch:fakeFetch,reservePorts:async()=>[19801,19802],probe:async()=>({url:'http://probe',statusCode:204,fetchMs:1})}).init();
  try{
    await controller.run({action:'import',yaml:'proxies:\n  - {name: first, type: http, server: 127.0.0.1, port: 12345}\n  - {name: second, type: http, server: 127.0.0.1, port: 12346}'});
    assert.equal((await controller.run({action:'start'})).proxyActive,true);
    assert.notEqual(getGlobalDispatcher(),old);
    await assert.rejects(controller.run({action:'import',yaml:'[]'}),/Stop the proxy/);
    await controller.run({action:'select',node:'second'});assert.equal(selected,'second');
    for(const call of calls){assert.equal(call.options.shell,false);assert.equal(call.options.env.CLASH_POST_UP,undefined);assert.equal(call.options.env.SAFE_PATHS,undefined);assert.equal(call.options.env.SKIP_SAFE_PATH_CHECK,'false');}
    ownedChild.exitCode=1;ownedChild.emit('exit',1);
    assert.equal(controller.status().phase,'error');assert.equal(controller.status().proxyActive,true);assert.equal(controller.status().running,false);
    await controller.run({action:'stop'});assert.equal(getGlobalDispatcher(),old);
    assert.equal(controller.status().selected,'second');
    const reload=await new MihomoController(dir).init();assert.equal(reload.status().selected,'second');await reload.dispose();
  }finally{await controller.dispose();assert.equal(getGlobalDispatcher(),old);await fs.rm(dir,{recursive:true,force:true});}
});

// The provider shape that broke the first release: a private node hostname resolvable only by
// the subscription's own DoH, plus nodes that require skipping certificate verification.
const providerYaml = `
dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver: ['223.5.5.5']
  proxy-server-nameserver: ['https://dns.example.com:843/dns-query/abc']
  proxy-server-nameserver-policy:
    'private.node': ['https://dns.example.com:843/dns-query/abc']
proxies:
  - {name: first, type: anytls, server: private.node, port: 443, skip-cert-verify: true}
  - {name: second, type: http, server: 127.0.0.1, port: 12346}
tun:
  enable: true
listeners:
  - port: 8888
`;

async function seedCore(dir) {
  const bytes = Buffer.from('mock executable');
  await fs.writeFile(path.join(dir,'mihomo.exe'),bytes);
  await fs.writeFile(path.join(dir,'kernel.json'),JSON.stringify({version:CORE_VERSION,exeSha256:createHash('sha256').update(bytes).digest('hex')}));
}

function fakeCore({ onStart } = {}) {
  const calls = [];
  let owned = null;
  const spawn = (exe,args,options) => {
    calls.push({exe,args,options});
    const child = new EventEmitter();
    child.exitCode=null;child.killed=false;child.signalCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{child.killed=true;child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));return true;};
    if(args.includes('-t'))queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0);});
    else { owned=child; onStart?.(); }
    return child;
  };
  return { spawn, calls, owned: () => owned };
}

test('import keeps the provider DNS and node TLS settings in the managed config',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-dns-'));
  await seedCore(dir);
  const {spawn}=fakeCore();
  const fakeFetch=async(url)=>{
    if(url.endsWith('/version'))return Response.json({version:CORE_VERSION});
    return Response.json({proxies:{DSH:{all:['first','second'],now:'first'}}});
  };
  const controller=await new MihomoController(dir,{spawn,fetch:fakeFetch,reservePorts:async()=>[19901,19902],probe:async()=>({url:'http://probe',statusCode:204,fetchMs:1})}).init();
  try{
    await controller.run({action:'import',yaml:providerYaml});
    const status=controller.status();
    assert.equal(status.tlsVerificationDisabled,1);
    assert.equal(status.proxyServerDns,'subscription');
    await controller.run({action:'start'});
    const {parse}=await import('yaml');
    const managed=parse(await fs.readFile(path.join(dir,'managed.yaml'),'utf8'));
    assert.equal(managed.dns.enable,true);
    assert.equal(managed.dns['enhanced-mode'],'normal');
    assert.deepEqual(Object.keys(managed.dns['proxy-server-nameserver-policy']),['private.node']);
    assert.equal(managed.proxies[0]['skip-cert-verify'],true);
    assert.equal(managed.tun.enable,false);
    assert.equal(managed.listeners,undefined);
    assert.equal(managed['allow-lan'],false);
    assert.equal(managed['log-level'],'warning');
  }finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('latency sweeps every node, reports each outcome and bounds the total time',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-latency-'));
  await seedCore(dir);
  const {spawn}=fakeCore();
  const delays={first:120,second:0,third:900,fifth:50};
  let delayCalls=0;const concurrency={peak:0,live:0};
  const fakeFetch=async(url)=>{
    if(url.endsWith('/version'))return Response.json({version:CORE_VERSION});
    if(url.includes('/delay')){
      delayCalls++;
      concurrency.live++;concurrency.peak=Math.max(concurrency.peak,concurrency.live);
      await new Promise(r=>setTimeout(r,5));
      concurrency.live--;
      const name=decodeURIComponent(url.match(/\/proxies\/([^/]+)\/delay/)[1]);
      if(!(name in delays))return new Response(JSON.stringify({message:'An error occurred in the delay test'}),{status:504,headers:{'Content-Type':'application/json'}});
      return Response.json({delay:delays[name]});
    }
    return Response.json({proxies:{DSH:{all:['first','second','third','fourth','fifth'],now:'first'}}});
  };
  const yaml='proxies:\n'+['first','second','third','fourth','fifth'].map((n,i)=>`  - {name: ${n}, type: http, server: 127.0.0.1, port: ${12000+i}}\n`).join('');
  const controller=await new MihomoController(dir,{spawn,fetch:fakeFetch,reservePorts:async()=>[19921,19922],probe:async()=>({url:'http://probe',statusCode:204,fetchMs:1})}).init();
  try{
    await controller.run({action:'import',yaml});
    await assert.rejects(controller.run({action:'latency'}),/Start the proxy/);
    await controller.run({action:'start'});
    const result=await controller.run({action:'latency'});
    assert.equal(result.results.length,5);
    assert.equal(delayCalls,5);
    assert.ok(concurrency.peak>1,'the sweep must run nodes concurrently');
    assert.ok(concurrency.peak<=8,'the sweep must stay bounded');
    const byName=Object.fromEntries(result.results.map(r=>[r.name,r]));
    assert.equal(byName.first.delayMs,120);
    assert.equal(byName.third.delayMs,900);
    assert.equal(byName.fourth.delayMs,null);
    assert.ok(byName.fourth.error,'an unreachable node must carry a reason');
    assert.equal(result.state.proxyActive,true);
  }finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('start rolls the process proxy back when the node cannot carry DSH traffic',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-rollback-'));
  await seedCore(dir);
  const {spawn}=fakeCore();
  const fakeFetch=async(url)=>{
    if(url.endsWith('/version'))return Response.json({version:CORE_VERSION});
    return Response.json({proxies:{DSH:{all:['first'],now:'first'}}});
  };
  const old=getGlobalDispatcher();
  const controller=await new MihomoController(dir,{spawn,fetch:fakeFetch,reservePorts:async()=>[19911,19912],probe:async()=>{throw new Error('The selected node could not reach any test target (Core controller returned HTTP 504.).');}}).init();
  try{
    await controller.run({action:'import',yaml:'proxies:\n  - {name: first, type: http, server: 127.0.0.1, port: 12345}\n'});
    await assert.rejects(controller.run({action:'start'}),/could not reach any test target/);
    assert.equal(controller.status().phase,'error');
    assert.equal(controller.status().proxyActive,false,'a broken proxy must not stay active');
    assert.equal(getGlobalDispatcher(),old,'the previous dispatcher must be restored');
  }finally{await controller.dispose();assert.equal(getGlobalDispatcher(),old);await fs.rm(dir,{recursive:true,force:true});}
});

test('installer verifies digest and archive paths before running a staged executable',async()=>{
  const assetName=`mihomo-windows-amd64-v1-${CORE_VERSION}.zip`;
  const binary=Buffer.alloc(2048);binary[0]=0x4d;binary[1]=0x5a;
  for(const kind of ['valid','digest-mismatch','traversal']){
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-install-'));let spawns=0;
    const archive=zipSync({[kind==='traversal'?'../mihomo.exe':'mihomo-windows-amd64-v1.exe']:binary});
    const digest=kind==='digest-mismatch'?'0'.repeat(64):createHash('sha256').update(archive).digest('hex');
    const fetch=async(url)=>url.includes('api.github.com')?Response.json({tag_name:CORE_VERSION,draft:false,prerelease:false,assets:[{name:assetName,size:archive.length,digest:`sha256:${digest}`,browser_download_url:`https://github.com/MetaCubeX/mihomo/releases/download/${CORE_VERSION}/${assetName}`}]}):new Response(archive);
    const spawn=(exe,args,options)=>{spawns++;assert.equal(options.shell,false);assert.equal(options.env.CLASH_POST_UP,undefined);const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};queueMicrotask(()=>{child.stdout.write(`Mihomo Meta ${CORE_VERSION}`);child.emit('exit',0);});return child;};
    const c=await new MihomoController(dir,{fetch,spawn}).init();
    try{
      if(kind==='valid'){assert.equal((await c.run({action:'install'})).coreInstalled,true);assert.equal(spawns,1);assert.deepEqual(await fs.readFile(path.join(dir,'mihomo.exe')),binary);}
      else{await assert.rejects(c.run({action:'install'}));assert.equal(spawns,0);assert.equal(c.status().coreInstalled,false);}
    }finally{await c.dispose();await fs.rm(dir,{recursive:true,force:true});}
  }
});

test('model time-zone preference validates, persists and can be disabled without a core',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-timezone-'));
  const controller=await new MihomoController(dir).init();
  try {
    const saved=await controller.run({action:'configure',timeZone:' Asia/Tokyo '});
    assert.equal(saved.timeZone,'Asia/Tokyo');
    assert.equal(saved.autoStart,false);
    await assert.rejects(controller.run({action:'configure',timeZone:'+08:00'}),/Invalid IANA/);
    await assert.rejects(controller.run({action:'configure'}),/requires autoStart, timeZone, autoRefreshHours, insecureSubscriptionTls, or proxyEnv/);
    const reload=await new MihomoController(dir).init();
    try {
      assert.equal(reload.status().timeZone,'Asia/Tokyo');
      assert.equal((await reload.run({action:'configure',timeZone:''})).timeZone,null);
    } finally { await reload.dispose(); }
  } finally { await controller.dispose();await fs.rm(dir,{recursive:true,force:true}); }
});

test('subscription usage is read, derived, and kept as "not stated" instead of zero',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-usage-'));
  const body='proxies:\n  - {name: example, type: http, server: 127.0.0.1, port: 12345}\n';
  let header='upload=1000000000; download=4000000000; total=10000000000; expire=1793000000';
  const fetch=async()=>new Response(body,{headers:header?{'subscription-userinfo':header}:{}});
  const controller=await new MihomoController(dir,{fetch}).init();
  try{
    await assert.rejects(controller.run({action:'usage'}),/No subscription URL is saved/);
    await controller.run({action:'import',url:'https://example.com/subscription'});
    const status=await controller.run({action:'usage'});
    assert.equal(status.usage.upload,1000000000);assert.equal(status.usage.download,4000000000);
    assert.equal(status.usage.used,5000000000);assert.equal(status.usage.total,10000000000);
    assert.equal(status.usage.remaining,5000000000);assert.equal(status.usage.percentUsed,50);
    assert.equal(status.usage.expiresAt,new Date(1793000000*1000).toISOString());
    assert.equal(status.usage.expired,false);assert.ok(status.usage.daysLeft>0);
    assert.equal(status.nodeCount,1,'reading usage must not disturb the imported nodes');

    // A provider that states no quota at all must not look like an exhausted one.
    header='upload=1; download=2; total=0; expire=0';
    const unlimited=await controller.run({action:'usage'});
    assert.equal(unlimited.usage.used,3);assert.equal(unlimited.usage.total,null);
    assert.equal(unlimited.usage.remaining,null);assert.equal(unlimited.usage.percentUsed,null);
    assert.equal(unlimited.usage.expiresAt,null);assert.equal(unlimited.usage.expired,false);

    // The last reading survives a restart, and an expired plan stays recognisable.
    header='upload=1; download=2; total=3; expire=1';
    await controller.run({action:'usage'});
    assert.equal(controller.status().usage.expired,true);
    const reload=await new MihomoController(dir).init();
    try{assert.equal(reload.status().usage.expired,true);assert.equal(reload.status().usage.total,3);}
    finally{await reload.dispose();}

    // A provider that publishes nothing gets a plain answer instead of a fabricated zero.
    header='';
    await assert.rejects(controller.run({action:'usage'}),/not reported by this provider/);
  }finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('automatic refresh is opt-in, bounded, and only fires when a refresh is due',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-auto-'));
  const body='proxies:\n  - {name: example, type: http, server: 127.0.0.1, port: 12345}\n';
  let downloads=0;
  const fetch=async()=>{downloads++;return new Response(body,{headers:{'subscription-userinfo':'upload=1; download=2; total=3; expire=0'}});};
  const controller=await new MihomoController(dir,{fetch}).init();
  try{
    assert.equal(controller.status().autoRefreshHours,0,'automatic refresh must be off by default');
    assert.equal((await controller.run({action:'configure',autoRefreshHours:24})).autoRefreshHours,24);
    // An interval with no saved subscription can never fall due.
    assert.equal(controller.status().nextRefreshAt,null);
    assert.equal(controller.refreshDue(Date.now()+365*24*3600000),false);
    for(const bad of [-1,1.5,721,'24',null]) await assert.rejects(controller.run({action:'configure',autoRefreshHours:bad}),/Invalid auto-refresh interval/);

    await controller.run({action:'import',url:'https://example.com/subscription'});
    const imported=controller.status();
    assert.ok(imported.lastRefreshAt,'a successful import counts as the first refresh');
    assert.equal(controller.refreshDue(Date.now()),false,'a fresh import is not immediately due');
    const next=Date.parse(imported.nextRefreshAt);
    assert.ok(next>Date.now()+23*3600000&&next<Date.now()+25*3600000,`unexpected next refresh: ${imported.nextRefreshAt}`);

    downloads=0;
    assert.equal(await controller.autoRefreshTick(Date.now()),false,'not due means no download at all');
    assert.equal(downloads,0);
    assert.equal(await controller.autoRefreshTick(Date.now()+25*3600000),true);
    assert.equal(downloads,1);
    assert.equal(controller.status().lastRefreshError,null);
    // The interval restarts from the wall clock of the refresh that just succeeded.
    assert.equal(await controller.autoRefreshTick(Date.now()+3600000),false,'the interval restarts after every refresh');

    // A failing provider is recorded for the UI; a timer that rejected would be silently swallowed.
    const broken=await new MihomoController(dir,{fetch:async()=>{throw new Error('connect ECONNREFUSED 127.0.0.1:9');}}).init();
    try{
      assert.equal(await broken.autoRefreshTick(Date.now()+100*3600000),false);
      assert.match(broken.status().lastRefreshError,/Download failed/,'the failure is recorded, not swallowed');
      assert.equal(broken.status().phase,'stopped');
      assert.equal(broken.status().nodeCount,1,'a failed refresh keeps the saved nodes');
      // A recorded failure still counts as an attempt, so a broken provider is retried once per
      // interval instead of on every five-minute tick.
      assert.equal(await broken.autoRefreshTick(Date.now()+100*3600000+60000),false,'a failed refresh backs off for a whole interval');
    }finally{await broken.dispose();}
  }finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('a running proxy refreshes onto new nodes, and a refused subscription leaves it untouched',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-reload-'));
  const bytes=Buffer.from('mock executable');
  await fs.writeFile(path.join(dir,'mihomo.exe'),bytes);
  await fs.writeFile(path.join(dir,'kernel.json'),JSON.stringify({version:CORE_VERSION,exeSha256:createHash('sha256').update(bytes).digest('hex')}));
  const old=getGlobalDispatcher();
  const managed=()=>fs.readFile(path.join(dir,'managed.yaml'),'utf8');
  // The fake API reports the node group that is really on disk, so a no-op reload cannot pass.
  const groupNames=async()=>[...(await managed()).split('proxy-groups:')[0].matchAll(/- name: (\S+)/g)].map(m=>m[1]);
  let failValidation=false,selected='example',reloaded=0;
  const fakeSpawn=(exe,args,options)=>{
    assert.equal(options.shell,false);
    const child=new EventEmitter();child.exitCode=null;child.killed=false;child.signalCode=null;child.stdout=new PassThrough();
    child.kill=()=>{child.killed=true;child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));return true;};
    if(args.includes('-t'))queueMicrotask(()=>{const code=failValidation?1:0;child.exitCode=code;child.emit('exit',code);});
    return child;
  };
  const fakeFetch=async(url,init)=>{
    if(String(url).includes('example.com'))return new Response('proxies:\n  - {name: fresh, type: http, server: 127.0.0.1, port: 12345}\n',{headers:{'subscription-userinfo':'upload=1; download=2; total=0; expire=0'}});
    if(String(url).endsWith('/version'))return Response.json({version:CORE_VERSION});
    if(init?.method==='PUT'){
      const payload=JSON.parse(init.body);
      if(String(url).includes('/configs')){if(payload.path!==path.join(dir,'managed.yaml'))throw new Error('reload must name the managed config');reloaded++;return new Response(null,{status:204});}
      selected=payload.name;return new Response(null,{status:204});
    }
    return Response.json({proxies:{DSH:{all:await groupNames(),now:selected}}});
  };
  const controller=await new MihomoController(dir,{spawn:fakeSpawn,fetch:fakeFetch,reservePorts:async()=>[19801,19802],probe:async()=>({url:'http://probe',statusCode:204,fetchMs:1})}).init();
  try{
    await controller.run({action:'import',yaml:'proxies:\n  - {name: example, type: http, server: 127.0.0.1, port: 12345}'});
    await controller.run({action:'start'});
    assert.match(await managed(),/name: example/);

    const refreshed=await controller.run({action:'import',url:'https://example.com/subscription'});
    assert.equal(refreshed.nodeCount,1);assert.equal(refreshed.selected,'fresh');
    assert.equal(refreshed.running,true);assert.equal(refreshed.phase,'running');
    assert.match(await managed(),/name: fresh/);
    assert.equal(selected,'fresh','the group must be re-pointed at the refreshed selection');
    assert.equal(refreshed.usage.used,3);
    assert.equal(reloaded,1);

    // The core refusing the candidate must leave both the file and the saved nodes alone.
    const keptFile=await managed();
    failValidation=true;
    await assert.rejects(controller.run({action:'import',url:'https://example.com/subscription'}),/rejected the refreshed subscription/);
    assert.equal(await managed(),keptFile);
    assert.equal(controller.status().nodeCount,1);
    assert.equal(controller.status().phase,'running');
    assert.equal(reloaded,1,'a refused candidate is never applied');
    assert.notEqual(getGlobalDispatcher(),old,'the running proxy keeps its dispatcher');
  }finally{await controller.dispose();assert.equal(getGlobalDispatcher(),old);await fs.rm(dir,{recursive:true,force:true});}
});

test('a provider certificate problem is named as itself, never flattened into a network error',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-tls-'));
  const failing=code=>async()=>{const error=new Error('fetch failed');error.cause={code};throw error;};
  const cases=[
    ['CERT_HAS_EXPIRED',/certificate has expired/],
    ['DEPTH_ZERO_SELF_SIGNED_CERT',/trusted Node CA/],
    ['CERT_UNTRUSTED',/trusted Node CA/],
    ['ECONNREFUSED',/Check bootstrap network connectivity/],
  ];
  try{
    for(const [code,expected] of cases){
      const controller=await new MihomoController(dir,{fetch:failing(code)}).init();
      try{
        await assert.rejects(controller.run({action:'import',url:'https://example.com/subscription'}),expected,code);
        assert.equal(controller.status().nodeCount,0,`${code} must import nothing`);
        assert.equal(controller.status().subscriptionConfigured,false,`${code} must not save a subscription`);
      }finally{await controller.dispose();}
    }
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('failed downloads do not install an unverified executable',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-download-'));
  const controller=await new MihomoController(dir,{fetch:async()=>Response.json({tag_name:CORE_VERSION,assets:[]})}).init();
  try{await assert.rejects(controller.run({action:'install'}),/Official asset/);assert.equal(controller.status().coreInstalled,false);await assert.rejects(fs.access(path.join(dir,'mihomo.exe')));}finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('autostart retries a failed start once instead of leaving the proxy down',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-autostart-'));
  const controller=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
  try{
    controller.state.autoStart=true;
    let attempts=0;
    controller.run=async()=>{
      attempts+=1;
      if(attempts===1){controller.phase='error';throw new Error('Core controller did not become ready. Check ports or configuration.');}
      controller.phase='running';
      return controller.status();
    };
    await controller.autostart();
    assert.equal(attempts,2,'a transient readiness timeout is retried once');
    assert.equal(controller.status().phase,'running','the retry leaves a working proxy');
  }finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('autostart stops after two attempts and keeps the failure visible',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-autostart2-'));
  const controller=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
  try{
    controller.state.autoStart=true;
    let attempts=0;
    controller.run=async()=>{attempts+=1;controller.phase='error';throw new Error('Core controller did not become ready. Check ports or configuration.');};
    await controller.autostart();
    assert.equal(attempts,2,'autostart does not loop forever on a real failure');
    assert.equal(controller.status().phase,'error','the panel still shows the problem');
  }finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('a state file written before this feature still reports the saved plan',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-backfill-'));
  try{
    const legacy={
      timeZone:null,autoStart:false,subscriptionUrl:'https://example.com/sub',
      nodes:[{name:'剩余流量：98.79 GB',type:'socks5',server:'a.example',port:1080},
             {name:'套餐到期：2026-11-11',type:'socks5',server:'a.example',port:1081}],
      dns:null,insecureTls:0,selected:'剩余流量：98.79 GB',updatedAt:'2026-10-11T13:48:11.612Z',
      autoRefreshHours:0,lastRefreshAt:null,lastRefreshErrorAt:null,lastRefreshError:null,
    };
    await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(legacy));
    const controller=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
    try{
      assert.deepEqual(controller.status().importInfo,
        {remaining:'98.79 GB',expireOn:'2026-11-11',at:'2026-10-11T13:48:11.612Z'},
        'the plan is recovered from node names so it is visible without a fresh download');
    }finally{await controller.dispose();}
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('the subscription certificate is verified unless the operator turns that off',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-tls-'));
  const seen=[];
  const body='proxies:\n  - {name: first, type: http, server: 127.0.0.1, port: 12345}';
  const controller=await new MihomoController(dir,{fetch:async(url,options)=>{seen.push(options);return new Response(body,{status:200,headers:{'content-type':'text/yaml'}});}}).init();
  try{
    await controller.run({action:'import',url:'https://example.test/sub'});
    assert.equal(seen.at(-1).dispatcher,controller.baseline,'a normal download keeps certificate verification');
    assert.equal(controller.status().insecureSubscriptionTls,false,'verification is the default');

    await controller.run({action:'configure',insecureSubscriptionTls:true});
    await controller.run({action:'import',url:'https://example.test/sub'});
    assert.equal(seen.at(-1).dispatcher,controller.relaxedDispatcher(),'the allowed download uses the relaxed dispatcher');
    assert.notEqual(controller.relaxedDispatcher(),controller.baseline,'the relaxed dispatcher is a separate object');
    assert.equal(controller.status().insecureSubscriptionTls,true);

    await assert.rejects(controller.run({action:'configure',insecureSubscriptionTls:'yes'}),/on or off/);
    assert.equal(controller.status().insecureSubscriptionTls,true,'a rejected value leaves the stored choice alone');
  }finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('the subscription TLS choice is remembered across a reload',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-tls2-'));
  const controller=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
  let again;
  try{
    await controller.run({action:'configure',insecureSubscriptionTls:true});
    again=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
    assert.equal(again.status().insecureSubscriptionTls,true,'the operator does not have to repeat the choice');
  }finally{await controller.dispose();if(again)await again.dispose();await fs.rm(dir,{recursive:true,force:true});}
});

test('the running proxy is published to the environment and taken back on stop',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-env-'));
  const before={HTTPS_PROXY:process.env.HTTPS_PROXY,https_proxy:process.env.https_proxy,HTTP_PROXY:process.env.HTTP_PROXY,http_proxy:process.env.http_proxy,ALL_PROXY:process.env.ALL_PROXY,all_proxy:process.env.all_proxy,NO_PROXY:process.env.NO_PROXY,no_proxy:process.env.no_proxy};
  for(const key of Object.keys(before))delete process.env[key];
  process.env.NO_PROXY='corp.internal';
  const controller=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
  try{
    controller.session={proxyPassword:'pw',mixedPort:30666,apiPort:30667,apiSecret:'s'};
    controller.applyProxyEnv();
    const proxy='http://dsh:pw@127.0.0.1:30666';
    assert.equal(process.env.HTTPS_PROXY,proxy,'a client reading HTTPS_PROXY finds the tunnel');
    assert.equal(process.env.HTTP_PROXY,proxy);
    assert.equal(process.env.ALL_PROXY,proxy,'the all_proxy fallback is covered too');
    assert.match(process.env.NO_PROXY,/corp\.internal/,'an existing bypass list is kept');
    assert.match(process.env.NO_PROXY,/deepseek\.com/,'the domestic model API is excluded from the tunnel');
    assert.equal(process.env.no_proxy,process.env.NO_PROXY,'both spellings agree');

    controller.clearProxyEnv();
    assert.equal(process.env.HTTPS_PROXY,undefined,'stopping restores the outer environment');
    assert.equal(process.env.NO_PROXY,'corp.internal','the pre-existing value comes back untouched');
  }finally{await controller.dispose();for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(dir,{recursive:true,force:true});}
});

test('turning the environment export off withdraws it immediately',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-env2-'));
  const before=process.env.HTTPS_PROXY;
  delete process.env.HTTPS_PROXY;
  const controller=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
  try{
    controller.session={proxyPassword:'pw',mixedPort:30668,apiPort:30669,apiSecret:'s'};
    controller.applyProxyEnv();
    assert.ok(process.env.HTTPS_PROXY,'published first');
    await controller.run({action:'configure',proxyEnv:false});
    assert.equal(process.env.HTTPS_PROXY,undefined,'the switch takes effect without a restart');
    assert.equal(controller.status().proxyEnv,false);
    assert.equal(controller.status().proxyEnvActive,false);
  }finally{await controller.dispose();if(before!==undefined)process.env.HTTPS_PROXY=before;await fs.rm(dir,{recursive:true,force:true});}
});

test('the environment export stays off when the operator switched it off',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-env3-'));
  const before=process.env.HTTPS_PROXY;
  delete process.env.HTTPS_PROXY;
  const first=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
  try{
    await first.run({action:'configure',proxyEnv:false});
    const again=await new MihomoController(dir,{fetch:async()=>new Response('{}')}).init();
    try{
      again.session={proxyPassword:'pw',mixedPort:30670,apiPort:30671,apiSecret:'s'};
      again.applyProxyEnv();
      assert.equal(process.env.HTTPS_PROXY,undefined,'a saved opt-out is respected after a restart');
      assert.equal(again.status().proxyEnv,false);
    }finally{await again.dispose();}
  }finally{await first.dispose();if(before!==undefined)process.env.HTTPS_PROXY=before;await fs.rm(dir,{recursive:true,force:true});}
});
