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
  afl:   ['https://www.abc.net.au/news/feed/7077144/rss.xml', 'https://www.afana.com/rss.xml', 'https://sportsnews.com.au/feed'],
  world: ['https://feeds.bbci.co.uk/news/world/rss.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'https://feeds.reuters.com/reuters/worldnews'],
  tech:  ['https://techcrunch.com/feed/', 'https://feeds.arstechnica.com/arstechnica/index', 'https://www.wired.com/feed/rss'],
  good:  ['https://www.positive.news/feed/', 'https://www.goodnewsnetwork.org/feed/', 'https://apnews.com/rss/apf-entertainment'],
};

app.get('/news/:feed', async (req, res) => {
  const feedKey = req.params.feed;
  const feedUrls = NEWS_FEEDS[feedKey];

  if (!feedUrls) {
    return res.status(404).json({ error: 'Unknown feed' });
  }

  // Try each URL in order until one works
  for (const feedUrl of feedUrls) {
    try {
      const response = await fetch(feedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 FrequencyApp/1.0' },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) continue;
      const xml = await response.text();
      if (!xml.includes('<item>') && !xml.includes('<entry>')) continue;

      const items = [];
      // Support both RSS <item> and Atom <entry>
      const tagName = xml.includes('<item>') ? 'item' : 'entry';
      const itemMatches = xml.matchAll(new RegExp('<' + tagName + '>([\\s\\S]*?)<\/' + tagName + '>', 'g'));

      for (const match of itemMatches) {
        const block = match[1];

        const title = decodeXml(
          (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || ''
        );
        const description = decodeXml(
          (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) ||
           block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/) ||
           block.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/) ||
           [])[1] || ''
        );
        const link = (
          (block.match(/<link>(https?:[\s\S]*?)<\/link>/) || [])[1] ||
          (block.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''
        ).trim();
        const pubDate = (
          (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] ||
          (block.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || ''
        );

        const tldr = description
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 140);

        if (title && title.length > 3) {
          items.push({ title, tldr, link, pubDate });
        }

        if (items.length >= 5) break;
      }

      if (items.length > 0) {
        return res.json({ feed: feedKey, source: feedUrl, items });
      }
    } catch (err) {
      console.warn('Feed failed:', feedUrl, err.message);
      continue;
    }
  }

  res.status(500).json({ error: 'All feeds failed for ' + feedKey });
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
