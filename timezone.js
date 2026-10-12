/** An explicit model-context preference, never a change to the system or browser clock. */
export function normalizeTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid IANA time zone.');
  const zone = value.trim();
  if (!zone) return null;
  // Reject fixed offset strings: an IANA region is needed for daylight-saving rules.
  if (!/^[A-Za-z0-9_+\-/]+$/.test(zone) || /^[+-]/.test(zone)) throw new Error('Invalid IANA time zone.');
  try { return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone; }
  catch { throw new Error('Invalid IANA time zone. Use UTC or a region such as Asia/Tokyo.'); }
}

export function zonedTimestamp(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23', timeZoneName:'longOffset',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(part => [part.type,part.value]));
  const offset = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.slice(3);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}[${timeZone}]`;
}

/** Returns a waterfall handler. Every step records the current preference, including reset,
 * so a previous enabled snapshot cannot remain effective after disabling or reloading. */
export function timeZoneHook(readZone, createMessage, clock = () => new Date()) {
  return async ({turn,step,signal}, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || signal?.aborted) return decision;
    const zone = readZone();
    const text = zone
      ? `User-configured DSH time-zone override for turn ${turn}, step ${step}: ${zone}.\nCurrent real instant in the selected zone: ${zonedTimestamp(clock(),zone)}\nFor otherwise-unqualified dates and times, use this selected zone instead of the browser-zone interpretation in built-in time-context snapshots. Explicit user-specified zones still take precedence. This preference affects model interpretation only; system/browser clocks, elapsed time and existing reminder schedules are unchanged.`
      : `DSH time-zone preference for turn ${turn}, step ${step}: no plugin override is active. Disregard prior plugin time-zone overrides and use the current built-in/browser time context for otherwise-unqualified dates and times. Explicit user-specified zones still take precedence.`;
    return {...decision, messages:[...decision.messages,createMessage({
      content:[{type:'text',text}],
      source:{kind:'dsh-mihomo-timezone',form:'snapshot',sections:[{name:'time-zone-preference',text}]},
    })]};
  };
}
