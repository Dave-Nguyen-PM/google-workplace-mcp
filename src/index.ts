#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { AuthManager } from './auth/AuthManager.js';
import { SCOPES } from './auth/scopes.js';
import { setLoggingEnabled } from './utils/logger.js';
import { GMAIL_SEARCH_MAX_RESULTS } from './utils/constants.js';

import { TimeService } from './services/TimeService.js';
import { DriveService } from './services/DriveService.js';
import { DocsService } from './services/DocsService.js';
import { SheetsService } from './services/SheetsService.js';
import { SlidesService } from './services/SlidesService.js';
import { CalendarService } from './services/CalendarService.js';
import { GmailService } from './services/GmailService.js';
import { ChatService } from './services/ChatService.js';
import { PeopleService } from './services/PeopleService.js';

const readOnlyHint = { annotations: { readOnlyHint: true } };

const eventMeetAndAttachmentsSchema = {
  addGoogleMeet: z
    .boolean()
    .optional()
    .describe('Whether to create a Google Meet link for the event.'),
  attachments: z
    .array(
      z.object({
        fileUrl: z.string().url().describe('Google Drive file URL.'),
        title: z.string().optional().describe('Display title.'),
        mimeType: z.string().optional().describe('MIME type.'),
      }),
    )
    .optional()
    .describe(
      'Google Drive file attachments. Providing attachments fully REPLACES existing ones.',
    ),
};

const emailComposeSchema = {
  to: z
    .union([z.string(), z.array(z.string())])
    .describe('Recipient email address(es).'),
  subject: z.string().describe('Email subject.'),
  body: z.string().describe('Email body content.'),
  cc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('CC recipient(s).'),
  bcc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('BCC recipient(s).'),
  isHtml: z
    .boolean()
    .optional()
    .describe('Whether the body is HTML (default: false).'),
};

