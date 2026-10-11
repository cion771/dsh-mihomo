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
        importHint:'导入/更新前需停止代理。为让服务商的节点可用，节点自带的 TLS 与 DNS 选项会被保留（风险见下方提示）。支持含内联 proxies 的 YAML；不支持 provider-only、Base64 或 URI 列表。地址及节点凭据存储于本地，不回显、不写入会话。',
        auto:'随插件加载自动启动', autoHint:'默认关闭；启用后使用已安装内核及已保存节点。停止代理不会更改此偏好。',
        switch:'应用节点', state:'状态', active:'主进程代理已接管', inactive:'未接管主进程网络',
        license:'内核下载自官方固定版本 v1.19.32，校验 GitHub SHA256；该版本为 GPLv3。', sourceLink:'Mihomo 源码与许可', reference:'参考 Clash Verge Rev',
        busy:'正在执行，请稍候…', success:'操作完成', latency:'连通性通过，耗时', ms:'毫秒', error:'操作未完成', updated:'最近导入', never:'尚未导入',
        phaseStopped:'已停止', phaseRunning:'运行中', phaseStarting:'启动中', phaseInstalling:'内核安装中', phaseImporting:'节点导入中', phaseError:'异常',
        tlsWarn:'TLS 提示：{n} 个节点要求跳过证书校验（服务商订阅自带）。经这些节点转发时，到节点的 TLS 无法验证，链路上的第三方可观察元数据。',
        dnsWarn:'这些节点的域名是私有地址，只能由订阅自带的加密 DNS 解析，因此该 DNS 配置被保留，服务商可观察节点解析。TUN、监听端口、规则与脚本仍被丢弃。',
        dnsSystem:'节点域名使用系统 DNS 解析。',
        latencyTest:'检测延迟', latencyTesting:'检测中…', latencyDone:'延迟检测完成', latencyWait:'正在逐个测试节点，请稍候…',
        latencyHint:'检测延迟需要先启动代理；结果为节点到测速地址的往返延迟。', unreachable:'不通',
      },
      en: {
        title:'DSH-only Proxy',intro:'Mihomo core · Main process only · No system network changes',
        scope:'Affects all DSH sessions in this Host. Proxies main-process global fetch (e.g. model/API requests) only. System proxy, TUN, browsers, external commands, workers, telemetry and the independently pinned web_fetch transport are not controlled by this plugin.',
        safety:'Only nodes are imported, plus the DNS settings required to resolve the node addresses. TUN, listeners, rules, scripts and external-ui are still discarded. Start verifies connectivity first and rolls back automatically when the proxy cannot carry traffic, so DSH is never left offline. If the running core exits, public fetch stays blocked until Stop restores the previous policy.',
        installing:'Download and verify core',import:'Import nodes',start:'Start DSH proxy',stop:'Stop and restore previous policy',test:'Test DSH connectivity',refresh:'Refresh subscription',reload:'Refresh status',
        core:'Core',missing:'Not installed',nodes:'Nodes',selected:'Selected node',empty:'Import a Clash/Mihomo subscription or configuration first',source:'Subscription & configuration',
        url:'Subscription URL (HTTPS)',urlHint:'A subscription is saved; leave blank to keep it',urlPlaceholder:'https://… (Clash / Mihomo format)',
        yaml:'Or paste Clash/Mihomo YAML',yamlPlaceholder:'proxies:\n  - name: …\n    type: …\n    server: …\n    port: …',
        importHint:'Stop before importing or refreshing. The subscription\'s own TLS and DNS options are kept so its nodes stay usable (risks are shown below). Inline-proxies YAML is supported; provider-only, Base64 and URI lists are not. URLs and credentials stay in local storage, without echoing or session logging.',
        auto:'Auto-start when plugin loads',autoHint:'Off by default. Uses the installed core and saved nodes. Stop does not change this preference.',switch:'Apply node',state:'Status',active:'Main-process proxy is active',inactive:'Main-process proxy is not active',
        license:'Official pinned v1.19.32 core download, verified with GitHub SHA256; this release is GPLv3.',sourceLink:'Mihomo source & license',reference:'Clash Verge Rev reference',
        busy:'Working, please wait…',success:'Operation completed',latency:'Connectivity passed in',ms:'ms',error:'Operation failed',updated:'Last import',never:'Not imported yet',
        phaseStopped:'Stopped',phaseRunning:'Running',phaseStarting:'Starting',phaseInstalling:'Installing core',phaseImporting:'Importing nodes',phaseError:'Error',
        tlsWarn:'TLS notice: {n} node(s) require skipping certificate verification, as the provider supplies it. Traffic through them is not authenticated at the proxy hop, so a third party on that path can observe metadata.',
        dnsWarn:'These node hostnames are private names resolvable only by the subscription own encrypted DNS, so that DNS configuration is kept and the provider can observe node resolution. TUN, listeners, rules and scripts are still discarded.',
        dnsSystem:'Node hostnames are resolved with the system DNS.',
        latencyTest:'Measure latency', latencyTesting:'Measuring…', latencyDone:'Latency measured', latencyWait:'Testing every node, please wait…',
        latencyHint:'Latency measurement needs the proxy running; each value is the node round trip to the test target.', unreachable:'failed',
      },
    };
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
          const [busy,setBusy] = React.useState(false);
          const [notice,setNotice] = React.useState('');
          const [error,setError] = React.useState('');
          const [open,setOpen] = React.useState(false);
          const [highlight,setHighlight] = React.useState(0);
          const [latencies,setLatencies] = React.useState({});
          const [testing,setTesting] = React.useState(false);
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
          const receive = result => { const value = result.state || result; setState(value); setSelected(value.selected || ''); };
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
          const phaseKey = {stopped:'phaseStopped',running:'phaseRunning',starting:'phaseStarting',installing:'phaseInstalling',importing:'phaseImporting',error:'phaseError'}[state?.phase] || 'phaseStopped';
          return h('section',{className:'dsh-mh','aria-label':t('title')},
            h('style',null,css),
            // The node list is drawn by this plugin: a native option popup cannot be
            // themed reliably, and its highlight made the selected node unreadable.
            h('style',null,'.dsh-mh-picker{position:relative}.dsh-mh-trigger{width:100%;display:flex;align-items:center;gap:10px;text-align:left}.dsh-mh-trigger-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-mh-caret{color:var(--dsw-alias-label-secondary)}.dsh-mh-list{margin:8px 0 0;padding:4px;list-style:none;max-height:280px;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.dsh-mh-list:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dsh-mh-option{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;cursor:pointer;border-left:3px solid transparent}.dsh-mh-option-highlight{background:var(--dsw-alias-bg-layer-2)}.dsh-mh-option-active{border-left-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600}.dsh-mh-option-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-mh-option-meta{color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-mh-lat{font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:56px;text-align:right}.dsh-mh-lat-good{color:var(--dsw-alias-state-success-primary)}.dsh-mh-lat-slow{color:var(--dsw-alias-state-warn-primary)}.dsh-mh-lat-bad{color:var(--dsw-alias-state-error-primary)}.dsh-mh button:disabled{opacity:.55}'),
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
              h('input',{id:'dsh-mh-url',type:'password',autoComplete:'off',value:url,disabled:busy||isOn,placeholder:state?.subscriptionConfigured?t('urlHint'):t('urlPlaceholder'),onChange:e=>setUrl(e.target.value)}),
              h('label',{htmlFor:'dsh-mh-yaml'},t('yaml')),
              h('textarea',{id:'dsh-mh-yaml',autoComplete:'off',spellCheck:false,value:yaml,disabled:busy||isOn,placeholder:t('yamlPlaceholder'),onChange:e=>setYaml(e.target.value)}),
              h('small',null,t('importHint')),
              h('div',{className:'dsh-mh-actions'},button('import',{action:'import',...(url.trim()?{url:url.trim()}:{yaml})},isOn||(!url.trim()&&!yaml.trim())||(!!url.trim()&&!!yaml.trim()),true),button('refresh',{action:'refresh'},isOn||!state?.subscriptionConfigured))),
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
