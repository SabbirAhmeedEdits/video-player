# Video Player Remote — Cloudflare Worker

Realtime relay for the video player. The player keeps a WebSocket open
to this Worker; the remote page sends a push command and the Worker
broadcasts it to every connected player, on any device.

It uses a **Durable Object** (`RemoteRoom`, one per room code) so the
WebSocket connections stay live. A plain Worker alone cannot hold them.

## 1. Deploy (one time, in Cloudflare)

You need a Cloudflare account (the same one your portfolio site uses
is fine) and Node.js on your computer.

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

Copy the URL it prints, for example:

```
https://video-player-remote.sabbirahmeed.workers.dev
```

## 2. Set a PIN (recommended)

```bash
npx wrangler secret put REMOTE_PIN
```

Type a PIN when asked. The remote page must send the same PIN.
If you skip this, anyone who knows the Worker URL + room code
could push ads to your players.

## 3. Point the pages at the Worker

In `index.html` (player) and `remote.html` (remote), set:

```js
const REMOTE_WORKER_URL = 'https://video-player-remote.sabbirahmeed.workers.dev';
```

Or leave it empty in the pages and paste the URL into the remote
page's **Worker URL** box instead — the remote saves it in that
browser, and the player page reads `?worker=<url>` if you open it
with that parameter, e.g. `index.html?worker=https://…`.

Both pages must also use the **same room code** (default `main`).
Change it to something less guessable if you want, e.g. `sabbir-7`.

## 4. Test

1. Open the player page on the screen that shows the movie.
2. Open `remote.html` on your phone / other device.
3. In the remote, set Worker URL + room + PIN, tap **Connect**.
   It should say **Connected**.
4. Tap a floating ad, e.g. **Reddit GIF**, then **Push ad now**.
   The ad should slide in on the player within about a second.
5. **Hide ad** closes it on the player.

## Notes

- Automatic ads are unchanged: they still run at 15 / 60 / 120 s.
  A remote push only adds one extra floating ad at that moment.
- The remote can push by ad number (1–3 in `FLOATING_ADS_LIBRARY`)
  or by a custom image/video URL. GIF, JPG, PNG and WebP are shown
  as images; MP4 / WebM are shown as video.
- If the Worker URL is empty, the pages fall back to talking
  directly between tabs on the **same browser** only — that is
  for local testing, it will not work across devices.
- Free tier: Workers + Durable Objects have a free allowance.
  This relay is tiny (one small message per push), so normal use
  should stay inside it. Check your Cloudflare dashboard for
  current limits.
