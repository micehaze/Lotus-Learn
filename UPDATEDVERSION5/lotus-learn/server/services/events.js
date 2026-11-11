// Tiny server-sent-events bus: open browser tabs are told when new content is published.
export function createEventBus() {
  const clients = new Set();
  let seq = 0;
  function subscribe(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 5000\nevent: hello\ndata: {"seq":${seq}}\n\n`);
    const c = { res };
    clients.add(c);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    ping.unref?.();
    req.on('close', () => { clearInterval(ping); clients.delete(c); });
  }
  function publish(type, data = {}) {
    seq++;
    const msg = `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ ...data, seq, at: new Date().toISOString() })}\n\n`;
    for (const c of clients) { try { c.res.write(msg); } catch { clients.delete(c); } }
    return seq;
  }
  function closeAll() { for (const c of clients) { try { c.res.end(); } catch { /* ignore */ } } clients.clear(); }
  return { subscribe, publish, closeAll, get size() { return clients.size; } };
}
