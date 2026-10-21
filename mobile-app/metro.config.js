const http = require("node:http");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const gatewayPort = 8000;
const proxiedPaths = new Set(["/v1/diagnoses", "/health/ready"]);

config.server.enhanceMiddleware = (metroMiddleware) => {
  return (request, response, next) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (!proxiedPaths.has(pathname)) {
      return metroMiddleware(request, response, next);
    }

    const headers = { ...request.headers, host: `127.0.0.1:${gatewayPort}` };
    delete headers.connection;
    delete headers["proxy-connection"];

    const gatewayRequest = http.request(
      {
        hostname: "127.0.0.1",
        port: gatewayPort,
        method: request.method,
        path: request.url,
        headers,
      },
      (gatewayResponse) => {
        response.statusCode = gatewayResponse.statusCode || 502;
        for (const [name, value] of Object.entries(gatewayResponse.headers)) {
          if (value !== undefined && !["connection", "keep-alive"].includes(name)) {
            response.setHeader(name, value);
          }
        }
        gatewayResponse.pipe(response);
      },
    );

    gatewayRequest.on("error", () => {
      if (!response.headersSent) {
        response.statusCode = 502;
        response.setHeader("content-type", "application/json");
      }
      response.end(
        JSON.stringify({
          error: {
            code: "LOCAL_GATEWAY_UNAVAILABLE",
            message: "The SnapLens Gateway is not running on this computer.",
          },
        }),
      );
    });

    request.pipe(gatewayRequest);
  };
};

module.exports = config;
