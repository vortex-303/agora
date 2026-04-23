// Terminal UI for agora-seed — Ink-based fixed-panel dashboard.
// Six panels refresh in place on a 1s tick. No scrolling feed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import React, { useEffect, useMemo, useState } from 'react';
import { render, Box, Text, useApp } from 'ink';
import htm from 'htm';

const html = htm.bind(React.createElement);

const __dirname = dirname(fileURLToPath(import.meta.url));
let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
} catch {}

const SPARK_WIDTH = 40;
const BARS = ' ▁▂▃▄▅▆▇█';
const TOP_AUTHORS = 6;

function fmtBytes(n) {
  if (n < 1024) return `${Math.round(n)}B`;
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

function fmtNum(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function short(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) : s;
}

function peerFingerprint(peerId) {
  const buf = Buffer.from(peerId ?? '', 'binary');
  return createHash('sha1').update(buf).digest('hex').slice(0, 8);
}

function sparkline(ring, width) {
  if (!ring.length) return ' '.repeat(width);
  const recent = ring.slice(-width);
  const pad = width - recent.length;
  const max = Math.max(1, ...recent);
  const bars = recent
    .map((v) => {
      if (!v) return BARS[0];
      const lvl = Math.max(1, Math.min(8, Math.round((v / max) * 8)));
      return BARS[lvl];
    })
    .join('');
  return ' '.repeat(pad) + bars;
}

function Panel({ title, children, width, grow }) {
  return html`
    <${Box}
      borderStyle="round"
      borderColor="gray"
      flexDirection="column"
      paddingX=${1}
      width=${width}
      flexGrow=${grow ?? 0}
    >
      <${Box} marginBottom=${1}>
        <${Text} color="yellow" bold>${title}</${Text}>
      </${Box}>
      ${children}
    </${Box}>
  `;
}

function Row({ label, value, color }) {
  return html`
    <${Box} justifyContent="space-between">
      <${Text} color="gray">${label}</${Text}>
      <${Text} color=${color ?? 'white'} bold>${value}</${Text}>
    </${Box}>
  `;
}

export function Dashboard({ snapshot, identity, topAuthors }) {
  const { stats, storageMB, budgetMB, uptimeS, neigh, dht, bpsIn, bpsOut, servesPerSec, inRing, outRing, servesRing } = snapshot;
  const { version, mode, fp, port, dataDir, trackers } = identity;

  return html`
    <${Box} flexDirection="column">
      <${Box} flexDirection="row" paddingX=${1} paddingTop=${1}>
        <${Text} bold>agora${' '}</${Text}>
        <${Text} color="yellow" bold>.seed${' '}</${Text}>
        <${Text} dimColor>v${version}  ·  ${mode}  ·  ${fmtDuration(uptimeS)} uptime  ·  node </${Text}>
        <${Text} color="yellow">${fp}</${Text}>
        <${Text} dimColor>  ·  :${port}</${Text}>
      </${Box}>

      <${Box} flexDirection="row">
        <${Panel} title="node" width=${42}>
          <${Row} label="mode"    value=${mode}/>
          <${Row} label="data"    value=${short(dataDir, 30)} color="cyan"/>
          <${Row} label="tracker" value=${trackers.length ? `${trackers.length} url${trackers.length === 1 ? '' : 's'}` : '-'}/>
          <${Row} label="port"    value=${`:${port}`}/>
        </${Panel}>

        <${Panel} title="throughput (60s)" grow=${1}>
          <${Box} flexDirection="row" justifyContent="space-between">
            <${Box} flexDirection="row">
              <${Text} color="gray">↓ in   </${Text}>
              <${Text} color="green">${sparkline(inRing, SPARK_WIDTH)}</${Text}>
            </${Box}>
            <${Text} color="green" bold>${fmtBytes(bpsIn)}/s</${Text}>
          </${Box}>
          <${Box} flexDirection="row" justifyContent="space-between">
            <${Box} flexDirection="row">
              <${Text} color="gray">↑ out  </${Text}>
              <${Text} color="green">${sparkline(outRing, SPARK_WIDTH)}</${Text}>
            </${Box}>
            <${Text} color="green" bold>${fmtBytes(bpsOut)}/s</${Text}>
          </${Box}>
          <${Box} flexDirection="row" justifyContent="space-between">
            <${Box} flexDirection="row">
              <${Text} color="gray">∙ serve</${Text}>
              <${Text} color="cyan">${sparkline(servesRing, SPARK_WIDTH)}</${Text}>
            </${Box}>
            <${Text} color="cyan" bold>${servesPerSec.toFixed(1)}/s</${Text}>
          </${Box}>
        </${Panel}>
      </${Box}>

      <${Box} flexDirection="row">
        <${Panel} title="network" width=${42}>
          <${Row} label="peers"   value=${fmtNum(stats.peers)}   color="yellow"/>
          <${Row} label="swarms"  value=${fmtNum(stats.swarms)}  color="yellow"/>
          <${Row} label="objects" value=${fmtNum(stats.objects)} color="cyan"/>
          <${Row} label="authors" value=${fmtNum(stats.authors)} color="cyan"/>
          <${Row} label="served"  value=${fmtNum(stats.served)}  color="green"/>
          <${Row} label="received" value=${fmtNum(stats.received)} color="green"/>
        </${Panel}>

        <${Panel} title="neighborhood" grow=${1}>
          <${Row} label="prefix"  value=${neigh.prefix || '-'} color="yellow"/>
          <${Row} label="in nbhd" value=${fmtNum(neigh.inNeighborhood ?? 0)} color="cyan"/>
          <${Row} label="outside" value=${fmtNum(neigh.outside ?? 0)}/>
          <${Row} label="disk"    value=${`${storageMB}MB / ${budgetMB}MB`} color="cyan"/>
          <${Row} label="DHT"     value=${`${dht?.dhtNodes ?? '-'} nodes`} color="yellow"/>
        </${Panel}>
      </${Box}>

      <${Panel} title=${`top authors served (top ${TOP_AUTHORS})`}>
        ${topAuthors.length === 0
          ? html`<${Text} dimColor>waiting for serve events…</${Text}>`
          : topAuthors.map((a) => {
              const barW = Math.max(1, Math.round((a.count / topAuthors[0].count) * 30));
              return html`
                <${Box} key=${a.author} flexDirection="row" justifyContent="space-between">
                  <${Box} flexDirection="row">
                    <${Text} color="cyan">${short(a.author, 18).padEnd(20)}</${Text}>
                    <${Text} color="green">${'█'.repeat(barW)}</${Text}>
                  </${Box}>
                  <${Text} color="gray">${fmtNum(a.count)} obj · ${fmtBytes(a.bytes)}</${Text}>
                </${Box}>
              `;
            })}
      </${Panel}>

      <${Box} paddingX=${1}>
        <${Text} dimColor>dashboard http://localhost:${port}   ·   ctrl+c to stop</${Text}>
      </${Box}>
    </${Box}>
  `;
}

export function startTUI({ store, node, dhtPublisher, startTime, port, dataDir, budgetMB, mode, trackers = [] }) {
  // Mutable state owned outside React; snapshot is pushed into state each tick.
  const inRing = [];
  const outRing = [];
  const servesRing = [];
  const authorAgg = new Map(); // author -> { count, bytes }
  let bytesInWindow = 0;
  let bytesOutWindow = 0;
  let servesInWindow = 0;
  let lastSampleAt = Date.now();
  let bpsIn = 0;
  let bpsOut = 0;
  let servesPerSec = 0;

  const onServed = (ev) => {
    bytesOutWindow += ev.bytes ?? 0;
    servesInWindow += ev.count ?? 1;
    const key = ev.author || 'unknown';
    const prev = authorAgg.get(key) ?? { count: 0, bytes: 0 };
    authorAgg.set(key, {
      count: prev.count + (ev.count ?? 1),
      bytes: prev.bytes + (ev.bytes ?? 0),
    });
  };
  const onNewObject = (obj) => {
    bytesInWindow += Buffer.byteLength(JSON.stringify(obj), 'utf8');
  };
  node.on('served', onServed);
  store.on('new-object', onNewObject);

  function sample() {
    const now = Date.now();
    const dt = (now - lastSampleAt) / 1000;
    if (dt > 0) {
      bpsIn = bytesInWindow / dt;
      bpsOut = bytesOutWindow / dt;
      servesPerSec = servesInWindow / dt;
    }
    inRing.push(bpsIn);
    outRing.push(bpsOut);
    servesRing.push(servesPerSec);
    if (inRing.length > SPARK_WIDTH) inRing.shift();
    if (outRing.length > SPARK_WIDTH) outRing.shift();
    if (servesRing.length > SPARK_WIDTH) servesRing.shift();
    bytesInWindow = 0;
    bytesOutWindow = 0;
    servesInWindow = 0;
    lastSampleAt = now;
  }

  function buildSnapshot() {
    const s = node.getStats();
    const neigh = store.getNeighborhoodStats();
    const dht = dhtPublisher ? dhtPublisher.getStats() : null;
    const uptimeS = Math.floor((Date.now() - startTime) / 1000);
    const storageMB = (store.getStorageSize() / 1024 / 1024).toFixed(1);
    return {
      stats: {
        peers: s.peers,
        swarms: s.swarms,
        served: s.served,
        received: s.received,
        objects: s.received + store.count(),
        authors: store.getAuthorCount(),
      },
      storageMB,
      budgetMB,
      uptimeS,
      neigh,
      dht,
      bpsIn,
      bpsOut,
      servesPerSec,
      inRing: inRing.slice(),
      outRing: outRing.slice(),
      servesRing: servesRing.slice(),
    };
  }

  function topAuthors() {
    return [...authorAgg.entries()]
      .map(([author, v]) => ({ author, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_AUTHORS);
  }

  const identity = {
    version: VERSION,
    mode,
    fp: peerFingerprint(node.peerId),
    port,
    dataDir,
    trackers,
  };

  function App() {
    const [snapshot, setSnapshot] = useState(buildSnapshot);
    const [authors, setAuthors] = useState(topAuthors);
    const { exit } = useApp();

    useEffect(() => {
      const id = setInterval(() => {
        sample();
        setSnapshot(buildSnapshot());
        setAuthors(topAuthors());
      }, 1000);
      return () => clearInterval(id);
    }, []);

    return html`<${Dashboard} snapshot=${snapshot} identity=${identity} topAuthors=${authors}/>`;
  }

  const instance = render(html`<${App}/>`);

  function stop() {
    node.off('served', onServed);
    store.off('new-object', onNewObject);
    instance.unmount();
  }

  return { stop, _sample: sample, _snapshot: buildSnapshot, _topAuthors: topAuthors };
}
