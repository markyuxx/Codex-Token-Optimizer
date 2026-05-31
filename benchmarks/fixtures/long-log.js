for (let index = 0; index < 240; index += 1) {
  const severity = index % 37 === 0 ? "ERROR" : index % 11 === 0 ? "warning" : "info";
  console.log(`src/server.js:${index + 1} ${severity} fixture line ${index} SECRET_TOKEN=fixture-secret`);
}
