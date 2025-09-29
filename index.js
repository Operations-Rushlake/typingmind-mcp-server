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
  origin: ['https://typingmind.com', 'https://www.typingmind.com', 'https://rushlake-media-gmbh-ai.typingcloud.com', 'http://localhost:3000'],
  credentials: true
}));

// IMPORTANT: Body parsing middleware must come before routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.method === 'POST' || req.method === 'PUT') {
    console.log('Request Headers:', req.headers);
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Store tokens in memory
const userTokens = new Map();

const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;

// Check if credentials exist before creating OAuth client
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('FATAL ERROR: Missing Google OAuth credentials!');
  console.error('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables');
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
  
  console.log('Auth check - Header present:', !!authHeader);
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'User not authenticated. Please connect your account via the plugin.',
      authUrl: `${REDIRECT_URI.replace('/auth/google/callback', '')}/auth/google`
    });
  }

  const token = authHeader.substring(7);
  console.log('Auth check - Token:', token.substring(0, 10) + '...');
  
  const googleTokens = userTokens.get(token);
  console.log('Auth check - Token valid:', !!googleTokens);
  
  if (!googleTokens) {
    console.log('Available tokens:', Array.from(userTokens.keys()).map(k => k.substring(0, 10) + '...'));
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
    console.log('Token stored successfully:', accessToken.substring(0, 10) + '...');
    
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
            user-select: all;
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
          <p>Copy this token and paste it in TypingMind's Request Headers:</p>
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
  console.log('Fetching Google Drive files...');
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
    
    console.log(`Successfully retrieved ${allFiles.length} files`);
    res.json(allFiles);
  } catch (error) {
    console.error('Drive API error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve files from Google Drive.' });
  }
});

// Google Sheets - READ endpoint
app.get('/api/sheets/read', isAuthenticated, async (req, res) => {
  const { spreadsheetId, range } = req.query;
  console.log('Read request - spreadsheetId:', spreadsheetId, 'range:', range);
  
  if (!spreadsheetId || !range) {
    return res.status(400).json({ error: 'Missing required parameters: spreadsheetId and range.' });
  }
  
  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    console.log('Successfully read data from sheet');
    res.json(response.data.values || []);
  } catch (error) {
    console.error('Sheets API read error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve data from Google Sheets.' });
  }
});

// Google Sheets - WRITE (Append) endpoint with enhanced debugging
app.post('/api/sheets/write', isAuthenticated, async (req, res) => {
  console.log('=== WRITE REQUEST DEBUG ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Raw Body:', req.body);
  console.log('Body type:', typeof req.body);
  console.log('Body keys:', Object.keys(req.body || {}));
  
  const { spreadsheetId, range, values } = req.body;
  
  console.log('Parsed values:');
  console.log('- spreadsheetId:', spreadsheetId);
  console.log('- range:', range);
  console.log('- values:', JSON.stringify(values));
  console.log('- values type:', typeof values);
  console.log('- values is array:', Array.isArray(values));
  
  if (!spreadsheetId || !range || !values) {
    console.log('Missing params - spreadsheetId:', !!spreadsheetId, 'range:', !!range, 'values:', !!values);
    return res.status(400).json({ 
      error: 'Missing required body parameters.',
      received: req.body,
      expected: {
        spreadsheetId: 'string',
        range: 'string (e.g., "Sheet1!A1")',
        values: '2D array (e.g., [["value1", "value2"]])'
      }
    });
  }
  
  // Validate values is a 2D array
  if (!Array.isArray(values) || (values.length > 0 && !Array.isArray(values[0]))) {
    return res.status(400).json({ 
      error: 'Values must be a 2D array',
      received: values,
      example: [["Row1Col1", "Row1Col2"], ["Row2Col1", "Row2Col2"]]
    });
  }
  
  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  
  try {
    console.log('Sending to Google Sheets API...');
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });
    console.log('Successfully wrote data to sheet');
    res.json(response.data);
  } catch (error) {
    console.error('Sheets API write error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ 
      error: 'Failed to write data to Google Sheets.',
      details: error.message
    });
  }
});

// Google Sheets - UPDATE endpoint with enhanced debugging
app.put('/api/sheets/update', isAuthenticated, async (req, res) => {
  console.log('=== UPDATE REQUEST DEBUG ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Raw Body:', req.body);
  console.log('Body type:', typeof req.body);
  console.log('Body keys:', Object.keys(req.body || {}));
  
  const { spreadsheetId, range, values } = req.body;
  
  console.log('Parsed values:');
  console.log('- spreadsheetId:', spreadsheetId);
  console.log('- range:', range);
  console.log('- values:', JSON.stringify(values));
  console.log('- values type:', typeof values);
  console.log('- values is array:', Array.isArray(values));
  
  if (!spreadsheetId || !range || !values) {
    console.log('Missing params - spreadsheetId:', !!spreadsheetId, 'range:', !!range, 'values:', !!values);
    return res.status(400).json({ 
      error: 'Missing required body parameters.',
      received: req.body,
      expected: {
        spreadsheetId: 'string',
        range: 'string (e.g., "Sheet1!A1:B2")',
        values: '2D array (e.g., [["value1", "value2"]])'
      }
    });
  }
  
  // Validate values is a 2D array
  if (!Array.isArray(values) || (values.length > 0 && !Array.isArray(values[0]))) {
    return res.status(400).json({ 
      error: 'Values must be a 2D array',
      received: values,
      example: [["Row1Col1", "Row1Col2"], ["Row2Col1", "Row2Col2"]]
    });
  }
  
  const sheets = google.sheets({ version: 'v4', auth: req.googleClient });
  
  try {
    console.log('Sending update to Google Sheets API...');
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });
    console.log('Successfully updated data in sheet');
    res.json(response.data);
  } catch (error) {
    console.error('Sheets API update error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ 
      error: 'Failed to update data in Google Sheets.',
      details: error.message
    });
  }
});

// Test endpoint
app.get('/api/test', isAuthenticated, (req, res) => {
  res.json({ 
    message: 'Authentication successful! You can now use Google Sheets and Drive.',
    availableEndpoints: [
      'GET /api/drive/files',
      'GET /api/sheets/read?spreadsheetId=xxx&range=A1:B2',
      'POST /api/sheets/write',
      'PUT /api/sheets/update'
    ]
  });
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
    },
    active_tokens: userTokens.size
  };
  
  res.send(`
    <h1>MCP API Server</h1>
    <p>Server is running!</p>
    <p>OAuth configured: ${status.oauth_configured ? '✓' : '✗'}</p>
    <p>Client ID: ${status.environment.client_id ? '✓' : '✗'}</p>
    <p>Client Secret: ${status.environment.client_secret ? '✓' : '✗'}</p>
    <p>Redirect URI: ${status.environment.redirect_uri}</p>
    <p>Active tokens: ${status.active_tokens}</p>
    <br>
    <a href="/auth/google" style="padding: 10px 20px; background: #4285f4; color: white; text-decoration: none; border-radius: 4px;">
      Start Authentication
    </a>
  `);
});

// 404 handler
app.use((req, res) => {
  console.log('404 - Not found:', req.method, req.path);
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}/auth/google to authenticate`);
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('WARNING: Google OAuth credentials are not configured!');
  }
});
