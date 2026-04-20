// Terminal UI for agora-seed — plain ANSI, no deps.
// Three panels: header stats, recent files served, recent new authors.

const ESC = '\x1b[';
const CLEAR = `${ESC}2J${ESC}H`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const ORANGE = `${ESC}38;5;208m`;
const GREEN = `${ESC}38;5;40m`;
const CYAN = `${ESC}38;5;45m`;
const GREY = `${ESC}38;5;244m`;

const MAX_ROWS = 10;

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function fmtDuration(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`;
}

function fmtAge(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 1) return 'now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function short(s, n = 10) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) : s;
}

export function startTUI({ store, node, dhtPublisher, startTime, port, dataDir, budgetMB, mode }) {
  const served = []; // {peerId, author, count, bytes, at}
  const authors = []; // {author, firstObject, at}
  let bytesInWindow = 0;
  let bytesOutWindow = 0;
  let lastBytesSampleAt = Date.now();
  let bpsIn = 0;
  let bpsOut = 0;

  let prevReceived = node.received;
  // Approximate in-bytes by object size accumulation.
  const approxInBytes = { total: 0 };

  node.on('served', (ev) => {
    served.unshift(ev);
    if (served.length > MAX_ROWS) served.pop();
    bytesOutWindow += ev.bytes;
    render();
  });

  node.on('peer', () => render());

  store.on('new-author', (ev) => {
    authors.unshift({ ...ev, at: Date.now() });
    if (authors.length > MAX_ROWS) authors.pop();
    render();
  });

  store.on('new-object', (obj) => {
    // rough inbound byte accounting — size of JSON
    const b = Buffer.byteLength(JSON.stringify(obj), 'utf8');
    approxInBytes.total += b;
    bytesInWindow += b;
  });

  // bandwidth sampler — once a second
  function sampleBw() {
    const now = Date.now();
    const dt = (now - lastBytesSampleAt) / 1000;
    if (dt > 0) {
      bpsIn = bytesInWindow / dt;
      bpsOut = bytesOutWindow / dt;
    }
    bytesInWindow = 0;
    bytesOutWindow = 0;
    lastBytesSampleAt = now;
  }

  function render() {
    const stats = node.getStats();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const storageMB = (store.getStorageSize() / 1024 / 1024).toFixed(1);
    const dht = dhtPublisher ? dhtPublisher.getStats() : null;
    const neigh = store.getNeighborhoodStats();

    const lines = [];
    lines.push(`${BOLD}agora${ORANGE}.${RESET}${BOLD} seed${RESET}  ${GREY}${mode}  ·  ${fmtDuration(uptime)} uptime  ·  :${port}${RESET}`);
    lines.push('');

    // Row 1: network
    lines.push(
      `${GREY}peers${RESET}   ${ORANGE}${String(stats.peers).padStart(4)}${RESET}   ` +
      `${GREY}swarms${RESET}  ${ORANGE}${String(stats.swarms).padStart(4)}${RESET}   ` +
      `${GREY}DHT${RESET}     ${ORANGE}${String(dht?.dhtNodes ?? '-').padStart(4)}${RESET}   ` +
      `${GREY}nbhd${RESET}    ${ORANGE}${neigh.prefix.padStart(4)}${RESET}`
    );
    // Row 2: content
    lines.push(
      `${GREY}objects${RESET} ${CYAN}${String(stats.received + store.count()).padStart(4)}${RESET}   ` +
      `${GREY}served${RESET}  ${CYAN}${String(stats.served).padStart(4)}${RESET}   ` +
      `${GREY}authors${RESET} ${CYAN}${String(store.getAuthorCount()).padStart(4)}${RESET}   ` +
      `${GREY}disk${RESET}    ${CYAN}${String(storageMB + 'MB').padStart(7)}${RESET}  ${DIM}/ ${budgetMB}MB${RESET}`
    );
    // Row 3: bandwidth
    lines.push(
      `${GREY}↓ in${RESET}    ${GREEN}${fmtBytes(bpsIn).padStart(7)}/s${RESET}   ` +
      `${GREY}↑ out${RESET}   ${GREEN}${fmtBytes(bpsOut).padStart(7)}/s${RESET}`
    );
    lines.push('');

    // Files served
    lines.push(`${BOLD}${ORANGE}files served${RESET}  ${GREY}(last ${MAX_ROWS})${RESET}`);
    if (served.length === 0) {
      lines.push(`  ${DIM}waiting for peer requests…${RESET}`);
    } else {
      for (const ev of served) {
        lines.push(
          `  ${GREY}${fmtAge(ev.at).padStart(7)}${RESET}  ` +
          `${CYAN}${short(ev.ids[0], 10)}${RESET}${ev.count > 1 ? `${DIM}+${ev.count - 1}${RESET}` : '  '}  ` +
          `${DIM}→${RESET} ${short(ev.peerId, 8)}  ` +
          `${GREEN}${fmtBytes(ev.bytes).padStart(7)}${RESET}  ` +
          `${DIM}author ${short(ev.author, 10)}${RESET}`
        );
      }
    }
    lines.push('');

    // New authors (accounts)
    lines.push(`${BOLD}${ORANGE}new accounts seen${RESET}  ${GREY}(last ${MAX_ROWS})${RESET}`);
    if (authors.length === 0) {
      lines.push(`  ${DIM}no new accounts yet…${RESET}`);
    } else {
      for (const ev of authors) {
        const type = ev.firstObject?.body?.type || '?';
        lines.push(
          `  ${GREY}${fmtAge(ev.at).padStart(7)}${RESET}  ` +
          `${CYAN}${short(ev.author, 16)}${RESET}  ` +
          `${DIM}via ${type}${RESET}`
        );
      }
    }
    lines.push('');
    lines.push(`${DIM}dashboard http://localhost:${port}   ·   data ${dataDir}   ·   ctrl+c to stop${RESET}`);

    process.stdout.write(CLEAR + HIDE_CURSOR + lines.join('\n') + '\n');
  }

  // tick: sample bandwidth + redraw clock
  const tickTimer = setInterval(() => {
    sampleBw();
    render();
  }, 1000);

  render();

  function stop() {
    clearInterval(tickTimer);
    process.stdout.write(SHOW_CURSOR + RESET + '\n');
  }

  return { stop, render };
}
