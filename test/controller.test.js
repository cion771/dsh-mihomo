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

test('failed downloads do not install an unverified executable',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mihomo-download-'));
  const controller=await new MihomoController(dir,{fetch:async()=>Response.json({tag_name:CORE_VERSION,assets:[]})}).init();
  try{await assert.rejects(controller.run({action:'install'}),/Official asset/);assert.equal(controller.status().coreInstalled,false);await assert.rejects(fs.access(path.join(dir,'mihomo.exe')));}finally{await controller.dispose();await fs.rm(dir,{recursive:true,force:true});}
});
