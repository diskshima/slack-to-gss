/* @flow */

type StringToString = { [ key: string ]: string };

declare class Logger {
  static log(data: Object): void;
  static log(fmt: string, ...values: Array<string>): void;
}

declare class PropertiesService {
  static getScriptProperties(): ScriptProperties;
}

declare class ScriptProperties {
  getProperty(propertyName: string): string;
}

declare class UrlFetchApp {
  static fetch(url: string): HTTPResponse;
}

declare class HTTPResponse {
  getContentText(): string;
}

declare class SpreadsheetApp {
  static openById(id: string): Spreadsheet;
}

declare class Spreadsheet {
  getSheetByName(name: string): Sheet;
  insertSheet(name: string): Sheet;
}

declare class Sheet {
  appendRow(rowContents: Array<*>): Sheet;
}

declare class SlackResponse {
  ok: boolean;
  error: ?string;
}

declare class SlackItemsResponse extends SlackResponse {
  items: Array<SlackItem>;
}

declare class SlackMembersResponse extends SlackResponse {
  members: Array<SlackMember>;
}

declare class SlackMember {
  id: string;
  name: string;
}

declare class SlackItem {
  type: string;
  channel: string;
  created: number;
  created_by: string;
  message: ?SlackMessage;
  file: ?Object;
}

declare class SlackMessage {
  ts: number;
  user: string;
  text: string;
}

class Utils {
  static getScriptProperty(propertyName: string) {
    const value = PropertiesService.getScriptProperties().getProperty(propertyName);

    if (!value) {
      throw `Script property ${propertyName} is missing`;
    }

    return value;
  };
}

class SlackApi {
  slackApiUrl: string;
  token :string;
  memberNames: StringToString;

  constructor(slackApiUrl: string, token: string) {
    this.slackApiUrl = slackApiUrl;
    this.token = token;
    this.memberNames = this.readMemberNames();
  }

  readMemberNames = (): StringToString => {
    const response = this.executeCmd('users.list');
    const userListResponse = ((response: any): SlackMembersResponse);
    return userListResponse.members.reduce((hash, member) => {
      hash[member.id] = member.name;
      return hash;
    }, {});
  }

  executeCmd = (path: string, params: { [key: string]: any } = {}): SlackResponse => {
    const url = `${this.slackApiUrl}${path}?`;
    const queryParams = [ `token=${encodeURIComponent(this.token)}` ];

    for (let k in params) {
      queryParams.push(`${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`);
    }

    const fullUrl = `${url}${queryParams.join('&')}`;
    Logger.log('URL: %s', fullUrl);

    const resp = UrlFetchApp.fetch(fullUrl);
    const data: SlackResponse = JSON.parse(resp.getContentText());

    if (data.error) {
      throw `GET ${path}: ${data.error}`;
    }

    return data;
  }

  formatMessage = (message: ?SlackMessage): Object => {
    if (!message) {
      return {
        timestamp: null,
        user: null,
        text: '',
      };
    }

    const timestamp = new Date(message.ts * 1000);
    const user = message.user ? this.replaceUserIdWithName(message.user) : null;
    const text = message.text ? this.unescapeMessageText(message.text) : '';

    return { timestamp, user, text };
  }

  replaceUserIdWithName = (userId: string): string => {
    const name = this.memberNames[userId];
    return name ? `${name}` : userId;
  }

  unescapeMessageText = (text: ?string): string => {
    return (text || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/<@(\w+?)>/g, ($0, userID) => {
        const name = this.memberNames[userID];
        return name ? `@${name}` : $0;
      });
  }
}

class SpreadSheetWriter {
  file: Spreadsheet;
  sheet: Sheet;

  constructor(sheetId: string) {
    this.file = SpreadsheetApp.openById(sheetId);
    this.sheet = this.getOrCreateSheet('Slack Logs');
  }

  getOrCreateSheet(sheetName: string): Sheet {
    const tmpSheet = this.file.getSheetByName(sheetName);
    return tmpSheet || this.file.insertSheet(sheetName);
  }

  write(row: Array<string>): void {
    this.sheet.appendRow(row);
  }
}

const SLACK_API_URL = 'https://slack.com/api/';
const SLACK_API_TOKEN = Utils.getScriptProperty('slack_api_token');
const SHEET_FILE_ID = Utils.getScriptProperty('sheet_file_id');
const SLACK_CHANNEL_ID = Utils.getScriptProperty('slack_channel_id');

function run() {
  const slackApi = new SlackApi(SLACK_API_URL, SLACK_API_TOKEN);
  const response = slackApi.executeCmd('pins.list', { channel: SLACK_CHANNEL_ID });

  const items = ((response: any): SlackItemsResponse).items;
  const messages = items.filter(item => !!item.message)
                        .map(item => item.message)
                        .map(slackApi.formatMessage);

  const ss = new SpreadSheetWriter(SHEET_FILE_ID);
  messages.forEach(message => ss.write([message.timestamp, message.user, message.text]));
}
