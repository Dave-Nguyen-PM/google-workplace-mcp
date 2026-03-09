import crypto from 'node:crypto';
import { google, calendar_v3 } from 'googleapis';
import { logToFile } from '../utils/logger.js';
import type { AuthManager } from '../auth/AuthManager.js';

interface EventAttachment {
  fileUrl: string;
  title?: string;
  mimeType?: string;
}

export interface CreateEventInput {
  calendarId?: string;
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: string[];
  sendUpdates?: 'all' | 'externalOnly' | 'none';
  addGoogleMeet?: boolean;
  attachments?: EventAttachment[];
}

export interface ListEventsInput {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  attendeeResponseStatus?: string[];
}

export interface UpdateEventInput {
  eventId: string;
  calendarId?: string;
  summary?: string;
  description?: string;
  start?: { dateTime: string };
  end?: { dateTime: string };
  attendees?: string[];
  addGoogleMeet?: boolean;
  attachments?: EventAttachment[];
}

export interface RespondToEventInput {
  eventId: string;
  calendarId?: string;
  responseStatus: 'accepted' | 'declined' | 'tentative';
  sendNotification?: boolean;
  responseMessage?: string;
}

export interface FindFreeTimeInput {
  attendees: string[];
  timeMin: string;
  timeMax: string;
  duration: number;
}

export class CalendarService {
  private primaryCalendarId: string | null = null;

  constructor(private authManager: AuthManager) {}

