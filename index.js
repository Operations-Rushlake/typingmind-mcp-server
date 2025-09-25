const express = require('express');
const { google } = require('googleapis');
const cookieSession = require('cookie-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- OAuth client setup ---
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

// --- Token persistence (swap with real DB in production) ---
const userTokens = {}; // { userId: tokens }

// Middleware: attach google client for user
const isAuthenticated = async (req, res, next) => {
  const userId = req.headers['x-user-id']; // TypingMind should send this with every request

  if (!userId || !userTokens[userId]) {
    return res.status(401).json({ error: 'User not authenticated. Please log in.' });
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
  client.setCredentials(userTokens[userId]);

  // Auto-refresh tokens if expired
  client.on('tokens', (newTokens) => {
    if (newTokens.refresh_token) {
      userTokens[userId].refresh_token = newTokens.refresh_token;
    }
    if (newTokens.access_token) {
      userTokens[userId].access_token = newTokens.access_token;
    }
  });

  req.googleClient = client;
  req.userId = userId;
  next();
};

// --- OAuth2 Authentication Routes ---
app.get('/auth/google', (req, res) => {
  const userId = req.query.userId; // TypingMind passes ?userId=abc
  if (!userId) return res.status(400).send('Missing userId');

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: userId, // keep track of which user is logging in
  });
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state: userId } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    userTokens[userId] = tokens; // persist tokens in DB here

    console.log(`Stored tokens for user ${userId}`);
    res.send('<script>window.close();</script>');
  } catch (error) {
    console.error('Error retrieving access token', error);
    res.status(500).send('Authentication failed.');
  }
});

// --- Google Drive endpoint ---
app.get('/api/drive/files', isAuthenticated, async (req, res) => {
  const drive = google.drive({ version: 'v3', auth: req.googleClient });
  let allFiles = [];
  let pageToken = null;

  try {
    do {
      const response = await drive.files.list({
        pageSize: 1000,
        fields: 'nextPageToken, files(id, name)',
        pageToken: pageToken || undefined,
      });
      if (response.data.files) {
        allFiles = allFiles.concat(response.data.files);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    res.json(allFiles);
  } catch (error) {
    console.error('The API returned an error: ', error.message);
    res.status(500).json({ error: 'Failed to retrieve files from Google Drive.' });
  }
});

// --- Google Sheets: READ ---
app.get('/api/sheets/read', isAuthenticated, async (req, res) => {
  const { spreadsheetId, range } = req.query;
  if (!spreadsheetId || !range) return res.status(400).json({ error: 'Missing spreadsheetId or range' });

  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    res.json(response.data.values);
  } catch (error) {
    console.error('Sheets API error:', error.message);
    res.status(500).json({ error: 'Failed to read data from Google Sheets.' });
  }
});

// --- Google Sheets: WRITE (Append) ---
app.post('/api/sheets/write', isAuthenticated, async (req, res) => {
  const { spreadsheetId, range, values } = req.body;
  if (!spreadsheetId || !range || !values) return res.status(400).json({ error: 'Missing parameters.' });

  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });
    res.json(response.data);
  } catch (error) {
    console.error('Sheets API error:', error.message);
    res.status(500).json({ error: 'Failed to write data to Google Sheets.' });
  }
});

// --- Google Sheets: UPDATE ---
app.put('/api/sheets/update', isAuthenticated, async (req, res) => {
  const { spreadsheetId, range, values } = req.body;
  if (!spreadsheetId || !range || !values) return res.status(400).json({ error: 'Missing parameters.' });

  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  try {
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });
    res.json(response.data);
  } catch (error) {
    console.error('Sheets API error:', error.message);
    res.status(500).json({ error: 'Failed to update data in Google Sheets.' });
  }
});

app.get('/', (req, res) => res.send('MCP API Server is running.'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
