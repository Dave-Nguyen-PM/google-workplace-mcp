import { google } from 'googleapis';
import { logToFile } from '../utils/logger.js';
import type { AuthManager } from '../auth/AuthManager.js';

export class PeopleService {
  constructor(private authManager: AuthManager) {}

  private async getPeople() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.people({ version: 'v1', auth });
  }

  getUserProfile = async (input: {
    userId?: string;
    email?: string;
    name?: string;
  }) => {
    logToFile(
      `people.getUserProfile: ${input.userId || input.email || input.name}`,
    );
    try {
      const people = await this.getPeople();

      if (input.userId) {
        const resourceName = input.userId.startsWith('people/')
          ? input.userId
          : `people/${input.userId}`;

        const res = await people.people.get({
          resourceName,
          personFields:
            'names,emailAddresses,phoneNumbers,photos,organizations',
        });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(res.data) },
          ],
        };
      }

      if (input.email || input.name) {
        const query = input.email || input.name || '';
        const res = await people.people.searchDirectoryPeople({
          query,
          readMask:
            'names,emailAddresses,phoneNumbers,photos,organizations',
          sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(res.data.people || []),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Provide userId, email, or name',
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getMe = async () => {
    logToFile('people.getMe');
    try {
      const people = await this.getPeople();
      const res = await people.people.get({
        resourceName: 'people/me',
        personFields:
          'names,emailAddresses,phoneNumbers,photos,organizations',
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

  getUserRelations = async (input: {
    userId?: string;
    relationType?: string;
  }) => {
    logToFile(`people.getUserRelations: ${input.userId || 'me'}`);
    try {
      const people = await this.getPeople();
      const resourceName = input.userId
        ? input.userId.startsWith('people/')
          ? input.userId
          : `people/${input.userId}`
        : 'people/me';

      const res = await people.people.get({
        resourceName,
        personFields: 'relations',
      });

      let relations = res.data.relations || [];
      if (input.relationType) {
        relations = relations.filter(
          (r) =>
            r.type?.toLowerCase() === input.relationType!.toLowerCase(),
        );
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(relations) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  private errorResponse(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile(`People error: ${msg}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    };
  }
}
