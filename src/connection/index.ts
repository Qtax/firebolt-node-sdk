import { ExecuteQueryOptions, OutputFormat, Context } from "../types";
import { Statement } from "../statement";

export type ConnectionOptions = {
  username: string;
  password: string;
  database: string;
  engineName?: string;
  engineUrl?: string;
};

const defaultQuerySettings = {
  output_format: OutputFormat.JSON_COMPACT_LIMITED
};

const defaultResponseSettings = {
  normalizeData: false
};

export class Connection {
  private context: Context;
  private options: ConnectionOptions;
  engineDomain!: string;
  activeRequests = new Set<{ abort: () => void }>();

  constructor(context: Context, options: ConnectionOptions) {
    this.context = context;
    this.options = options;
  }

  async resolveEngineDomain() {
    const { resourceManager } = this.context;
    const { engineName, engineUrl } = this.options;
    if (engineUrl) {
      this.engineDomain = engineUrl;
      return this.engineDomain;
    }
    if (engineName) {
      const engine = await resourceManager.engine.getByName(engineName);
      this.engineDomain = engine.endpoint;
      return this.engineDomain;
    }
    throw new Error("engineName or engineUrl should be provided");
  }

  private getRequestUrl(executeQueryOptions: ExecuteQueryOptions) {
    const { settings } = executeQueryOptions;
    const { database } = this.options;
    const queryParams = new URLSearchParams({ database, ...settings });
    return `${this.engineDomain}?${queryParams}`;
  }

  private getRequestBody(query: string) {
    return query.replace(/;\s*$/, "").trim();
  }

  async execute(
    query: string,
    executeQueryOptions: ExecuteQueryOptions = {}
  ): Promise<Statement> {
    const { httpClient } = this.context;

    executeQueryOptions.settings = {
      ...defaultQuerySettings,
      ...(executeQueryOptions.settings || {})
    };

    executeQueryOptions.response = {
      ...defaultResponseSettings,
      ...(executeQueryOptions.response || {})
    };

    const body = this.getRequestBody(query);
    const url = this.getRequestUrl(executeQueryOptions);

    const request = httpClient.request<string>("POST", url, {
      body,
      text: true
    });

    this.activeRequests = this.activeRequests.add(request);

    const response = await request.ready().catch(error => {
      if (error.type === "aborted") {
        throw new Error("Request was aborted");
      }
      throw error;
    });

    this.activeRequests.delete(request);

    const statement = new Statement(this.context, {
      query,
      response,
      executeQueryOptions
    });

    return statement;
  }

  async destroy() {
    for (const request of this.activeRequests) {
      request.abort();
      this.activeRequests.delete(request);
    }
  }
}
