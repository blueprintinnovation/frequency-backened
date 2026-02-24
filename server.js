const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — only allow your Netlify frontend
app.use(cors({
  origin: [
    'https://profound-bavarois-dec4a5.netlify.app',
    'http://localhost:8080',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST'],
}));

// ── ENV VARS (set these in Railway) ──────────────────────────
const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const FRONTEND_URL  = 'https://profound-bavarois-dec4a5.netlify.app';

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'FREQUENCY BACKEND ONLINE', version: '1.0.0' });
});

// ── SPOTIFY: EXCHANGE AUTH CODE FOR TOKENS ────────────────────
// Frontend sends the code from Spotify OAuth callback
app.post('/auth/token', async (req, res) => {
  const { code, redirect_uri, code_verifier } = req.body;

  if (!code || !redirect_uri || !code_verifier) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri,
        code_verifier,
      }),
    });

    const data = await response.json();
    if (data.error) {
      return res.status(400).json(data);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Token exchange failed', detail: err.message });
  }
});

// ── SPOTIFY: REFRESH ACCESS TOKEN ─────────────────────────────
app.post('/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: 'Missing refresh_token' });
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Refresh failed', detail: err.message });
  }
});

// ── NEWS PROXY ────────────────────────────────────────────────
// Fetches RSS feeds server-side, no CORS issues
const NEWS_FEEDS = {
  afl:   'https://www.afl.com.au/news/feed',
  world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  tech:  'https://www.theverge.com/rss/index.xml',
  good:  'https://www.positive.news/feed/',
};

app.get('/news/:feed', async (req, res) => {
  const feedKey = req.params.feed;
  const feedUrl = NEWS_FEEDS[feedKey];

  if (!feedUrl) {
    return res.status(404).json({ error: 'Unknown feed' });
  }

  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'FrequencyApp/1.0' }
    });
    const xml = await response.text();

    // Parse RSS XML into clean JSON
    const items = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of itemMatches) {
      const block = match[1];

      const title = decodeXml(
        (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || ''
      );
      const description = decodeXml(
        (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || ''
      );
      const link = (
        (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] ||
        (block.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''
      ).trim();
      const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';

      // Strip HTML tags from description for TLDR
      const tldr = description
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 140);

      if (title) {
        items.push({ title, tldr, link, pubDate });
      }

      if (items.length >= 5) break;
    }

    res.json({ feed: feedKey, items });
  } catch (err) {
    res.status(500).json({ error: 'Feed fetch failed', detail: err.message });
  }
});

function decodeXml(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FREQUENCY BACKEND running on port ${PORT}`);
});
