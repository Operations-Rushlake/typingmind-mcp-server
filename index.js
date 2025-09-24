const express = require('express');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
// Render provides the PORT, so we don't need to hardcode it.
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies from POST/PUT requests
app.use(express.json());

// --- Authentication Middleware ---
// This function checks for the access token sent by Typingmind in the header.
const isAuthenticated = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header with Bearer token is required.' });
  }

  const accessToken = authHeader.substring(7);
  const requestClient = new google.auth.OAuth2();
  requestClient.setCredentials({ access_token: accessToken });
  req.googleClient = requestClient;
  next();
};

// --- API Endpoints ---

// Google Drive endpoint
app.get('/api/drive/files', isAuthenticated, async (req, res) => {
    const drive = google.drive({ version: 'v3', auth: req.googleClient });
    try {
        const response = await drive.files.list({
            pageSize: 10,
            fields: 'nextPageToken, files(id, name)',
        });
        res.json(response.data.files);
    } catch (error) {
        console.error('The API returned an error: ', error.message);
        res.status(500).json({ error: 'Failed to retrieve files from Google Drive.' });
    }
});

// Google Sheets - READ endpoint
app.get('/api/sheets/read', isAuthenticated, async (req, res) => {
    const { spreadsheetId, range } = req.query;
    if (!spreadsheetId || !range) {
        return res.status(400).json({ error: 'Missing required parameters: spreadsheetId and range.' });
    }
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
    if (!spreadsheetId || !range || !values) {
        return res.status(400).json({ error: 'Missing required body parameters: spreadsheetId, range, values.' });
    }
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
        console.error('The API returned an error: ', error.message);
        res.status(500).json({ error: 'Failed to write data to Google Sheets.' });
    }
});

// Google Sheets - UPDATE endpoint
app.put('/api/sheets/update', isAuthenticated, async (req, res) => {
    const { spreadsheetId, range, values } = req.body;
    if (!spreadsheetId || !range || !values) {
        return res.status(400).json({ error: 'Missing required body parameters: spreadsheetId, range, values.' });
    }
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
        console.error('The API returned an error: ', error.message);
        res.status(500).json({ error: 'Failed to update data in Google Sheets.' });
    }
});

// Root endpoint for health checks by Render
app.get('/', (req, res) => {
    res.send('MCP API Server is running.');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