async function main() {
  if (process.argv.includes('--debug')) {
    setLoggingEnabled(true);
  }

  const authManager = new AuthManager(SCOPES);

  const server = new McpServer({
    name: 'google-workspace',
    version: '1.0.0',
  });

  const timeService = new TimeService();
  const driveService = new DriveService(authManager);
  const docsService = new DocsService(authManager);
  const sheetsService = new SheetsService(authManager);
  const slidesService = new SlidesService(authManager);
  const calendarService = new CalendarService(authManager);
  const gmailService = new GmailService(authManager);
  const chatService = new ChatService(authManager);
  const peopleService = new PeopleService(authManager);

  // ── Auth ──

  server.registerTool(
    'auth_clear',
    {
      description: 'Clears authentication credentials, forcing re-login on next request.',
      inputSchema: {},
    },
    async () => {
      await authManager.clearAuth();
      return {
        content: [
          {
            type: 'text',
            text: 'Authentication cleared. You will be prompted to log in again.',
          },
        ],
      };
    },
  );

  server.registerTool(
    'auth_refreshToken',
    {
      description: 'Manually triggers the token refresh process.',
      inputSchema: {},
    },
    async () => {
      await authManager.refreshToken();
      return {
        content: [{ type: 'text', text: 'Token refreshed successfully.' }],
      };
    },
  );

  // ── Time ──

  server.registerTool(
    'time_getCurrentDate',
    {
      description:
        'Gets the current date in UTC and local time, along with the timezone.',
      inputSchema: {},
      ...readOnlyHint,
    },
    timeService.getCurrentDate,
  );

  server.registerTool(
    'time_getCurrentTime',
    {
      description:
        'Gets the current time in UTC and local time, along with the timezone.',
      inputSchema: {},
      ...readOnlyHint,
    },
    timeService.getCurrentTime,
  );

  server.registerTool(
    'time_getTimeZone',
    {
      description: 'Gets the local timezone and UTC offset.',
      inputSchema: {},
      ...readOnlyHint,
    },
    timeService.getTimeZone,
  );

  // ── Drive ──

  server.registerTool(
    'drive_search',
    {
      description:
        'Searches for files and folders in Google Drive. Query can be a simple term, a URL, or a full Drive query string.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'Search term, Google Drive URL, or full query string (e.g., "name contains \'Budget\'").',
          ),
        pageSize: z.number().optional().describe('Max results to return.'),
        pageToken: z.string().optional().describe('Next page token.'),
        corpus: z
          .string()
          .optional()
          .describe('Corpus to search (e.g., "user", "domain").'),
        sharedWithMe: z
          .boolean()
          .optional()
          .describe('Search only files shared with you.'),
      },
      ...readOnlyHint,
    },
    driveService.search,
  );

  server.registerTool(
    'drive_findFolder',
    {
      description: 'Finds a folder by name in Google Drive.',
      inputSchema: {
        folderName: z.string().describe('The name of the folder to find.'),
      },
      ...readOnlyHint,
    },
    driveService.findFolder,
  );

  server.registerTool(
    'drive_createFolder',
    {
      description: 'Creates a new folder in Google Drive.',
      inputSchema: {
        name: z.string().min(1).describe('Folder name.'),
        parentId: z
          .string()
          .optional()
          .describe('Parent folder ID (root if omitted).'),
      },
    },
    driveService.createFolder,
  );

  server.registerTool(
    'drive_downloadFile',
    {
      description: 'Downloads a file from Google Drive to a local path.',
      inputSchema: {
        fileId: z.string().describe('File ID or URL.'),
        localPath: z.string().describe('Local path to save the file.'),
      },
    },
    driveService.downloadFile,
  );

  server.registerTool(
    'drive_moveFile',
    {
      description: 'Moves a file or folder to a different folder in Google Drive.',
      inputSchema: {
        fileId: z.string().describe('File ID or URL to move.'),
        folderId: z.string().optional().describe('Destination folder ID.'),
        folderName: z
          .string()
          .optional()
          .describe('Destination folder name (looked up if no folderId).'),
      },
    },
    driveService.moveFile,
  );

  server.registerTool(
    'drive_trashFile',
    {
      description: 'Moves a file or folder to the trash (reversible).',
      inputSchema: {
        fileId: z.string().describe('File ID or URL to trash.'),
      },
    },
    driveService.trashFile,
  );

  server.registerTool(
    'drive_renameFile',
    {
      description: 'Renames a file or folder in Google Drive.',
      inputSchema: {
        fileId: z.string().describe('File ID or URL.'),
        newName: z.string().min(1).describe('New name.'),
      },
    },
    driveService.renameFile,
  );

  server.registerTool(
    'drive_getComments',
    {
      description: 'Retrieves comments from a Google Drive file.',
      inputSchema: {
        fileId: z.string().describe('File ID to get comments from.'),
      },
      ...readOnlyHint,
    },
    driveService.getComments,
  );

  // ── Docs ──

  server.registerTool(
    'docs_create',
    {
      description: 'Creates a new Google Doc, optionally with initial text content.',
      inputSchema: {
        title: z.string().describe('Title for the new document.'),
        content: z
          .string()
          .optional()
          .describe('Initial text content.'),
      },
    },
    docsService.create,
  );

  server.registerTool(
    'docs_getText',
    {
      description: 'Retrieves the text content of a Google Doc.',
      inputSchema: {
        documentId: z.string().describe('Document ID or URL.'),
        tabId: z
          .string()
          .optional()
          .describe('Specific tab ID (returns all tabs if omitted).'),
      },
      ...readOnlyHint,
    },
    docsService.getText,
  );

  server.registerTool(
    'docs_writeText',
    {
      description: 'Writes text to a Google Doc at a specified position.',
      inputSchema: {
        documentId: z.string().describe('Document ID or URL.'),
        text: z.string().describe('Text to write.'),
        position: z
          .string()
          .optional()
          .describe(
            '"beginning", "end" (default), or a numeric index.',
          ),
        tabId: z
          .string()
          .optional()
          .describe('Tab ID to modify (first tab if omitted).'),
      },
    },
    docsService.writeText,
  );

  server.registerTool(
    'docs_replaceText',
    {
      description:
        'Replaces all occurrences of text with new text in a Google Doc.',
      inputSchema: {
        documentId: z.string().describe('Document ID or URL.'),
        findText: z.string().describe('Text to find.'),
        replaceText: z.string().describe('Replacement text.'),
        tabId: z
          .string()
          .optional()
          .describe('Tab ID (replaces in all tabs if omitted).'),
      },
    },
    docsService.replaceText,
  );

  server.registerTool(
    'docs_formatText',
    {
      description:
        'Applies formatting (bold, italic, headings, etc.) to text ranges in a Google Doc.',
      inputSchema: {
        documentId: z.string().describe('Document ID or URL.'),
        formats: z
          .array(
            z.object({
              startIndex: z.number().describe('Start index (1-based).'),
              endIndex: z.number().describe('End index (exclusive, 1-based).'),
              style: z
                .string()
                .describe(
                  'Style: bold, italic, underline, strikethrough, code, link, heading1-heading6, normalText.',
                ),
              url: z
                .string()
                .optional()
                .describe('URL (required for "link" style).'),
            }),
          )
          .describe('Formatting instructions.'),
        tabId: z.string().optional().describe('Tab ID.'),
      },
    },
    docsService.formatText,
  );

  server.registerTool(
    'docs_getSuggestions',
    {
      description: 'Retrieves suggested edits from a Google Doc.',
      inputSchema: {
        documentId: z.string().describe('Document ID or URL.'),
      },
      ...readOnlyHint,
    },
    docsService.getSuggestions,
  );

  // ── Sheets ──

  server.registerTool(
    'sheets_getText',
    {
      description: 'Retrieves the content of a Google Sheets spreadsheet.',
      inputSchema: {
        spreadsheetId: z.string().describe('Spreadsheet ID or URL.'),
        format: z
          .enum(['text', 'csv', 'json'])
          .optional()
          .describe('Output format (default: text).'),
      },
      ...readOnlyHint,
    },
    sheetsService.getText,
  );

  server.registerTool(
    'sheets_getRange',
    {
      description: 'Gets values from a specific range in a spreadsheet.',
      inputSchema: {
        spreadsheetId: z.string().describe('Spreadsheet ID or URL.'),
        range: z
          .string()
          .describe('A1 notation range (e.g., "Sheet1!A1:B10").'),
      },
      ...readOnlyHint,
    },
    sheetsService.getRange,
  );

  server.registerTool(
    'sheets_find',
    {
      description: 'Finds Google Sheets spreadsheets by name.',
      inputSchema: {
        query: z.string().describe('Search query.'),
        pageToken: z.string().optional().describe('Next page token.'),
        pageSize: z.number().optional().describe('Max results.'),
      },
      ...readOnlyHint,
    },
    sheetsService.find,
  );

  server.registerTool(
    'sheets_getMetadata',
    {
      description: 'Gets metadata about a spreadsheet (sheets, dimensions, etc.).',
      inputSchema: {
        spreadsheetId: z.string().describe('Spreadsheet ID or URL.'),
      },
      ...readOnlyHint,
    },
    sheetsService.getMetadata,
  );

  // ── Slides ──

  server.registerTool(
    'slides_getText',
    {
      description: 'Retrieves the text content of a Google Slides presentation.',
      inputSchema: {
        presentationId: z.string().describe('Presentation ID or URL.'),
      },
      ...readOnlyHint,
    },
    slidesService.getText,
  );

  server.registerTool(
    'slides_find',
    {
      description: 'Finds Google Slides presentations by name.',
      inputSchema: {
        query: z.string().describe('Search query.'),
        pageToken: z.string().optional().describe('Next page token.'),
        pageSize: z.number().optional().describe('Max results.'),
      },
      ...readOnlyHint,
    },
    slidesService.find,
  );

  server.registerTool(
    'slides_getMetadata',
    {
      description: 'Gets metadata about a presentation (slides, dimensions, etc.).',
      inputSchema: {
        presentationId: z.string().describe('Presentation ID or URL.'),
      },
      ...readOnlyHint,
    },
    slidesService.getMetadata,
  );

  server.registerTool(
    'slides_getImages',
    {
      description:
        'Downloads all images from a presentation to a local directory.',
      inputSchema: {
        presentationId: z.string().describe('Presentation ID or URL.'),
        localPath: z.string().describe('Local directory path for images.'),
      },
    },
    slidesService.getImages,
  );

  server.registerTool(
    'slides_getSlideThumbnail',
    {
      description: 'Downloads a thumbnail image of a specific slide.',
      inputSchema: {
        presentationId: z.string().describe('Presentation ID or URL.'),
        slideObjectId: z.string().describe('Slide object ID.'),
        localPath: z.string().describe('Local file path for the thumbnail.'),
      },
    },
    slidesService.getSlideThumbnail,
  );

  // ── Calendar ──

  server.registerTool(
    'calendar_list',
    {
      description: "Lists all of the user's calendars.",
      inputSchema: {},
      ...readOnlyHint,
    },
    calendarService.listCalendars,
  );

  server.registerTool(
    'calendar_createEvent',
    {
      description:
        'Creates a new calendar event. Supports Google Meet and Drive attachments.',
      inputSchema: {
        calendarId: z
          .string()
          .optional()
          .describe('Calendar ID (primary if omitted).'),
        summary: z.string().describe('Event title.'),
        description: z.string().optional().describe('Event description.'),
        start: z.object({
          dateTime: z
            .string()
            .describe(
              'Start time in ISO 8601 format (e.g., 2024-01-15T10:30:00Z).',
            ),
        }),
        end: z.object({
          dateTime: z
            .string()
            .describe(
              'End time in ISO 8601 format (e.g., 2024-01-15T11:30:00Z).',
            ),
        }),
        attendees: z
          .array(z.string())
          .optional()
          .describe('Attendee email addresses.'),
        sendUpdates: z
          .enum(['all', 'externalOnly', 'none'])
          .optional()
          .describe('Notification preference. Defaults to "all" if attendees exist.'),
        ...eventMeetAndAttachmentsSchema,
      },
    },
    calendarService.createEvent,
  );

  server.registerTool(
    'calendar_listEvents',
    {
      description: 'Lists events from a calendar. Defaults to upcoming events.',
      inputSchema: {
        calendarId: z
          .string()
          .optional()
          .describe('Calendar ID (primary if omitted).'),
        timeMin: z
          .string()
          .optional()
          .describe('Start of time range (defaults to now).'),
        timeMax: z.string().optional().describe('End of time range.'),
        attendeeResponseStatus: z
          .array(z.string())
          .optional()
          .describe('Filter by response status.'),
      },
      ...readOnlyHint,
    },
    calendarService.listEvents,
  );

  server.registerTool(
    'calendar_getEvent',
    {
      description: 'Gets details of a specific calendar event.',
      inputSchema: {
        eventId: z.string().describe('Event ID.'),
        calendarId: z
          .string()
          .optional()
          .describe('Calendar ID (primary if omitted).'),
      },
      ...readOnlyHint,
    },
    calendarService.getEvent,
  );

  server.registerTool(
    'calendar_findFreeTime',
    {
      description: 'Finds a free time slot for multiple people to meet.',
      inputSchema: {
        attendees: z
          .array(z.string())
          .describe('Email addresses (use "me" for yourself).'),
        timeMin: z.string().describe('Range start in ISO 8601.'),
        timeMax: z.string().describe('Range end in ISO 8601.'),
        duration: z.number().describe('Meeting duration in minutes.'),
      },
      ...readOnlyHint,
    },
    calendarService.findFreeTime,
  );

  server.registerTool(
    'calendar_updateEvent',
    {
      description:
        'Updates an existing calendar event. Supports Meet and Drive attachments.',
      inputSchema: {
        eventId: z.string().describe('Event ID to update.'),
        calendarId: z.string().optional().describe('Calendar ID.'),
        summary: z.string().optional().describe('New title.'),
        description: z.string().optional().describe('New description.'),
        start: z
          .object({
            dateTime: z.string().describe('New start time in ISO 8601.'),
          })
          .optional(),
        end: z
          .object({
            dateTime: z.string().describe('New end time in ISO 8601.'),
          })
          .optional(),
        attendees: z
          .array(z.string())
          .optional()
          .describe('New attendee list.'),
        ...eventMeetAndAttachmentsSchema,
      },
    },
    calendarService.updateEvent,
  );

  server.registerTool(
    'calendar_respondToEvent',
    {
      description:
        'Responds to a meeting invitation (accept, decline, or tentative).',
      inputSchema: {
        eventId: z.string().describe('Event ID to respond to.'),
        calendarId: z.string().optional().describe('Calendar ID.'),
        responseStatus: z
          .enum(['accepted', 'declined', 'tentative'])
          .describe('Your response.'),
        sendNotification: z
          .boolean()
          .optional()
          .describe('Notify organizer (default: true).'),
        responseMessage: z
          .string()
          .optional()
          .describe('Optional message with your response.'),
      },
    },
    calendarService.respondToEvent,
  );

  server.registerTool(
    'calendar_deleteEvent',
    {
      description: 'Deletes an event from a calendar.',
      inputSchema: {
        eventId: z.string().describe('Event ID to delete.'),
        calendarId: z
          .string()
          .optional()
          .describe('Calendar ID (primary if omitted).'),
      },
    },
    calendarService.deleteEvent,
  );

  // ── Chat ──

  server.registerTool(
    'chat_listSpaces',
    {
      description: 'Lists the Google Chat spaces you are a member of.',
      inputSchema: {},
      ...readOnlyHint,
    },
    chatService.listSpaces,
  );

  server.registerTool(
    'chat_findSpaceByName',
    {
      description: 'Finds a Google Chat space by display name.',
      inputSchema: {
        displayName: z.string().describe('Space display name to search for.'),
      },
      ...readOnlyHint,
    },
    chatService.findSpaceByName,
  );

  server.registerTool(
    'chat_sendMessage',
    {
      description: 'Sends a message to a Google Chat space.',
      inputSchema: {
        spaceName: z
          .string()
          .describe('Space resource name (e.g., spaces/AAAAN2J52O8).'),
        message: z.string().describe('Message text.'),
        threadName: z
          .string()
          .optional()
          .describe('Thread resource name to reply to.'),
      },
    },
    chatService.sendMessage,
  );

  server.registerTool(
    'chat_getMessages',
    {
      description: 'Gets messages from a Google Chat space.',
      inputSchema: {
        spaceName: z.string().describe('Space resource name.'),
        threadName: z
          .string()
          .optional()
          .describe('Filter by thread name.'),
        pageSize: z.number().optional().describe('Max messages to return.'),
        pageToken: z.string().optional().describe('Next page token.'),
        orderBy: z
          .string()
          .optional()
          .describe('Sort order (e.g., "createTime desc").'),
      },
      ...readOnlyHint,
    },
    chatService.getMessages,
  );

  server.registerTool(
    'chat_sendDm',
    {
      description: 'Sends a direct message to a user by email.',
      inputSchema: {
        email: z.string().describe('Recipient email address.'),
        message: z.string().describe('Message text.'),
        threadName: z.string().optional().describe('Thread to reply to.'),
      },
    },
    chatService.sendDm,
  );

  server.registerTool(
    'chat_findDmByEmail',
    {
      description: "Finds a Google Chat DM space by a user's email address.",
      inputSchema: {
        email: z.string().describe('Email address to look up.'),
      },
      ...readOnlyHint,
    },
    chatService.findDmByEmail,
  );

  server.registerTool(
    'chat_listThreads',
    {
      description: 'Lists threads from a Google Chat space.',
      inputSchema: {
        spaceName: z.string().describe('Space resource name.'),
        pageSize: z.number().optional().describe('Max threads to return.'),
        pageToken: z.string().optional().describe('Next page token.'),
      },
      ...readOnlyHint,
    },
    chatService.listThreads,
  );

  server.registerTool(
    'chat_setUpSpace',
    {
      description: 'Creates a new Google Chat space with members.',
      inputSchema: {
        displayName: z.string().describe('Space display name.'),
        userNames: z
          .array(z.string())
          .describe('Member user names (e.g., users/12345678).'),
      },
    },
    chatService.setUpSpace,
  );

  // ── Gmail ──

  server.registerTool(
    'gmail_search',
    {
      description: 'Search for emails in Gmail using query parameters.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'Gmail search query (e.g., "from:someone@example.com is:unread").',
          ),
        maxResults: z
          .number()
          .optional()
          .describe(`Max results (default: ${GMAIL_SEARCH_MAX_RESULTS}).`),
        pageToken: z.string().optional().describe('Next page token.'),
        labelIds: z
          .array(z.string())
          .optional()
          .describe('Filter by label IDs (e.g., ["INBOX", "UNREAD"]).'),
        includeSpamTrash: z
          .boolean()
          .optional()
          .describe('Include SPAM and TRASH (default: false).'),
      },
      ...readOnlyHint,
    },
    gmailService.search,
  );

  server.registerTool(
    'gmail_get',
    {
      description: 'Get the full content of a specific email message.',
      inputSchema: {
        messageId: z.string().describe('Message ID.'),
        format: z
          .enum(['minimal', 'full', 'raw', 'metadata'])
          .optional()
          .describe('Message format (default: full).'),
      },
      ...readOnlyHint,
    },
    gmailService.get,
  );

  server.registerTool(
    'gmail_downloadAttachment',
    {
      description: 'Downloads an email attachment to a local file.',
      inputSchema: {
        messageId: z.string().describe('Message ID.'),
        attachmentId: z.string().describe('Attachment ID.'),
        localPath: z.string().describe('Local path to save to.'),
      },
    },
    gmailService.downloadAttachment,
  );

  server.registerTool(
    'gmail_modify',
    {
      description: `Modify a Gmail message's labels. System labels: INBOX, SPAM, TRASH, UNREAD, STARRED, IMPORTANT.`,
      inputSchema: {
        messageId: z.string().describe('Message ID.'),
        addLabelIds: z
          .array(z.string())
          .max(100)
          .optional()
          .describe('Labels to add.'),
        removeLabelIds: z
          .array(z.string())
          .max(100)
          .optional()
          .describe('Labels to remove.'),
      },
    },
    gmailService.modify,
  );

  server.registerTool(
    'gmail_batchModify',
    {
      description:
        'Bulk modify up to 1,000 Gmail messages at once with the same label changes.',
      inputSchema: {
        messageIds: z
          .array(z.string())
          .min(1)
          .max(1000)
          .describe('Message IDs to modify.'),
        addLabelIds: z
          .array(z.string())
          .max(100)
          .optional()
          .describe('Labels to add.'),
        removeLabelIds: z
          .array(z.string())
          .max(100)
          .optional()
          .describe('Labels to remove.'),
      },
    },
    gmailService.batchModify,
  );

  server.registerTool(
    'gmail_modifyThread',
    {
      description:
        'Modify labels on all messages in a Gmail thread at once.',
      inputSchema: {
        threadId: z.string().describe('Thread ID.'),
        addLabelIds: z
          .array(z.string())
          .max(100)
          .optional()
          .describe('Labels to add.'),
        removeLabelIds: z
          .array(z.string())
          .max(100)
          .optional()
          .describe('Labels to remove.'),
      },
    },
    gmailService.modifyThread,
  );

  server.registerTool(
    'gmail_send',
    {
      description: 'Send an email message.',
      inputSchema: emailComposeSchema,
    },
    gmailService.send,
  );

  server.registerTool(
    'gmail_createDraft',
    {
      description: 'Create a draft email message.',
      inputSchema: {
        ...emailComposeSchema,
        threadId: z
          .string()
          .optional()
          .describe('Thread ID to create the draft as a reply to.'),
      },
    },
    gmailService.createDraft,
  );

  server.registerTool(
    'gmail_sendDraft',
    {
      description: 'Send a previously created draft email.',
      inputSchema: {
        draftId: z.string().describe('Draft ID to send.'),
      },
    },
    gmailService.sendDraft,
  );

  server.registerTool(
    'gmail_listLabels',
    {
      description: "List all Gmail labels in the user's mailbox.",
      inputSchema: {},
      ...readOnlyHint,
    },
    gmailService.listLabels,
  );

  server.registerTool(
    'gmail_createLabel',
    {
      description: 'Create a new Gmail label.',
      inputSchema: {
        name: z.string().min(1).describe('Label display name.'),
        labelListVisibility: z
          .enum(['labelShow', 'labelHide', 'labelShowIfUnread'])
          .optional()
          .describe('Label list visibility (default: labelShow).'),
        messageListVisibility: z
          .enum(['show', 'hide'])
          .optional()
          .describe('Message list visibility (default: show).'),
      },
    },
    gmailService.createLabel,
  );

  // ── People ──

  server.registerTool(
    'people_getUserProfile',
    {
      description: "Gets a user's profile information by ID, email, or name.",
      inputSchema: {
        userId: z.string().optional().describe('User ID.'),
        email: z.string().optional().describe('Email address.'),
        name: z.string().optional().describe('Name to search for.'),
      },
      ...readOnlyHint,
    },
    peopleService.getUserProfile,
  );

  server.registerTool(
    'people_getMe',
    {
      description: 'Gets the profile information of the authenticated user.',
      inputSchema: {},
      ...readOnlyHint,
    },
    peopleService.getMe,
  );

  server.registerTool(
    'people_getUserRelations',
    {
      description:
        "Gets a user's relations (manager, spouse, assistant, etc.). Defaults to authenticated user.",
      inputSchema: {
        userId: z
          .string()
          .optional()
          .describe('User ID (defaults to authenticated user).'),
        relationType: z
          .string()
          .optional()
          .describe('Filter by relation type (e.g., "manager").'),
      },
      ...readOnlyHint,
    },
    peopleService.getUserRelations,
  );

  // ── Start server ──

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    'Google Workspace MCP Server is running. Listening for requests...',
  );
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
