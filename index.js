const express = require('express');
const { google } = require('googleapis');
const cookieSession = require('cookie-session');
require('dotenv').config(); // Used for local development

const app = express();
const PORT = process.env.PORT || 3000;

// This will be set in Render's environment, but defaults to localhost for testing
const REDIRECT_URI = process.env.REDIRECT_URI || http://localhost:${PORT}/auth/google/callback;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

app.use(express.json());
app.use(cookieSession({
    name: 'google-connector-session',
    secret: process.env.SESSION_SECRET,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' // secure cookies in production
}));

// Middleware to set up the authenticated client for each API request
const isAuthenticated = (req, res, next) => {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'User not authenticated. Please connect your account via the plugin.' });
  }
  // Create a new client for each request to ensure user isolation
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials(req.session.tokens);
  req.googleClient = client;
  next();
};

// --- OAuth2 Authentication Routes ---
app.get('/auth/google', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
    res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        req.session.tokens = tokens;
        // This script closes the popup window that Typingmind opens for login
        res.send('<script>window.close();</script>');
    } catch (error) {
        console.error('Error retrieving access token', error);
        res.status(500).send('Authentication failed.');
    }
});

// --- API Endpoints ---

// Google Drive endpoint (fetches all files with pagination)
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

// Google Sheets - READ endpoint
app.get('/api/sheets/read', isAuthenticated, async (req, res) => {
    const { spreadsheetId, range } = req.query;
    if (!spreadsheetId || !range) return res.status(400).json({ error: 'Missing required parameters: spreadsheetId and range.' });
    const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
    try {
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        res.json(response.data.values);
    } catch (error) {
        console.error('The API returned an error: ', error.message);
        res.status(500).json({ error: 'Failed to retrieve data from Google Sheets.' });
    }
});

// Google Sheets - WRITE (Append) endpoint
app.post('/api/sheets/write', isAuthenticated, async (req, res) => {
    const { spreadsheetId, range, values } = req.body;
    if (!spreadsheetId || !range || !values) return res.status(400).json({ error: 'Missing required body parameters.' });
    const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
    try {
        const response = await sheets.spreadsheets.values.append({ spreadsheetId, range, valueInputOption: 'USER_ENTERED', resource: { values } });
        res.json(response.data);
    } catch (error) {
        console.error('The API returned an error: ', error.message);
        res.status(500).json({ error: 'Failed to write data to Google Sheets.' });
    }
});

// Google Sheets - UPDATE endpoint
app.put('/api/sheets/update', isAuthenticated, async (req, res) => {
    const { spreadsheetId, range, values } = req.body;
    if (!spreadsheetId || !range || !values) return res.status(400).json({ error: 'Missing required body parameters.' });
    const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
    try {
        const response = await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'USER_ENTERED', resource: { values } });
        res.json(response.data);
    } catch (error) {
        console.error('The API returned an error: ', error.message);
        res.status(500).json({ error: 'Failed to update data in Google Sheets.' });
    }
});

// Root endpoint for health checks
app.get('/', (req, res) => {
    res.send('MCP API Server is running.');
});

app.listen(PORT, () => {
    console.log(Server listening on port ${PORT});
});
