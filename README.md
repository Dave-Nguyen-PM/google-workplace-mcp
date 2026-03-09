# Google Workspace MCP Server for Cursor

An MCP (Model Context Protocol) server that provides Cursor with tools to interact with Google Workspace: Gmail, Calendar, Drive, Docs, Sheets, Slides, Chat, and People.

**Repository:** [github.com/Dave-Nguyen-PM/google-workplace-mcp](https://github.com/Dave-Nguyen-PM/google-workplace-mcp)

## Prerequisites

- Node.js >= 20
- A Google Cloud project with OAuth 2.0 credentials

## GCP Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable these APIs:
   - Gmail API
   - Google Calendar API
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - Google Slides API
   - Google Chat API
   - People API
4. Go to **APIs & Services > OAuth consent screen** and configure it
5. Go to **APIs & Services > Credentials** and create an **OAuth 2.0 Client ID** (type: Desktop app)
6. Download the JSON file

## Installation

```bash
cd /path/to/google-workplace-mcp
npm install
npm run build
```

## Configuration

Place the downloaded OAuth credentials file in one of these locations:
- `./credentials.json` in the project root
- `~/.google-workspace-mcp/credentials.json`
- Set `GOOGLE_CREDENTIALS_PATH` environment variable

Add to your Cursor MCP settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/path/to/google-workplace-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CREDENTIALS_PATH": "/path/to/credentials.json"
      }
    }
  }
}
```

## First Run

On the first request that requires Google auth, a browser window will open for OAuth consent. After authorizing, tokens are cached at `~/.google-workspace-mcp/tokens.json` and auto-refreshed.

## Tools (57 total)

| Domain | Tools | Access |
|--------|-------|--------|
| **Auth** | `auth_clear`, `auth_refreshToken` | - |
| **Time** | `time_getCurrentDate`, `time_getCurrentTime`, `time_getTimeZone` | Read |
| **Drive** | `drive_search`, `drive_findFolder`, `drive_createFolder`, `drive_downloadFile`, `drive_moveFile`, `drive_trashFile`, `drive_renameFile`, `drive_getComments` | Read/Write |
| **Docs** | `docs_create`, `docs_getText`, `docs_writeText`, `docs_replaceText`, `docs_formatText`, `docs_getSuggestions` | Read/Write |
| **Sheets** | `sheets_getText`, `sheets_getRange`, `sheets_find`, `sheets_getMetadata` | Read |
| **Slides** | `slides_getText`, `slides_find`, `slides_getMetadata`, `slides_getImages`, `slides_getSlideThumbnail` | Read |
| **Calendar** | `calendar_list`, `calendar_createEvent`, `calendar_listEvents`, `calendar_getEvent`, `calendar_findFreeTime`, `calendar_updateEvent`, `calendar_respondToEvent`, `calendar_deleteEvent` | Read/Write |
| **Gmail** | `gmail_search`, `gmail_get`, `gmail_downloadAttachment`, `gmail_modify`, `gmail_batchModify`, `gmail_modifyThread`, `gmail_send`, `gmail_createDraft`, `gmail_sendDraft`, `gmail_listLabels`, `gmail_createLabel` | Read/Write |
| **Chat** | `chat_listSpaces`, `chat_findSpaceByName`, `chat_sendMessage`, `chat_getMessages`, `chat_sendDm`, `chat_findDmByEmail`, `chat_listThreads`, `chat_setUpSpace` | Read/Write |
| **People** | `people_getUserProfile`, `people_getMe`, `people_getUserRelations` | Read |

## Debug Mode

Run with `--debug` to enable file logging to `~/.google-workspace-mcp/debug.log`:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/path/to/dist/index.js", "--debug"]
    }
  }
}
```

## Development

```bash
npm run dev    # Watch mode (rebuilds on changes)
npm run build  # Production build
npm start      # Run the server directly
```
