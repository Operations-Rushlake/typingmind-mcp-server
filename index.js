const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Debug environment variables
console.log('=== Environment Variables Check ===');
console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Set ✓' : 'Missing ✗');
console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'Set ✓' : 'Missing ✗');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? 'Set ✓' : 'Missing ✗');
console.log('REDIRECT_URI:', process.env.REDIRECT_URI || 'Using default');
console.log('===================================');

// Enable CORS
app.use(cors({
  origin: ['https://typingmind.com', 'https://www.typingmind.com', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());

// Store tokens in memory
const userTokens = new Map();

const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;

// Check if credentials exist before creating OAuth client
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('FATAL ERROR: Missing Google OAuth credentials!');
  console.error('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables');
  // Don't crash the server, but log the error
}

// Create OAuth2 client with error handling
let oauth2Client;
try {
  oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || 'missing-client-id',
    process.env.GOOGLE_CLIENT_SECRET || 'missing-client-secret',
    REDIRECT_URI
  );
  console.log('OAuth2 client created successfully');
} catch (error) {
  console.error('Error creating OAuth2 client:', error);
}

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

// Generate a simple token
function generateAccessToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Modified middleware to use Bearer token
const isAuthenticated = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'User not authenticated. Please connect your account via the plugin.',
      authUrl: `${REDIRECT_URI.replace('/auth/google/callback', '')}/auth/google`
    });
  }

  const token = authHeader.substring(7);
  const googleTokens = userTokens.get(token);
  
  if (!googleTokens) {
    return res.status(401).json({ 
      error: 'Invalid or expired token. Please reconnect your account.',
      authUrl: `${REDIRECT_URI.replace('/auth/google/callback', '')}/auth/google`
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
  console.log('Starting OAuth flow...');
  
  if (!oauth2Client) {
    return res.status(500).send('OAuth client not configured. Check server logs.');
  }
  
  const state = generateAccessToken();
  
  try {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: state
    });
    
    console.log('Redirecting to Google OAuth...');
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).send('Error starting authentication');
  }
});

app.get('/auth/google/callback', async (req, res) => {
  console.log('OAuth callback received');
  const { code, state, error } = req.query;
  
  if (error) {
    console.error('OAuth error:', error);
    return res.status(400).send(`Authentication error: ${error}`);
  }
  
  if (!code) {
    return res.status(400).send('No authorization code received');
  }
  
  if (!oauth2Client) {
    console.error('OAuth client not initialized');
    return res.status(500).send('Server configuration error');
  }
  
  try {
    console.log('Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);
    
    // Generate a simple access token for TypingMind to use
    const accessToken = generateAccessToken();
    
    // Store Google tokens associated with our access token
    userTokens.set(accessToken, tokens);
    console.log('Token stored successfully');
    
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
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error retrieving access token:', error.message);
    console.error('Full error:', error);
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

// API Endpoints

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

// Test endpoint
app.get('/api/test', isAuthenticated, (req, res) => {
  res.json({ message: 'Authentication successful! You can now use Google Sheets and Drive.' });
});

// Root endpoint
app.get('/', (req, res) => {
  const status = {
    server: 'running',
    oauth_configured: !!oauth2Client,
    environment: {
      client_id: !!process.env.GOOGLE_CLIENT_ID,
      client_secret: !!process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI
    }
  };
  
  res.send(`
    <h1>MCP API Server</h1>
    <p>Server is running!</p>
    <p>OAuth configured: ${status.oauth_configured ? '✓' : '✗'}</p>
    <p>Client ID: ${status.environment.client_id ? '✓' : '✗'}</p>
    <p>Client Secret: ${status.environment.client_secret ? '✓' : '✗'}</p>
    <p>Redirect URI: ${status.environment.redirect_uri}</p>
    <br>
    <a href="/auth/google">Start Authentication</a>
  `);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}/auth/google to authenticate`);
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('WARNING: Google OAuth credentials are not configured!');
  }
});
