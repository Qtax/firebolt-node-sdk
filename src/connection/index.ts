import JSONbig from "json-bigint";
import { isDataQuery } from "../common/util";
import { Context } from "../context";
import { Parameter } from "../paramter";
import { normalizeResponse } from "./normalizeResponse";
import { QueryResponse, QuerySettings } from "./types";

export type ConnectionOptions = {
  username: string;
  password: string;
  database: string;
  engineName?: string;
  engineUrl?: string;
};

type ExecuteQueryOptions = {
  settings?: QuerySettings;
  paramters?: Parameter[];
};

const defaultQuerySettings = {
  output_format: "FB_JSONCompactLimited"
};

export class Connection {
  context: Context;
  options: ConnectionOptions;

  constructor(context: Context, options: ConnectionOptions) {
    this.context = context;
    this.options = options;
  }

  private async resolveEngineDomain() {
    const { resourceManager } = this.context;
    const { engineName, engineUrl } = this.options;
    if (engineUrl) {
      return engineUrl;
    }
    if (engineName) {
      try {
        const engine = await resourceManager.engine.getByName(engineName);
        return engine.endpoint;
      } catch (error) {
        throw new Error(`unable to retrieve engine endpoint: ${error}`);
      }
    }
    throw new Error("engineName or engineUrl should be provided");
  }

  private async getRequestUrl(settings: QuerySettings) {
    const { database } = this.options;
    const querySettings = { ...defaultQuerySettings, ...settings };
    const queryParams = new URLSearchParams({ database, ...querySettings });
    const engineDomain = await this.resolveEngineDomain();
    return `${engineDomain}?${queryParams}`;
  }

  private getRequestBody(query: string) {
    return query.replace(/;\s*$/, "").trim();
  }

  private parseResponse(response: string, { query }: { query: string }) {
    const { logger } = this.context;
    try {
      const parsed = JSONbig.parse(response);
      const { data, meta, statistics } = parsed;
      return {
        data,
        meta,
        statistics
      };
    } catch (e) {
      logger.log("Failed to parse response");
      logger.log(e);
      const isData = isDataQuery(query);
      if (isData || (response.length && !isData)) {
        throw new Error("Query failed - internal execution error");
      }
      return {
        data: null,
        meta: null,
        statistics: null
      };
    }
  }

  async execute(
    query: string,
    executeQueryOptions: ExecuteQueryOptions = {}
  ): Promise<QueryResponse> {
    const { httpClient } = this.context;
    const { settings = {} } = executeQueryOptions;

    const body = this.getRequestBody(query);
    const url = await this.getRequestUrl(settings);

    const response: string = await httpClient.request("POST", url, {
      body,
      text: true
    });

    const parsed = this.parseResponse(response, { query });
    const normalized = normalizeResponse(parsed, settings);

    const { data, meta, statistics } = normalized;
    console.log("data", data);
    console.log("meta", meta);
    console.log("stats", statistics);
    return normalized;
  }
}
