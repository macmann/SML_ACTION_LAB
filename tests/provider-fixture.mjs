import { readFileSync } from "node:fs";
import { createServer } from "node:https";

createServer({
  cert: readFileSync("/fixture/cert.pem"),
  key: readFileSync("/fixture/key.pem"),
}, (req, res) => {
  if (req.method !== "GET" || req.headers.authorization !== "Bearer " + process.env.SLM_TEST_PROVIDER_KEY) {
    res.writeHead(401).end();
    return;
  }
  if (req.url === "/redirect/models/fixture") {
    res.writeHead(302, { Location: "https://model-fixture:8443/v1/models/fixture" }).end();
    return;
  }
  if (req.url === "/v1/models/fixture") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "fixture" }));
    return;
  }
  res.writeHead(404).end();
}).listen(8443, "0.0.0.0");
