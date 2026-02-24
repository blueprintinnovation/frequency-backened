# FREQUENCY — Backend

Node.js backend for the Frequency app.
Handles Spotify token exchange and live news RSS proxy.

## Deploy to Railway

1. Push this folder to a GitHub repo called `frequency-backend`
2. In Railway: New Project → Deploy from GitHub → select `frequency-backend`
3. Add these environment variables in Railway (Settings → Variables):

```
SPOTIFY_CLIENT_ID=9b39cc3896304861ae0fff4373c19e7c
SPOTIFY_CLIENT_SECRET=your_new_secret_here
```

4. Railway will give you a URL like `https://frequency-backend-production.up.railway.app`
5. Copy that URL into the frontend's BACKEND_URL variable

## Endpoints

- `GET /` — health check
- `POST /auth/token` — exchange Spotify auth code for tokens
- `POST /auth/refresh` — refresh expired access token
- `GET /news/afl` — live AFL news
- `GET /news/world` — live world news
- `GET /news/tech` — live tech news
- `GET /news/good` — live good news
