window.__ModuleLoader__.load({
  id: '@local/dsh-mihomo',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const dicts = {
      zh: {
        title:'DSH 专用代理', intro:'Mihomo 内核 · 仅主进程 · 不改系统网络',
        scope:'影响本 Host 的所有 DSH 会话。只代理主进程 global fetch（如模型/API 请求）；系统代理、TUN、浏览器、外部命令、worker、遥测及独立传输的 web_fetch 不受此插件控制。',
        safety:'订阅只导入节点，以及解析节点地址所必需的 DNS 设置；TUN、监听端口、规则、脚本和 external-ui 等危险项仍被丢弃。启动时会先验证链路，不通就自动回滚，不会让 DSH 自己断网。运行中内核意外退出时公开 fetch 保持阻断，点击停止可恢复原网络策略。',
        installing:'下载并校验内核', import:'导入节点', start:'启动 DSH 代理', stop:'停止并恢复原网络策略', test:'测试 DSH 连通性', refresh:'更新订阅', reload:'刷新状态',
        core:'内核', missing:'未安装', nodes:'节点', selected:'所选节点', empty:'先导入 Clash/Mihomo 格式订阅或配置', source:'订阅与配置',
        url:'订阅地址（HTTPS）', urlHint:'已有订阅已保存；留空表示不更改', urlPlaceholder:'https://…（选择 Clash / Mihomo 格式）',
        yaml:'或粘贴 Clash/Mihomo YAML', yamlPlaceholder:'proxies:\n  - name: …\n    type: …\n    server: …\n    port: …',
        importHint:'订阅可以在代理运行时直接更新：新配置先交给内核校验，校验不通过就保留原节点。粘贴 YAML 仍需先停止代理。为让服务商的节点可用，节点自带的 TLS 与 DNS 选项会被保留（风险见下方提示）。支持含内联 proxies 的 YAML；不支持 provider-only、Base64 或 URI 列表。地址及节点凭据存储于本地，不回显、不写入会话。',
        auto:'随插件加载自动启动', autoHint:'默认关闭；启用后使用已安装内核及已保存节点。停止代理不会更改此偏好。',
        switch:'应用节点', state:'状态', active:'主进程代理已接管', inactive:'未接管主进程网络',
        license:'内核下载自官方固定版本 v1.19.32，校验 GitHub SHA256；该版本为 GPLv3。', sourceLink:'Mihomo 源码与许可', reference:'参考 Clash Verge Rev',
        busy:'正在执行，请稍候…', success:'操作完成', latency:'连通性通过，耗时', ms:'毫秒', error:'操作未完成', updated:'最近导入', never:'尚未导入',
        phaseStopped:'已停止', phaseRunning:'运行中', phaseStarting:'启动中', phaseInstalling:'内核安装中', phaseImporting:'节点导入中', phaseError:'异常',
        tlsWarn:'TLS 提示：{n} 个节点要求跳过证书校验（服务商订阅自带）。经这些节点转发时，到节点的 TLS 无法验证，链路上的第三方可观察元数据。',
        dnsWarn:'这些节点的域名是私有地址，只能由订阅自带的加密 DNS 解析，因此该 DNS 配置被保留，服务商可观察节点解析。TUN、监听端口、规则与脚本仍被丢弃。',
        dnsSystem:'节点域名使用系统 DNS 解析。',
        timeZoneTitle:'时间地区', timeZoneLabel:'自定义 IANA 时区', timeZoneAdvanced:'找不到所在地区？高级设置', timeZoneSave:'应用自定义时区', timeZoneDefault:'自动（跟随浏览器）', timeZoneCurrent:'当前地区', timeZoneHint:'让模型按所选地区理解“今天、明天、下午 3 点”等说法。点击地区立即生效；不需要启动代理，也不会修改电脑或网页时钟。',
        zoneAuto:'自动（跟随浏览器）', zoneUTC:'国际标准时间', zoneChina:'中国大陆 · 北京时间', zoneHongKong:'中国香港', zoneTaiwan:'中国台湾', zoneJapan:'日本 · 东京时间', zoneKorea:'韩国 · 首尔时间', zoneSingapore:'新加坡', zoneIndia:'印度', zoneUK:'英国 · 伦敦时间', zoneEurope:'欧洲中部 · 巴黎时间', zoneUSEast:'美国东部 · 纽约时间', zoneUSCentral:'美国中部 · 芝加哥时间', zoneUSMountain:'美国山地 · 丹佛时间', zoneUSWest:'美国西部 · 洛杉矶时间', zoneSydney:'澳大利亚 · 悉尼时间', zoneNewZealand:'新西兰 · 奥克兰时间',
        latencyTest:'检测延迟', latencyTesting:'检测中…', latencyDone:'延迟检测完成', latencyWait:'正在逐个测试节点，请稍候…',
        latencyHint:'检测延迟需要先启动代理；结果为节点到测速地址的往返延迟。', unreachable:'不通',
        usageTitle:'订阅用量', usageUsed:'已用', usageRemaining:'剩余', usageExpire:'到期', usageReadAt:'读取时间',
        usageNoExpire:'服务商未提供到期时间', usageExpired:'已过期', usageDaysLeft:'剩 {n} 天', usagePercent:'已用 {n}%', usageUnlimited:'服务商未提供总额度',
        usageUnknown:'服务商没有在订阅里提供流量信息（subscription-userinfo）。是否显示用量由服务商决定，本插件无法自行推算。',
        usageNoSubscription:'先导入订阅地址，才能查询用量。', usageCheck:'查询剩余流量',
        usageImportFallback:'读不到实时用量（原因见下方提示），下面是服务商写在订阅里、上次导入时保存的套餐信息。',
        usageSnapshotAt:'快照时间：{t}，之后可能已经变化。',
        usageStale:'以上是上次读取的结果，点“查询剩余流量”可更新。',
        trafficTitle:'实时流量', trafficNeedStart:'启动代理后才会读取实时流量。', trafficNoData:'还没有读到流量。',
        trafficRate:'当前下载速率', trafficActive:'活动连接', trafficIdle:'当前没有活动连接。',
        trafficNote:'每 2.5 秒读取一次本机内核的统计；连接内容只显示在这个面板里，不会发送到任何地方，也不写入日志。',
        autoRefreshTitle:'自动更新订阅', autoRefreshOff:'关闭', autoRefreshOffHint:'只在手动点击时更新',
        autoRefreshEvery:'每 {n} 小时', autoRefreshHint:'到期自动重新下载订阅',
        autoRefreshNext:'下次自动更新：{t}', autoRefreshFailed:'上次自动更新失败：',
        autoRefreshNote:'代理运行中也一样自动更新：新配置先交给内核校验，校验不通过就保留原节点，不会把正在用的代理弄断。',
        insecureTitle:'不校验订阅服务器证书', insecureOn:'已关闭校验',
        insecureHint:'只影响“下载订阅”这一步，用来处理服务商证书过期或自签名的情况。开启后无法再确认对端就是订阅服务商，同网络上的第三方可能看到或篡改下载内容。内核下载仍会校验，模型和工具的联网也不受影响。',
      },
      en: {
        title:'DSH-only Proxy',intro:'Mihomo core · Main process only · No system network changes',
        scope:'Affects all DSH sessions in this Host. Proxies main-process global fetch (e.g. model/API requests) only. System proxy, TUN, browsers, external commands, workers, telemetry and the independently pinned web_fetch transport are not controlled by this plugin.',
        safety:'Only nodes are imported, plus the DNS settings required to resolve the node addresses. TUN, listeners, rules, scripts and external-ui are still discarded. Start verifies connectivity first and rolls back automatically when the proxy cannot carry traffic, so DSH is never left offline. If the running core exits, public fetch stays blocked until Stop restores the previous policy.',
        installing:'Download and verify core',import:'Import nodes',start:'Start DSH proxy',stop:'Stop and restore previous policy',test:'Test DSH connectivity',refresh:'Refresh subscription',reload:'Refresh status',
        core:'Core',missing:'Not installed',nodes:'Nodes',selected:'Selected node',empty:'Import a Clash/Mihomo subscription or configuration first',source:'Subscription & configuration',
        url:'Subscription URL (HTTPS)',urlHint:'A subscription is saved; leave blank to keep it',urlPlaceholder:'https://… (Clash / Mihomo format)',
        yaml:'Or paste Clash/Mihomo YAML',yamlPlaceholder:'proxies:\n  - name: …\n    type: …\n    server: …\n    port: …',
        importHint:'A saved subscription can refresh while the proxy runs: the new configuration is validated by the core first, and a failure keeps the previous nodes. Pasted YAML still needs the proxy stopped. The subscription\'s own TLS and DNS options are kept so its nodes stay usable (risks are shown below). Inline-proxies YAML is supported; provider-only, Base64 and URI lists are not. URLs and credentials stay in local storage, without echoing or session logging.',
        auto:'Auto-start when plugin loads',autoHint:'Off by default. Uses the installed core and saved nodes. Stop does not change this preference.',switch:'Apply node',state:'Status',active:'Main-process proxy is active',inactive:'Main-process proxy is not active',
        license:'Official pinned v1.19.32 core download, verified with GitHub SHA256; this release is GPLv3.',sourceLink:'Mihomo source & license',reference:'Clash Verge Rev reference',
        busy:'Working, please wait…',success:'Operation completed',latency:'Connectivity passed in',ms:'ms',error:'Operation failed',updated:'Last import',never:'Not imported yet',
        phaseStopped:'Stopped',phaseRunning:'Running',phaseStarting:'Starting',phaseInstalling:'Installing core',phaseImporting:'Importing nodes',phaseError:'Error',
        tlsWarn:'TLS notice: {n} node(s) require skipping certificate verification, as the provider supplies it. Traffic through them is not authenticated at the proxy hop, so a third party on that path can observe metadata.',
        dnsWarn:'These node hostnames are private names resolvable only by the subscription own encrypted DNS, so that DNS configuration is kept and the provider can observe node resolution. TUN, listeners, rules and scripts are still discarded.',
        dnsSystem:'Node hostnames are resolved with the system DNS.',
        timeZoneTitle:'Time region', timeZoneLabel:'Custom IANA time zone', timeZoneAdvanced:'Can’t find your region? Advanced settings', timeZoneSave:'Apply custom time zone', timeZoneDefault:'Automatic (follow browser)', timeZoneCurrent:'Current region', timeZoneHint:'Makes the model understand “today”, “tomorrow”, and local times using the selected region. A click applies immediately. The proxy can stay stopped, and computer/web clocks are unchanged.',
        zoneAuto:'Automatic (follow browser)', zoneUTC:'Coordinated Universal Time', zoneChina:'Mainland China · Beijing time', zoneHongKong:'Hong Kong', zoneTaiwan:'Taiwan', zoneJapan:'Japan · Tokyo time', zoneKorea:'South Korea · Seoul time', zoneSingapore:'Singapore', zoneIndia:'India', zoneUK:'United Kingdom · London time', zoneEurope:'Central Europe · Paris time', zoneUSEast:'US Eastern · New York time', zoneUSCentral:'US Central · Chicago time', zoneUSMountain:'US Mountain · Denver time', zoneUSWest:'US Pacific · Los Angeles time', zoneSydney:'Australia · Sydney time', zoneNewZealand:'New Zealand · Auckland time',
        latencyTest:'Measure latency', latencyTesting:'Measuring…', latencyDone:'Latency measured', latencyWait:'Testing every node, please wait…',
        latencyHint:'Latency measurement needs the proxy running; each value is the node round trip to the test target.', unreachable:'failed',
        usageTitle:'Subscription usage', usageUsed:'Used', usageRemaining:'Remaining', usageExpire:'Expires', usageReadAt:'Read at',
        usageNoExpire:'The provider did not state an expiry', usageExpired:'expired', usageDaysLeft:'{n} days left', usagePercent:'{n}% used', usageUnlimited:'the provider stated no total quota',
        usageUnknown:'This provider does not publish traffic information in the subscription (subscription-userinfo). Whether usage appears at all is the provider’s choice; the plugin cannot derive it.',
        usageNoSubscription:'Import a subscription URL before usage can be read.', usageCheck:'Read remaining traffic',
        usageImportFallback:'Live usage cannot be read right now (the reason is shown below). These are the plan details the provider wrote into the subscription, saved at the last import.',
        usageSnapshotAt:'Snapshot taken {t}; it may have changed since.',
        usageStale:'This is the last reading; use “Read remaining traffic” to update it.',
        trafficTitle:'Live traffic', trafficNeedStart:'Start the proxy to read live traffic.', trafficNoData:'No traffic has been read yet.',
        trafficRate:'Current download rate', trafficActive:'Active connections', trafficIdle:'No active connections right now.',
        trafficNote:'Read from the local core every 2.5 seconds; what appears here stays in this panel — nothing is sent anywhere and nothing is logged.',
        autoRefreshTitle:'Automatic subscription refresh', autoRefreshOff:'Off', autoRefreshOffHint:'Refresh manually only',
        autoRefreshEvery:'Every {n} h', autoRefreshHint:'Re-download the subscription when due',
        autoRefreshNext:'Next automatic refresh: {t}', autoRefreshFailed:'Last automatic refresh failed:',
        autoRefreshNote:'This also works while the proxy runs: the new configuration is validated by the core first, and a failure keeps the previous nodes instead of breaking the proxy you are using.',
        insecureTitle:'Do not verify the subscription certificate', insecureOn:'Verification is off',
        insecureHint:'Affects the subscription download only, for providers whose certificate has expired or is self-signed. With it on, the host can no longer be proven to be the provider you intended, and someone on the same network could read or alter what is downloaded. The core download is still verified, and model and tool traffic are unaffected.',
      },
    };
    const timeZones = [
      { zone:'', label:'zoneAuto' },
      { zone:'Asia/Shanghai', label:'zoneChina' },
      { zone:'Asia/Hong_Kong', label:'zoneHongKong' },
      { zone:'Asia/Taipei', label:'zoneTaiwan' },
      { zone:'Asia/Tokyo', label:'zoneJapan' },
      { zone:'Asia/Seoul', label:'zoneKorea' },
      { zone:'Asia/Singapore', label:'zoneSingapore' },
      { zone:'Asia/Kolkata', label:'zoneIndia' },
      { zone:'Europe/London', label:'zoneUK' },
      { zone:'Europe/Paris', label:'zoneEurope' },
      { zone:'America/New_York', label:'zoneUSEast' },
      { zone:'America/Chicago', label:'zoneUSCentral' },
      { zone:'America/Denver', label:'zoneUSMountain' },
      { zone:'America/Los_Angeles', label:'zoneUSWest' },
      { zone:'Australia/Sydney', label:'zoneSydney' },
      { zone:'Pacific/Auckland', label:'zoneNewZealand' },
      { zone:'UTC', label:'zoneUTC' },
    ];
    const css = `.dsh-mh{max-width:800px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;padding:8px 0 28px}.dsh-mh *{box-sizing:border-box}.dsh-mh h2{font-size:20px;margin:0 0 4px}.dsh-mh h3{font-size:14px;margin:0 0 14px}.dsh-mh p{margin:6px 0;color:var(--dsw-alias-label-secondary)}.dsh-mh-card{margin-top:18px;padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.dsh-mh-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.dsh-mh button{font:inherit;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 12px;cursor:pointer}.dsh-mh button:disabled{opacity:.45;cursor:not-allowed}.dsh-mh button:focus-visible,.dsh-mh input:focus-visible,.dsh-mh textarea:focus-visible,.dsh-mh select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dsh-mh .dsh-mh-primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}.dsh-mh label{display:block;margin-top:14px;margin-bottom:5px}.dsh-mh input:not([type=checkbox]),.dsh-mh textarea,.dsh-mh select{width:100%;font:inherit;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 11px}.dsh-mh textarea{resize:vertical;min-height:130px;font-family:ui-monospace,monospace}.dsh-mh small{display:block;color:var(--dsw-alias-label-secondary);margin-top:6px}.dsh-mh-stat{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0}.dsh-mh-stat div{min-width:110px;max-width:100%;overflow-wrap:anywhere}.dsh-mh-stat b{display:block;font-weight:600;font-size:15px}.dsh-mh-stat span{color:var(--dsw-alias-label-secondary)}.dsh-mh-notice{padding:12px 14px;margin-top:14px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}.dsh-mh-notice[role=alert]{color:var(--dsw-alias-state-error-primary)}.dsh-mh-check{display:flex!important;align-items:center;gap:9px;cursor:pointer}.dsh-mh-check input{accent-color:var(--dsw-alias-brand-primary)}.dsh-mh a{color:var(--dsw-alias-brand-primary)}.dsh-mh-good{color:var(--dsw-alias-state-success-primary)}.dsh-mh-warn{color:var(--dsw-alias-state-warn-primary)}`;
    return {
      inject:['slots','locale'],
      apply(ctx) {
        ctx.locale.register('dsh-mihomo','zh',dicts.zh);
        ctx.locale.register('dsh-mihomo','en',dicts.en);
        const t = ctx.locale.bind('dsh-mihomo');
        function Panel() {
          React.useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale),ctx.locale.getSnapshot.bind(ctx.locale));
          const [state,setState] = React.useState(null);
          const [url,setUrl] = React.useState('');
          const [yaml,setYaml] = React.useState('');
          const [selected,setSelected] = React.useState('');
          const [timeZone,setTimeZone] = React.useState('');
          const [busy,setBusy] = React.useState(false);
          const [notice,setNotice] = React.useState('');
          const [error,setError] = React.useState('');
          const [open,setOpen] = React.useState(false);
          const [highlight,setHighlight] = React.useState(0);
          const [latencies,setLatencies] = React.useState({});
          const [testing,setTesting] = React.useState(false);
          const [live,setLive] = React.useState(null);
          const [liveError,setLiveError] = React.useState('');
          const liveBasis = React.useRef(null);
          const pickerRef = React.useRef(null);
          const listRef = React.useRef(null);
          const mounted = React.useRef(true);
          const controllers = React.useRef(new Set());
          async function call(args) {
            const abort = new AbortController(); controllers.current.add(abort);
            try {
              const response = await fetch('/api/dsh-mihomo',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),signal:abort.signal});
              let body; try { body = await response.json(); } catch { throw new Error(`${t('error')} (HTTP ${response.status})`); }
              if (!body.ok) throw new Error(body.error || t('error'));
              return body.result;
            } finally { controllers.current.delete(abort); }
          }
          const receive = result => { const value = result.state || result; setState(value); setSelected(value.selected || ''); setTimeZone(value.timeZone || ''); };
          React.useEffect(() => {
            mounted.current = true;
            call({action:'status'}).then(value=>{if(mounted.current)receive(value);}).catch(err=>{if(mounted.current)setError(err.message);});
            return () => { mounted.current=false; for (const c of controllers.current)c.abort(); controllers.current.clear(); };
          },[]);
          // Close the node list on an outside click and give it focus while it is open.
          React.useEffect(() => {
            if (!open) return undefined;
            const onPointerDown = event => { if (pickerRef.current && !pickerRef.current.contains(event.target)) setOpen(false); };
            document.addEventListener('mousedown',onPointerDown);
            listRef.current?.focus();
            return () => document.removeEventListener('mousedown',onPointerDown);
          },[open]);
          // Live traffic is polled only while it can be useful. The core already keeps the counters,
          // so the current rate is the difference between two reads rather than a sampler of ours,
          // and nothing is sent anywhere: this reads loopback and renders what it gets.
          React.useEffect(() => {
            if (!state?.running) { setLive(null); liveBasis.current = null; return undefined; }
            let stopped = false;
            const read = async () => {
              try {
                const value = await call({action:'traffic'});
                if (stopped || !mounted.current) return;
                const now = Date.now();
                const previous = liveBasis.current;
                const rate = previous && now > previous.at
                  ? Math.max(0,(value.down - previous.down) / ((now - previous.at) / 1000))
                  : null;
                liveBasis.current = { at: now, down: value.down };
                setLive({ ...value, rate });
                setLiveError('');
              } catch (err) {
                if (!stopped && mounted.current) setLiveError(err.message);
              }
            };
            read();
            const timer = setInterval(() => { if (document.visibilityState !== 'hidden') read(); },2500);
            return () => { stopped = true; clearInterval(timer); };
          },[state?.running]);
          async function action(args) {
            if (busy) return;
            setBusy(true);setError('');setNotice('');
            try {
              const result = await call(args);
              if (!mounted.current) return;
              receive(result);
              if (args.action==='import') {setUrl('');setYaml('');}
              setNotice(args.action==='test'?`${t('latency')} ${result.latencyMs} ${t('ms')}`:args.action==='status'?'':t('success'));
            } catch (err) {
              if (mounted.current) {
                setError(err.message);
                try {const snapshot=await call({action:'status'});if(mounted.current)receive(snapshot);}catch{}
              }
            } finally {if(mounted.current)setBusy(false);}
          }
          async function runLatency() {
            if (busy || testing) return;
            setTesting(true);setError('');setNotice('');
            try {
              const result = await call({action:'latency'});
              if (!mounted.current) return;
              const map = {};
              for (const entry of result.results || []) map[entry.name] = entry;
              setLatencies(map);receive(result);setNotice(t('latencyDone'));
            } catch (err) { if (mounted.current) setError(err.message); }
            finally { if (mounted.current) setTesting(false); }
          }
          function togglePicker() {
            if (busy || !state?.nodeCount) return;
            setHighlight(Math.max(0,state.nodes.findIndex(n=>n.name===selected)));
            setOpen(v=>!v);
          }
          function onListKey(event) {
            const names = state?.nodes?.map(n=>n.name) ?? [];
            if (event.key==='Escape') { setOpen(false); return; }
            if (event.key==='Enter') { if (names[highlight]) { setSelected(names[highlight]); setOpen(false); } return; }
            if (event.key!=='ArrowDown' && event.key!=='ArrowUp') return;
            event.preventDefault();
            const next = Math.min(names.length-1,Math.max(0,highlight+(event.key==='ArrowDown'?1:-1)));
            setHighlight(next);
            listRef.current?.children?.[next]?.scrollIntoView({block:'nearest'});
          }
          const latencyBadge = name => {
            const entry = latencies[name];
            if (!entry) return null;
            if (typeof entry.delayMs === 'number') {
              const tone = entry.delayMs<300?'dsh-mh-lat-good':entry.delayMs<800?'':'dsh-mh-lat-slow';
              return h('span',{className:('dsh-mh-lat '+tone).trim()},`${entry.delayMs} ms`);
            }
            return h('span',{className:'dsh-mh-lat dsh-mh-lat-bad'},t('unreachable'));
          };
          const button = (label,args,disabled,primary) => h('button',{type:'button',disabled:busy||disabled,onClick:()=>action(args),className:primary?'dsh-mh-primary':undefined},t(label));
          const isOn = state?.running || state?.proxyActive;
          const usage = state?.usage ?? null;
          // Off by default. Turning it on deliberately gives up exactly one
          // guarantee — that the host is the subscription provider — so the panel
          // keeps saying so while it is on rather than silently remembering it.
          const insecureSub = state?.insecureSubscriptionTls === true;
          const refreshHours = state?.autoRefreshHours ?? 0;
          const refreshOptions = [0,6,12,24,72];
          // Byte counts arrive as plain integers; a quota can legitimately be absent (0 = not stated).
          const bytes = value => {
            if (typeof value !== 'number' || !Number.isFinite(value)) return t('missing');
            const units = ['B','KiB','MiB','GiB','TiB','PiB'];
            let size = value, unit = 0;
            while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
            return `${unit === 0 || size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
          };
          const activeTimeZone = state?.timeZone || '';
          const activeTimeZoneEntry = timeZones.find(entry => entry.zone === activeTimeZone);
          const activeTimeZoneLabel = activeTimeZoneEntry ? t(activeTimeZoneEntry.label) : activeTimeZone;
          const phaseKey = {stopped:'phaseStopped',running:'phaseRunning',starting:'phaseStarting',installing:'phaseInstalling',importing:'phaseImporting',error:'phaseError'}[state?.phase] || 'phaseStopped';
          return h('section',{className:'dsh-mh','aria-label':t('title')},
            h('style',null,css),
            // The node list is drawn by this plugin: a native option popup cannot be
            // themed reliably, and its highlight made the selected node unreadable.
            h('style',null,'.dsh-mh-picker{position:relative}.dsh-mh-trigger{width:100%;display:flex;align-items:center;gap:10px;text-align:left}.dsh-mh-trigger-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-mh-caret{color:var(--dsw-alias-label-secondary)}.dsh-mh-list{margin:8px 0 0;padding:4px;list-style:none;max-height:280px;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.dsh-mh-list:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dsh-mh-option{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;cursor:pointer;border-left:3px solid transparent}.dsh-mh-option-highlight{background:var(--dsw-alias-bg-layer-2)}.dsh-mh-option-active{border-left-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600}.dsh-mh-option-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-mh-option-meta{color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-mh-lat{font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:56px;text-align:right}.dsh-mh-lat-good{color:var(--dsw-alias-state-success-primary)}.dsh-mh-lat-slow{color:var(--dsw-alias-state-warn-primary)}.dsh-mh-lat-bad{color:var(--dsw-alias-state-error-primary)}.dsh-mh button:disabled{opacity:.55}'),
            h('style',null,'.dsh-mh-zone-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:8px;margin-top:14px}.dsh-mh .dsh-mh-zone{display:flex;flex-direction:column;align-items:flex-start;min-height:60px;text-align:left;padding:9px 11px}.dsh-mh-zone-name{font-weight:600}.dsh-mh-zone-id{color:var(--dsw-alias-label-secondary);font-size:11px;overflow-wrap:anywhere}.dsh-mh .dsh-mh-zone-active{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,var(--dsw-alias-bg-layer-2))}.dsh-mh-timezone-advanced{margin-top:14px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}.dsh-mh-timezone-advanced summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}.dsh-mh-usage-bar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin:4px 0 12px}.dsh-mh-usage-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}.dsh-mh-usage-high{background:var(--dsw-alias-state-error-primary)}.dsh-mh-usage-num{font-variant-numeric:tabular-nums}.dsh-mh-live{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:4px}.dsh-mh-live li{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:baseline;font-size:12px}.dsh-mh-live-host{overflow-wrap:anywhere}.dsh-mh-live-chain{color:var(--dsw-alias-label-secondary);font-size:11px;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'),
            h('h2',null,t('title')),h('p',null,t('intro')),
            h('div',{className:'dsh-mh-notice'},t('scope')),
            h('div',{className:'dsh-mh-card'},
              h('h3',null,t('state'),' · ',t(phaseKey)),
              h('strong',{className:state?.proxyActive?'dsh-mh-good':'dsh-mh-warn'},t(state?.proxyActive?'active':'inactive')),
              h('div',{className:'dsh-mh-stat'},
                h('div',null,h('span',null,t('core')),h('b',null,state?.coreVersion||t('missing'))),
                h('div',null,h('span',null,t('nodes')),h('b',null,state?.nodeCount??0)),
                h('div',null,h('span',null,t('updated')),h('b',null,state?.updatedAt?new Date(state.updatedAt).toLocaleString():t('never')))),
              h('div',{className:'dsh-mh-actions'},
                button('installing',{action:'install'},isOn),button('start',{action:'start'},!state?.coreInstalled||!state?.nodeCount||isOn,true),
                button('stop',{action:'stop'},!isOn),button('test',{action:'test'},!state?.proxyActive),button('reload',{action:'status'},false)),
              h('label',{className:'dsh-mh-check'},h('input',{type:'checkbox',checked:!!state?.autoStart,disabled:busy||!state,onChange:e=>action({action:'configure',autoStart:e.target.checked})}),t('auto')),
              h('small',null,t('autoHint')),
              state&&h('div',{className:'dsh-mh-notice'},state.proxyServerDns==='subscription'?t('dnsWarn'):t('dnsSystem')),
              state?.tlsVerificationDisabled>0&&h('div',{className:'dsh-mh-notice',style:{color:'var(--dsw-alias-state-warn-primary)'}},t('tlsWarn').replace('{n}',String(state.tlsVerificationDisabled)))),
            h('div',{className:'dsh-mh-card'},
              h('h3',null,t('timeZoneTitle')),
              h('p',null,h('strong',null,`${t('timeZoneCurrent')}: `),activeTimeZoneLabel),
              h('small',null,t('timeZoneHint')),
              h('div',{className:'dsh-mh-zone-grid',role:'group','aria-label':t('timeZoneTitle')},timeZones.map(entry=>
                h('button',{key:entry.zone||'auto',type:'button','data-zone':entry.zone,'aria-pressed':activeTimeZone===entry.zone,disabled:busy,
                  className:'dsh-mh-zone'+(activeTimeZone===entry.zone?' dsh-mh-zone-active':''),onClick:()=>action({action:'configure',timeZone:entry.zone})},
                  h('span',{className:'dsh-mh-zone-name'},t(entry.label)),
                  h('span',{className:'dsh-mh-zone-id'},entry.zone||t('timeZoneDefault'))))),
              h('details',{className:'dsh-mh-timezone-advanced'},
                h('summary',null,t('timeZoneAdvanced')),
                h('label',{htmlFor:'dsh-mh-timezone'},t('timeZoneLabel')),
                h('input',{id:'dsh-mh-timezone',type:'text',autoComplete:'off',spellCheck:false,value:timeZone,disabled:busy,placeholder:'Asia/Tokyo',onChange:e=>setTimeZone(e.target.value)}),
                h('div',{className:'dsh-mh-actions'},
                  h('button',{type:'button',className:timeZone.trim()!==activeTimeZone?'dsh-mh-primary':undefined,disabled:busy||!timeZone.trim()||timeZone.trim()===activeTimeZone,onClick:()=>action({action:'configure',timeZone:timeZone.trim()})},t('timeZoneSave'))))),
            h('div',{className:'dsh-mh-card'},h('h3',null,t('selected')),
              !state?.nodeCount?h('p',null,t('empty')):h(React.Fragment,null,
                h('div',{className:'dsh-mh-picker',ref:pickerRef},
                  h('button',{type:'button',className:'dsh-mh-trigger',disabled:busy,'aria-haspopup':'listbox','aria-expanded':open,onClick:togglePicker},
                    h('span',{className:'dsh-mh-trigger-name'},selected||t('empty')),
                    latencyBadge(selected),
                    h('span',{className:'dsh-mh-caret','aria-hidden':'true'},'▾')),
                  // Inside the picker element on purpose: the outside-click listener must see
                  // an option click as inside, or the list closes before the click lands.
                  open&&h('ul',{className:'dsh-mh-list',role:'listbox','aria-label':t('selected'),tabIndex:-1,ref:listRef,onKeyDown:onListKey},
                    state.nodes.map((n,i)=>h('li',{key:n.name,role:'option','aria-selected':n.name===selected,
                      className:'dsh-mh-option'+(n.name===selected?' dsh-mh-option-active':'')+(i===highlight?' dsh-mh-option-highlight':''),
                      onMouseEnter:()=>setHighlight(i),onClick:()=>{setSelected(n.name);setOpen(false);}},
                      h('span',{className:'dsh-mh-option-name'},n.name),
                      h('span',{className:'dsh-mh-option-meta'},n.type),
                      latencyBadge(n.name))))),
                h('div',{className:'dsh-mh-actions'},
                  h('button',{type:'button',className:selected!==state.selected?'dsh-mh-primary':undefined,disabled:busy||selected===state.selected,onClick:()=>action({action:'select',node:selected})},t('switch')),
                  h('button',{type:'button',disabled:busy||testing||!state.running,onClick:runLatency},t(testing?'latencyTesting':'latencyTest'))),
                !state.running&&h('small',null,t('latencyHint')),
                testing&&h('div',{className:'dsh-mh-notice',role:'status'},t('latencyWait')))),
            h('div',{className:'dsh-mh-card'},h('h3',null,t('source')),
              h('label',{htmlFor:'dsh-mh-url'},t('url')),
              h('input',{id:'dsh-mh-url',type:'password',autoComplete:'off',value:url,disabled:busy,placeholder:state?.subscriptionConfigured?t('urlHint'):t('urlPlaceholder'),onChange:e=>setUrl(e.target.value)}),
              h('label',{htmlFor:'dsh-mh-yaml'},t('yaml')),
              h('textarea',{id:'dsh-mh-yaml',autoComplete:'off',spellCheck:false,value:yaml,disabled:busy||isOn,placeholder:t('yamlPlaceholder'),onChange:e=>setYaml(e.target.value)}),
              h('small',null,t('importHint')),
              h('div',{className:'dsh-mh-actions'},button('import',{action:'import',...(url.trim()?{url:url.trim()}:{yaml})},(!url.trim()&&!yaml.trim())||(!!url.trim()&&!!yaml.trim())||(isOn&&!url.trim()),true),button('refresh',{action:'refresh'},!state?.subscriptionConfigured)),
              h('label',{className:'dsh-mh-check'},h('input',{type:'checkbox',checked:insecureSub,disabled:busy||!state,onChange:e=>action({action:'configure',insecureSubscriptionTls:e.target.checked})}),t('insecureTitle')),
              h('small',null,t('insecureHint')),
              insecureSub&&h('div',{className:'dsh-mh-notice dsh-mh-warn',role:'status'},t('insecureOn'))),
            // Quota and automatic refresh live together: both exist only because a subscription URL
            // was saved, and a provider that publishes no `subscription-userinfo` must say so rather
            // than show a zero that looks like an exhausted plan.
            h('div',{className:'dsh-mh-card'},h('h3',null,t('usageTitle')),
              !state?.subscriptionConfigured
                ? h('p',null,t('usageNoSubscription'))
                : !usage
                  ? state?.importInfo
                    ? h(React.Fragment,null,
                        h('p',null,t('usageImportFallback')),
                        state.importInfo.remaining&&h('p',null,h('strong',null,`${t('usageRemaining')}: `),h('span',{className:'dsh-mh-usage-num'},state.importInfo.remaining)),
                        state.importInfo.expireOn&&h('p',null,h('strong',null,`${t('usageExpire')}: `),state.importInfo.expireOn),
                        state.importInfo.at&&h('small',null,t('usageSnapshotAt').replace('{t}',new Date(state.importInfo.at).toLocaleString())))
                    : h('p',null,t('usageUnknown'))
                  : h(React.Fragment,null,
                      h('div',{className:'dsh-mh-usage-bar',role:'progressbar','aria-label':t('usageTitle'),'aria-valuemin':0,'aria-valuemax':100,...(typeof usage.percentUsed==='number'?{'aria-valuenow':usage.percentUsed}:{})},
                        h('div',{className:'dsh-mh-usage-fill'+(usage.percentUsed>=90?' dsh-mh-usage-high':''),style:{width:`${usage.percentUsed??0}%`}})),
                      h('p',null,h('strong',null,`${t('usageUsed')}: `),h('span',{className:'dsh-mh-usage-num'},bytes(usage.used)),usage.total===null?` · ${t('usageUnlimited')}`:` / ${bytes(usage.total)}${typeof usage.percentUsed==='number'?` · ${t('usagePercent').replace('{n}',String(usage.percentUsed))}`:''}`),
                      usage.total!==null&&h('p',null,h('strong',null,`${t('usageRemaining')}: `),h('span',{className:'dsh-mh-usage-num'},bytes(usage.remaining))),
                      h('p',null,h('strong',null,`${t('usageExpire')}: `),usage.expiresAt?`${new Date(usage.expiresAt).toLocaleDateString()} · ${usage.expired?t('usageExpired'):t('usageDaysLeft').replace('{n}',String(usage.daysLeft))}`:t('usageNoExpire')),
                      h('p',null,h('strong',null,`${t('usageReadAt')}: `),usage.readAt?new Date(usage.readAt).toLocaleString():t('never')),
                      h('small',null,t('usageStale'))),
              h('div',{className:'dsh-mh-actions'},button('usageCheck',{action:'usage'},!state?.subscriptionConfigured)),
              h('h3',{style:{marginTop:20}},t('autoRefreshTitle')),
              h('div',{className:'dsh-mh-zone-grid',role:'group','aria-label':t('autoRefreshTitle')},refreshOptions.map(hours=>
                h('button',{key:hours,type:'button','data-hours':hours,'aria-pressed':refreshHours===hours,disabled:busy||!state?.subscriptionConfigured,
                  className:'dsh-mh-zone'+(refreshHours===hours?' dsh-mh-zone-active':''),
                  onClick:()=>action({action:'configure',autoRefreshHours:hours})},
                  h('span',{className:'dsh-mh-zone-name'},hours?t('autoRefreshEvery').replace('{n}',String(hours)):t('autoRefreshOff')),
                  h('span',{className:'dsh-mh-zone-id'},hours?t('autoRefreshHint'):t('autoRefreshOffHint'))))),
              refreshHours>0&&state?.nextRefreshAt&&h('small',null,t('autoRefreshNext').replace('{t}',new Date(state.nextRefreshAt).toLocaleString())),
              state?.lastRefreshError&&h('div',{className:'dsh-mh-notice',role:'alert'},h('strong',null,t('autoRefreshFailed')),' ',state.lastRefreshError),
              h('small',null,t('autoRefreshNote'))),
            h('div',{className:'dsh-mh-card'},h('h3',null,t('trafficTitle')),
              !isOn?h('p',null,t('trafficNeedStart'))
              :liveError?h('div',{className:'dsh-mh-notice',role:'alert'},liveError)
              :!live?h('p',null,t('trafficNoData'))
              :h('div',null,
                h('p',{className:'dsh-mh-usage-num'},h('strong',null,`↓ ${bytes(live.down)}`),'　',h('strong',null,`↑ ${bytes(live.up)}`)),
                h('p',null,`${t('trafficRate')}: ${typeof live.rate==='number'?bytes(live.rate)+'/s':'—'}`),
                h('p',null,`${t('trafficActive')}: ${live.active}`),
                (live.connections??[]).length
                  ? h('ul',{className:'dsh-mh-live'},(live.connections??[]).slice(0,6).map((item,index)=>h('li',{key:index},
                      h('span',{className:'dsh-mh-live-host'},item.host||t('missing')),
                      h('span',{className:'dsh-mh-live-chain'},item.chain.length?item.chain.join(' › '):(item.rule||'')),
                      h('span',{className:'dsh-mh-usage-num'},bytes(item.download+item.upload)))))
                  : h('p',null,t('trafficIdle')),
                h('small',null,t('trafficNote')))),
            busy&&h('div',{className:'dsh-mh-notice',role:'status'},t('busy')),
            notice&&h('div',{className:'dsh-mh-notice',role:'status'},notice),
            (error||state?.error)&&h('div',{className:'dsh-mh-notice',role:'alert'},error||state.error),
            h('p',{style:{marginTop:20}},t('safety')),h('small',null,t('license')),
            h('div',{className:'dsh-mh-actions'},h('a',{href:'https://github.com/MetaCubeX/mihomo/tree/v1.19.32',target:'_blank',rel:'noreferrer'},t('sourceLink')),h('a',{href:'https://github.com/clash-verge-rev/clash-verge-rev',target:'_blank',rel:'noreferrer'},t('reference'))));
        }
        ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'dsh-mihomo',order:65,label:()=>t('title')},Panel));
      },
    };
  },
});
