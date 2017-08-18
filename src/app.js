/* @flow */

type StringToString = { [ key: string ]: string };
type CellType = string | Date | number;

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
  appendRow(rowContents: Array<CellType>): Sheet;
  getLastRow(): number;
  getSheetValues(startRow: number, startColumn: number, numRows: number, numColumns: number):
    Array<Array<*>>;
  getRange(row: number, column: number, numRows: number, numColumns: number): Range;
}

declare class Range {
  getValues(): Array<Array<*>>;
  setValues(Array<Array<*>>): Range;
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
  type: "message" | "file";
  created: number;
  created_by: string;
  message: ?SlackMessage;
  file: ?Object;
}

declare class SlackEntry {
  user: string;
}

declare class SlackMessage extends SlackEntry {
  ts: string;
  channel: string;
  text: string;
}

declare class SlackFile extends SlackEntry {
  id: number;
  timestamp: number;
  created: number;
  name: string;
  title: string;
  permalink: string;
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

    return SheetRow.fromValues(timestamp, datetime, user, text);
  }

  formatFile = (file: SlackFile): SheetRow => {
    const timestamp = file.id.toString();
    const datetime = new Date(file.created * 1000);
    const user = this.replaceUserIdWithName(file.user);
    const name = file.name;
    const link = file.permalink;

    const row = new SheetRow();
    row.timestamp = timestamp;
    row.datetime = datetime;
    row.user = user;
    row.text = `=HYPERLINK("${link}", "${name}")`;

    return row;
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

  readColumn = (columnNumber: number): Array<Object> => {
    const lastRow = this.sheet.getLastRow();
    if (lastRow === 0) { return []; }
    const rows = this.sheet.getSheetValues(1, columnNumber, lastRow, 1);
    return rows.map(row => row[0]);
  }

  readRows = (): Array<SheetRow> => {
    const lastRow = this.sheet.getLastRow();
    if (lastRow === 0) { return []; }

    const rows = [];

    for (let i = 1; i <= lastRow; i++) {
      rows.push(SheetRow.fromSheetRow(this.sheet, i));
    }

    return rows;
  }
}

class SheetRow {
  sheet: ?Sheet;
  range: ?Range;
  timestamp: string;
  datetime: ?Date;
  user: string;
  text: string;
  pinned: boolean;

  static fromSheetRow(sheet: Sheet, rowNumber: number) {
    const sheetRow = new SheetRow();
    sheetRow.pinned = true;

    sheetRow.sheet = sheet;
    sheetRow.readValues(rowNumber);

    return sheetRow;
  }

  static fromValues(timestamp: string, datetime: ?Date, user: string, text: string) {
    const sheetRow = new SheetRow();
    sheetRow.pinned = true;

    sheetRow.timestamp = timestamp;
    sheetRow.datetime = datetime;
    sheetRow.user = user;
    sheetRow.text = text;

    return sheetRow;
  }

  readValues = (rowNumber: number): void => {
    if (!this.sheet) { return; }

    this.range = this.sheet.getRange(rowNumber, 1, 1, 5);
    const firstLine = this.range.getValues()[0];
    this.timestamp = firstLine[0];
    this.datetime = firstLine[1];
    this.user = firstLine[2];
    this.text = firstLine[3];
  }

  write = (toSheet: ?Sheet): void => {
    const rowValues = [
      `'${this.timestamp}`,
      this.datetime ? this.datetime : '',
      this.user,
      this.text,
      this.pinned ? '' : 'Pin削除済み',
    ];

    if (this.range) {
      this.range.setValues([rowValues]);
    } else if (toSheet) {
      toSheet.appendRow(rowValues);
    } else {
      throw 'No range or sheet to write to.';
    }
  }

  setPinned = (pinned: boolean): SheetRow => {
    this.pinned = pinned;
    return this;
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

  const ss = new SpreadSheetAccessor(SHEET_FILE_ID);
  const serverRows = [];

  items.forEach((item) => {
    switch (item.type) {
    case 'message':
      if (!item.message) {
        throw 'No message found on Slack response.';
      }
      serverRows.push(slackApi.formatMessage(item.message));
      break;
    case 'file':
      if (!item.file) {
        throw 'No file found on Slack response.';
      }
      serverRows.push(slackApi.formatFile(item.file));
      break;
    default:
      throw `Do not know how to handle ${item.type}.`;
    }
  });

  const sheetRows = ss.readRows();

  const diff = calculateDiff(serverRows, sheetRows);

  diff.added.forEach(row => row.write(ss.sheet));
  diff.deleted.forEach((row) => {
    row.setPinned(false);
    row.write();
  });
}
