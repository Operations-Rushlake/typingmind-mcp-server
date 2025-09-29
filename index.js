const express = require('express');
const { google } = require('googleapis');
const cors = require('cors'); // You'll need to install this
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for TypingMind
app.use(cors({
  origin: ['https://typingmind.com', 'https://www.typingmind.com', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());

// Store tokens in memory (for production, use a database)
const userTokens = new Map();

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

// Generate a simple token (in production, use proper JWT)
function generateAccessToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Modified middleware to use Bearer token
const isAuthenticated = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'User not authenticated. Please connect your account via the plugin.',
      authUrl: `${process.env.REDIRECT_URI?.replace('/auth/google/callback', '')}/auth/google` || `http://localhost:${PORT}/auth/google`
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const googleTokens = userTokens.get(token);
  
  if (!googleTokens) {
    return res.status(401).json({ 
      error: 'Invalid or expired token. Please reconnect your account.',
      authUrl: `${process.env.REDIRECT_URI?.replace('/auth/google/callback', '')}/auth/google` || `http://localhost:${PORT}/auth/google`
    });
  }

  // Create OAuth client with user's tokens
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
  client.setCredentials(googleTokens);
  req.googleClient = client;
  next();
};

// OAuth Routes
app.get('/auth/google', (req, res) => {
  // Store state to identify user (in production, use proper state management)
  const state = generateAccessToken();
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: state
  });
  
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    // Generate a simple access token for TypingMind to use
    const accessToken = generateAccessToken();
    
    // Store Google tokens associated with our access token
    userTokens.set(accessToken, tokens);
    
    // Return HTML that passes the token to TypingMind
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f0f0f0;
          }
          .container {
            text-align: center;
            padding: 20px;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .token-box {
            background-color: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            margin: 20px 0;
            word-break: break-all;
            font-family: monospace;
          }
          button {
            background-color: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            text-align: center;
            text-decoration: none;
            display: inline-block;
            font-size: 16px;
            margin: 4px 2px;
            cursor: pointer;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>✅ Authentication Successful!</h2>
          <p>Copy this token and paste it in TypingMind's OAuth configuration:</p>
          <div class="token-box" id="token">${accessToken}</div>
          <button onclick="copyToken()">Copy Token</button>
          <p style="margin-top: 20px; color: #666;">After copying, you can close this window.</p>
        </div>
        <script>
          function copyToken() {
            const tokenElement = document.getElementById('token');
            const token = tokenElement.textContent;
            navigator.clipboard.writeText(token).then(function() {
              alert('Token copied to clipboard!');
            }, function(err) {
              console.error('Could not copy text: ', err);
            });
          }
          
          // Try to communicate with parent window (TypingMind)
          if (window.opener) {
            window.opener.postMessage({ 
              type: 'oauth-success', 
              token: '${accessToken}' 
            }, '*');
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error retrieving access token', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h2>❌ Authentication Failed</h2>
        <p>${error.message}</p>
        <p>Please close this window and try again.</p>
      </body>
      </html>
    `);
  }
});

// API Endpoints (same as before, but now using token auth)

// Google Drive endpoint
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
  
  if (!spreadsheetId || !range) {
    return res.status(400).json({ error: 'Missing required parameters: spreadsheetId and range.' });
  }
  
  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    res.json(response.data.values || []);
  } catch (error) {
    console.error('The API returned an error: ', error.message);
    res.status(500).json({ error: 'Failed to retrieve data from Google Sheets.' });
  }
});

// Google Sheets - WRITE (Append) endpoint
app.post('/api/sheets/write', isAuthenticated, async (req, res) => {
  const { spreadsheetId, range, values } = req.body;
  
  if (!spreadsheetId || !range || !values) {
    return res.status(400).json({ error: 'Missing required body parameters.' });
  }
  
  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
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
    return res.status(400).json({ error: 'Missing required body parameters.' });
  }
  
  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  
  try {
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });
    res.json(response.data);
  } catch (error) {
    console.error('The API returned an error: ', error.message);
    res.status(500).json({ error: 'Failed to update data in Google Sheets.' });
  }
});

// Test endpoint to check authentication
app.get('/api/test', isAuthenticated, (req, res) => {
  res.json({ message: 'Authentication successful! You can now use Google Sheets and Drive.' });
});

// Root endpoint for health checks
app.get('/', (req, res) => {
  res.send('MCP API Server is running. Visit /auth/google to authenticate.');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}/auth/google to authenticate`);
});
