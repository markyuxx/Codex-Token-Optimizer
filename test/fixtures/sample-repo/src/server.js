const express = require("express");

function startServer() {
  const app = express();
  app.get("/hello", (_req, res) => {
    res.send("hello");
  });
  return app;
}

module.exports = { startServer };
