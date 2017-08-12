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
  getLastRow(): number;
  getSheetValues(startRow: number, startColumn: number, numRows: number, numColumns: number):
    Array<Array<*>>;
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
  ts: string;
  user: string;
  text: string;
}

type SheetRow = {
  timestamp: string,
  datetime: ?Date,
  deleted: boolean,
  user: string,
  text: string,
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

  formatMessage = (message: SlackMessage): SheetRow => {
    const timestamp = message.ts;
    const datetime = new Date(parseFloat(timestamp) * 1000);
    const user = message.user ? this.replaceUserIdWithName(message.user) : '';
    const text = message.text ? this.unescapeMessageText(message.text) : '';

    return { timestamp, datetime, user, text, deleted: false };
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

class SpreadSheetAccessor {
  file: Spreadsheet;
  sheet: Sheet;

  constructor(sheetId: string) {
    this.file = SpreadsheetApp.openById(sheetId);
    this.sheet = this.getOrCreateSheet('Slack Logs');
  }

  getOrCreateSheet = (sheetName: string): Sheet => {
    const tmpSheet = this.file.getSheetByName(sheetName);
    return tmpSheet || this.file.insertSheet(sheetName);
  }

  write = (row: Array<*>): void => {
    this.sheet.appendRow(row);
  }

  readColumn = (columnNumber: number): Array<Object> => {
    const lastRow = this.sheet.getLastRow();
    if (lastRow === 0) { return []; }
    const rows = this.sheet.getSheetValues(1, columnNumber, lastRow, 1);
    return rows.map(row => row[0]);
  }

  readRows = (): Array<SheetRow> => {
    const lastRow = this.sheet.getLastRow();
    if (lastRow === 0) { return []; }
    const rows = this.sheet.getSheetValues(1, 1, lastRow, 5);
    return rows.map(row => ({
      timestamp: row[0],
      deleted: row[1] === '削除済み',
      datetime: new Date((row[2]: string)),
      user: (row[3]: string),
      text: (row[4]: string),
    }));
  }
}

type RowDiff = {
  added: Array<SheetRow>,
  deleted: Array<SheetRow>,
}

const calculateDiff = (messages: Array<SheetRow>, rows: Array<SheetRow>): RowDiff => {
  const added = [];
  const deleted = [];

  const tsToRow = rows.reduce((hash, row) => {
    hash[row.timestamp] = row;
    return hash;
  }, {});

  messages.forEach((message) => {
    if (!tsToRow[message.timestamp]) {
      added.push(message);
    }
  });

  const tsToMessage = messages.reduce((hash, message) => {
    hash[message.timestamp] = message;
    return hash;
  }, {});

  rows.forEach((row) => {
    if (!tsToMessage[row.timestamp]) {
      deleted.push(row);
    }
  });

  return { added, deleted };
}

const SLACK_API_URL = 'https://slack.com/api/';
const SLACK_API_TOKEN = Utils.getScriptProperty('slack_api_token');
const SHEET_FILE_ID = Utils.getScriptProperty('sheet_file_id');
const SLACK_CHANNEL_ID = Utils.getScriptProperty('slack_channel_id');

function run() {
  const slackApi = new SlackApi(SLACK_API_URL, SLACK_API_TOKEN);
  const response = slackApi.executeCmd('pins.list', { channel: SLACK_CHANNEL_ID });

  const items = ((response: any): SlackItemsResponse).items;

  // TODO: Currently only supports messages. Support files too.
  const serverRows = [];
  items.forEach((item) => {
    if (item.message) {
      serverRows.push(slackApi.formatMessage(item.message));
    }
  });

  const ss = new SpreadSheetAccessor(SHEET_FILE_ID);
  const sheetRows = ss.readRows();

  const diff = calculateDiff(serverRows, sheetRows);

  diff.added.forEach((message) => {
    const deleted = message.deleted ? '削除済み' : '';
    ss.write([
      `'${message.timestamp}`,
      deleted,
      message.datetime ? message.datetime : '',
      message.user,
      message.text
    ]);
  });

  // TODO: Process deleted.
}
