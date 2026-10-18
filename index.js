import path from 'node:path';
import { homedir } from 'node:os';
import { MihomoController } from './controller.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { timeZoneHook } from './timezone.js';
import { matchesSchema } from './validation.js';

export const inject = ['connection', 'tools'];
export const parameters = {
  type: 'object', additionalProperties: false,
  properties: {
    action: {type:'string',enum:['status','install','import','refresh','usage','traffic','start','stop','select','test','latency','configure'],description:'status reads state; install downloads the pinned official Windows core; import replaces nodes; refresh redownloads the saved subscription (allowed while the proxy runs, via a validated config reload); usage reads the subscription quota without touching the nodes; traffic lists live totals and the busiest connections; start/stop affects every session in this DSH Host; select switches one node; test checks global fetch; latency measures every node; configure sets auto-start, the automatic subscription-refresh interval, the model time-zone preference, and whether a subscription download may skip TLS verification.'},
    url: {type:'string',description:'For import: HTTPS Clash/Mihomo subscription URL. Use either url or yaml. Contains secrets: prefer the Settings UI to avoid recording it in the session log.'},
    yaml: {type:'string',description:'For import: Clash/Mihomo YAML with inline proxies. Contains credentials: prefer the Settings UI. Requires proxy stopped. Proxies are validated; routing, groups and providers are inherited with the inbound and host-level keys the plugin must own replaced.'},
    node: {type:'string',description:'For select: an exact imported node name from status.'},
    autoStart: {type:'boolean',description:'For configure: whether the saved core and nodes should start when this plugin mounts.'},
    timeZone: {type:'string',description:'For configure: manual IANA zone (e.g. Asia/Tokyo or UTC) for model interpretation of unqualified dates/times in all Host sessions. Empty string disables the override. Independent of proxy state; does not change browser/system clocks or saved reminder schedules. configure requires at least autoStart, timeZone, autoRefreshHours, or insecureSubscriptionTls.'},
    autoRefreshHours: {type:'integer',minimum:0,maximum:720,description:'For configure: refresh the saved subscription every N hours while the plugin is loaded. 0 disables it. A refresh while the proxy runs is applied through a validated core config reload, so a broken subscription leaves the running proxy on its previous nodes.'},
  insecureSubscriptionTls: {type:'boolean',description:'For configure: whether a saved-subscription download may skip TLS certificate verification. Default false (verify). Enable only when the provider certificate is expired or self-signed, because it stops proving that the subscription host is the one it claims; it applies to the subscription download only and never to the core download or to model/tool traffic.'},
  proxyEnv: {type:'boolean',description:'For configure: whether the running proxy is published to HTTPS_PROXY/HTTP_PROXY/ALL_PROXY and NO_PROXY while it runs, then restored on stop. Default true. Needed by clients that read the environment instead of the Host dispatcher - the Codex/GPT upstream resolves its proxy that way and cannot reach chatgpt.com without it. NO_PROXY keeps localhost, 127.0.0.1, deepseek.com and .cn direct, so domestic traffic never enters the tunnel. Turn it off to keep the Host process environment untouched, at the cost of GPT access.'},
  },
  required:['action'],
};

async function inputOf(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON body is required.');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024 * 1024) throw new Error('Request exceeds 16 MiB.');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new Error('Invalid or oversized JSON request.'); }
  finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

function validate(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !parameters.properties.action.enum.includes(args.action)) throw new Error('Unknown action.');
  for (const [key,value] of Object.entries(args)) {
    if (!parameters.properties[key] || !matchesSchema(value, parameters.properties[key])) throw new Error('Invalid action parameters.');
  }
  const allowed = {status:[],install:[],import:['url','yaml'],refresh:[],usage:[],traffic:[],start:[],stop:[],select:['node'],test:[],latency:[],configure:['autoStart','timeZone','autoRefreshHours','insecureSubscriptionTls','proxyEnv']}[args.action];
  if (Object.keys(args).some(key=>key!=='action'&&!allowed.includes(key))) throw new Error('Parameters do not match the action.');
  return args;
}

export async function apply(ctx) {
  const base = process.env.DSH_PROFILE_DIR ?? path.join(homedir(),'.dsh');
  const controller = await new MihomoController(path.join(base,'data','dsh-mihomo')).init();
  ctx.effect(() => () => controller.dispose());
  ctx.on('agent/pre-step', timeZoneHook(() => controller.state.timeZone, createUserMessage), {prepend:true});
  ctx.connection.fetch.register({
    path:'/api/dsh-mihomo',methods:['POST'],requestBody:'buffered',
    async fetch(request) {
      try {
        const result = await controller.run(validate(await inputOf(request)),request.signal);
        return Response.json({ok:true,result},{headers:{'Cache-Control':'no-store'}});
      } catch (error) {
        return Response.json({ok:false,error:error.message},{status:400,headers:{'Cache-Control':'no-store'}});
      }
    },
  });
  ctx.tools.register({
    name:'dsh_proxy',deferLoading:true,
    description:'Manage the DSH-only Mihomo proxy: official core installation, node import/refresh, subscription quota (remaining traffic and expiry as reported by the provider), automatic subscription refresh, start/stop, node selection, latency measurement, connectivity check, auto-start and a manual model time-zone preference. The time-zone preference affects date interpretation only, not browser/system clocks or saved reminders. Affects all sessions in this Host, not Windows system proxy or TUN. Covers main-process global fetch only; browsers, subprocesses and pinned web_fetch are excluded. Subscription and node credentials should be entered in Settings rather than the logged tool input.',
    parameters,
    output:{schema:{type:'object'},render(_args,value) {
      const brief = {...value};
      if (brief.nodes) { brief.nodes = brief.nodes.slice(0,40); brief.nodesTruncated = value.nodes.length > 40; }
      if (brief.state?.nodes) brief.state = {...brief.state,nodes:brief.state.nodes.slice(0,40),nodesTruncated:brief.state.nodes.length>40};
      if (Array.isArray(brief.results)) {
        const reachable = brief.results.filter(r => typeof r.delayMs === 'number').sort((a,b) => a.delayMs - b.delayMs);
        brief.reachable = reachable;
        brief.unreachableCount = brief.results.length - reachable.length;
        delete brief.results;
      }
      return [{type:'text',text:JSON.stringify(brief,null,2)}];
    }},
    execute(args,exec) { return controller.run(validate(args),exec.signal); },
    isConcurrencySafe: args => args?.action === 'status',
  });
  await controller.autostart();
  controller.startAutoRefresh();
}