  private async getCalendar() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.calendar({ version: 'v3', auth });
  }

  private async getPrimaryCalendarId(): Promise<string> {
    if (this.primaryCalendarId) return this.primaryCalendarId;
    const calendar = await this.getCalendar();
    const res = await calendar.calendarList.list();
    const primary = res.data.items?.find((c) => c.primary);
    this.primaryCalendarId = primary?.id || 'primary';
    return this.primaryCalendarId;
  }

  private applyMeetAndAttachments(
    event: calendar_v3.Schema$Event,
    params: { conferenceDataVersion?: number; supportsAttachments?: boolean },
    addGoogleMeet?: boolean,
    attachments?: EventAttachment[],
  ): void {
    if (addGoogleMeet) {
      event.conferenceData = {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
      params.conferenceDataVersion = 1;
    }
    if (attachments?.length) {
      event.attachments = attachments.map((a) => ({
        fileUrl: a.fileUrl,
        title: a.title,
        mimeType: a.mimeType,
      }));
      params.supportsAttachments = true;
    }
  }

  listCalendars = async () => {
    logToFile('calendar.listCalendars');
    try {
      const calendar = await this.getCalendar();
      const res = await calendar.calendarList.list();
      const calendars = (res.data.items || []).map((c) => ({
        id: c.id,
        summary: c.summary,
      }));
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(calendars) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  createEvent = async (input: CreateEventInput) => {
    logToFile(`calendar.createEvent: ${input.summary}`);
    try {
      const calendarId =
        input.calendarId || (await this.getPrimaryCalendarId());

      const event: calendar_v3.Schema$Event = {
        summary: input.summary,
        description: input.description,
        start: input.start,
        end: input.end,
        attendees: input.attendees?.map((email) => ({ email })),
      };

      let sendUpdates = input.sendUpdates;
      if (sendUpdates === undefined) {
        sendUpdates = input.attendees?.length ? 'all' : 'none';
      }

      const calendar = await this.getCalendar();
      const insertParams: calendar_v3.Params$Resource$Events$Insert = {
        calendarId,
        requestBody: event,
        sendUpdates,
      };
      this.applyMeetAndAttachments(
        event,
        insertParams,
        input.addGoogleMeet,
        input.attachments,
      );

      const res = await calendar.events.insert(insertParams);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(res.data) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  listEvents = async (input: ListEventsInput) => {
    logToFile('calendar.listEvents');
    try {
      const calendarId =
        input.calendarId || (await this.getPrimaryCalendarId());
      const timeMin = input.timeMin || new Date().toISOString();
      const attendeeResponseStatus = input.attendeeResponseStatus || [
        'accepted',
        'tentative',
        'needsAction',
      ];

      let timeMax = input.timeMax;
      if (!timeMax) {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        timeMax = d.toISOString();
      }

      const calendar = await this.getCalendar();
      const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        fields:
          'items(id,summary,start,end,description,htmlLink,attendees,status)',
      });

      const events = res.data.items
        ?.filter((e) => e.status !== 'cancelled' && !!e.summary)
        .filter((e) => {
          if (!e.attendees?.length) return true;
          if (e.attendees.length === 1 && e.attendees[0].self) return true;
          const self = e.attendees.find((a) => a.self);
          if (!self) return true;
          return attendeeResponseStatus.includes(
            self.responseStatus || 'needsAction',
          );
        });

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(events) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getEvent = async (input: { eventId: string; calendarId?: string }) => {
    logToFile(`calendar.getEvent: ${input.eventId}`);
    try {
      const calendarId =
        input.calendarId || (await this.getPrimaryCalendarId());
      const calendar = await this.getCalendar();
      const res = await calendar.events.get({
        calendarId,
        eventId: input.eventId,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(res.data) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  deleteEvent = async (input: { eventId: string; calendarId?: string }) => {
    logToFile(`calendar.deleteEvent: ${input.eventId}`);
    try {
      const calendarId =
        input.calendarId || (await this.getPrimaryCalendarId());
      const calendar = await this.getCalendar();
      await calendar.events.delete({ calendarId, eventId: input.eventId });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `Deleted event ${input.eventId}`,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  updateEvent = async (input: UpdateEventInput) => {
    logToFile(`calendar.updateEvent: ${input.eventId}`);
    try {
      const calendarId =
        input.calendarId || (await this.getPrimaryCalendarId());
      const calendar = await this.getCalendar();

      const requestBody: calendar_v3.Schema$Event = {};
      if (input.summary !== undefined) requestBody.summary = input.summary;
      if (input.description !== undefined)
        requestBody.description = input.description;
      if (input.start) requestBody.start = input.start;
      if (input.end) requestBody.end = input.end;
      if (input.attendees)
        requestBody.attendees = input.attendees.map((email) => ({ email }));

      const updateParams: calendar_v3.Params$Resource$Events$Update = {
        calendarId,
        eventId: input.eventId,
        requestBody,
      };
      this.applyMeetAndAttachments(
        requestBody,
        updateParams,
        input.addGoogleMeet,
        input.attachments,
      );

      const res = await calendar.events.update(updateParams);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(res.data) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  respondToEvent = async (input: RespondToEventInput) => {
    logToFile(`calendar.respondToEvent: ${input.eventId} -> ${input.responseStatus}`);
    try {
      const calendarId =
        input.calendarId || (await this.getPrimaryCalendarId());
      const calendar = await this.getCalendar();

      const event = await calendar.events.get({
        calendarId,
        eventId: input.eventId,
      });

      if (!event.data.attendees?.length) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Event has no attendees' }),
            },
          ],
        };
      }

      const self = event.data.attendees.find((a) => a.self);
      if (!self) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'You are not an attendee of this event',
              }),
            },
          ],
        };
      }

      self.responseStatus = input.responseStatus;
      if (input.responseMessage !== undefined) {
        self.comment = input.responseMessage;
      }

      const res = await calendar.events.patch({
        calendarId,
        eventId: input.eventId,
        sendNotifications: input.sendNotification ?? true,
        requestBody: { attendees: event.data.attendees },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              eventId: res.data.id,
              summary: res.data.summary,
              responseStatus: input.responseStatus,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  findFreeTime = async (input: FindFreeTimeInput) => {
    logToFile(`calendar.findFreeTime: ${input.attendees.join(', ')}`);
    try {
      const calendar = await this.getCalendar();
      const items = await Promise.all(
        input.attendees.map(async (email) => {
          if (email === 'me') {
            return { id: await this.getPrimaryCalendarId() };
          }
          return { id: email };
        }),
      );

      const res = await calendar.freebusy.query({
        requestBody: {
          items,
          timeMin: input.timeMin,
          timeMax: input.timeMax,
        },
      });

      const busyTimes = Object.values(res.data.calendars || {}).flatMap(
        (cal) => cal.busy || [],
      );

      const sorted = busyTimes
        .filter((b) => b.start && b.end)
        .map((b) => ({
          start: new Date(b.start!).getTime(),
          end: new Date(b.end!).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      // Merge overlapping intervals
      const merged: { start: number; end: number }[] = [];
      for (const busy of sorted) {
        if (!merged.length || busy.start > merged[merged.length - 1].end) {
          merged.push(busy);
        } else {
          merged[merged.length - 1].end = Math.max(
            merged[merged.length - 1].end,
            busy.end,
          );
        }
      }

      const startTime = new Date(input.timeMin).getTime();
      const endTime = new Date(input.timeMax).getTime();
      const durationMs = input.duration * 60000;

      // Try before first busy
      if (!merged.length || startTime + durationMs <= merged[0].start) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                start: input.timeMin,
                end: new Date(startTime + durationMs).toISOString(),
              }),
            },
          ],
        };
      }

      // Try gaps between busy slots
      for (let i = 0; i < merged.length - 1; i++) {
        const gapStart = merged[i].end;
        const gapEnd = merged[i + 1].start;
        if (gapEnd - gapStart >= durationMs) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  start: new Date(gapStart).toISOString(),
                  end: new Date(gapStart + durationMs).toISOString(),
                }),
              },
            ],
          };
        }
      }

      // Try after last busy
      const lastEnd = merged[merged.length - 1].end;
      if (lastEnd + durationMs <= endTime) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                start: new Date(lastEnd).toISOString(),
                end: new Date(lastEnd + durationMs).toISOString(),
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'No available free time found' }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  private errorResponse(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile(`Calendar error: ${msg}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    };
  }
}
