/* @flow */

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

interface SlackResponse {
  ok: boolean;
  error: ?string;
  items: ?Array<*>;
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

  constructor(slackApiUrl: string, token: string) {
    this.slackApiUrl = slackApiUrl;
    this.token = token;
  }

  executeCmd(path: string, params: { [key: string]: any }): SlackResponse {
    const url = `${SLACK_API_URL}${path}?`;
    const queryParams = [ `token=${encodeURIComponent(API_TOKEN)}` ];

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
}

const SLACK_API_URL = 'https://slack.com/api/';

const API_TOKEN = Utils.getScriptProperty('slack_api_token');

function run() {
  const channelId = Utils.getScriptProperty('slack_channel_id');
  const slackApi = new SlackApi(SLACK_API_URL, API_TOKEN);
  const response: SlackResponse = slackApi.executeCmd('pins.list', { channel: channelId });
  Logger.log(response);
}
