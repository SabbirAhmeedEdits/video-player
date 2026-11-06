// Video Player Remote — Cloudflare Worker + Durable Object
import { DurableObject } from "cloudflare:workers";
//
// How it works:
//   * The player (index.html) opens a WebSocket to /ws?room=ROOM
//   * The remote (remote.html) POSTs a command to /push, or sends it
//     over its own WebSocket. The Worker forwards it to the room's
//     Durable Object, which broadcasts it to every connected player.
//   * Commands: { type: 'show-floating-ad', url } |
//               { type: 'show-floating-ad', index } |
//               { type: 'hide-floating-ad' }
//   * Automatic ads in the player are untouched. A remote push only
//     shows one extra floating ad; it does not change the auto rotation.
//
// Deploy: see worker/README.md
//   npx wrangler deploy
//   npx wrangler secret put REMOTE_PIN   (optional, but recommended)

export class RemoteRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  // Players and remotes both connect here. `role` is 'player' or 'remote'.
  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const role = url.searchParams.get('role') || 'player';
      // Hibernation API: the object can sleep while sockets stay open.
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const command = await request.json().catch(() => null);
      if (!command || typeof command.type !== 'string') {
        return Response.json({ ok: false, error: 'bad command' }, { status: 400 });
      }
      const players = this.broadcast(command, null);
      return Response.json({ ok: true, players });
    }

    if (url.pathname === '/count') {
      return Response.json({ ok: true, players: this.playerCount() });
    }

    return new Response('Not found', { status: 404 });
  }

  playerCount() {
    return this.ctx.getWebSockets().filter((ws) => {
      try { return ws.deserializeAttachment()?.role === 'player'; } catch { return false; }
    }).length;
  }

  broadcast(command, exceptWs) {
    const text = JSON.stringify(command);
    let players = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (ws.deserializeAttachment()?.role !== 'player') continue;
        players++;
        if (ws !== exceptWs && ws.readyState === WebSocket.OPEN) ws.send(text);
      } catch { /* socket went away; getWebSockets() will drop it */ }
    }
    return players;
  }

  async webSocketMessage(ws, message) {
    let command;
    try { command = JSON.parse(message); } catch { return; }
    if (!command || typeof command.type !== 'string') return;

    // A remote connected over WebSocket can push directly.
    // Players never push, so ignore commands from them.
    try {
      if (ws.deserializeAttachment()?.role !== 'remote') return;
    } catch { return; }

    if (command.type === 'show-floating-ad' || command.type === 'hide-floating-ad') {
      this.broadcast(command, ws);
    }
  }

  async webSocketClose() { /* nothing to clean up: getWebSockets() tracks live sockets */ }
  async webSocketError() { /* same as close */ }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function roomStub(env, room) {
  const name = (room || 'main').toString().slice(0, 64) || 'main';
  const id = env.REMOTE_ROOM.idFromName(name);
  return env.REMOTE_ROOM.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === '/') {
      return Response.json(
        { ok: true, service: 'video-player-remote', endpoints: ['/ws', '/push', '/count'] },
        { headers: corsHeaders() },
      );
    }

    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room') || 'main';
      return roomStub(env, room).fetch(request);
    }

    if (url.pathname === '/count') {
      const room = url.searchParams.get('room') || 'main';
      return roomStub(env, room).fetch(new Request(request.url, { method: 'GET' }));
    }

    if (url.pathname === '/push' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.type !== 'string') {
        return Response.json({ ok: false, error: 'bad command' }, { status: 400, headers: corsHeaders() });
      }
      // If a PIN is set on the Worker, the remote must send the same one.
      // If no PIN is set, the room code is the only secret — set a PIN.
      if (env.REMOTE_PIN && body.pin !== env.REMOTE_PIN) {
        return Response.json({ ok: false, error: 'wrong pin' }, { status: 401, headers: corsHeaders() });
      }
      const room = body.room || 'main';
      const stub = roomStub(env, room);
      const res = await stub.fetch(new Request(url.origin + '/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: body.type, url: body.url, index: body.index, id: body.id }),
      }));
      const data = await res.json().catch(() => ({}));
      return Response.json(data, { status: res.status, headers: corsHeaders() });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },
};
