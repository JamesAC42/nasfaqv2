#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");

const DATA_URL = "https://nasfaq.biz/api/getStats";
const OUTPUT_PATH = path.join(__dirname, "getStats.json");
const TEMP_OUTPUT_PATH = `${OUTPUT_PATH}.tmp`;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function downloadJson(url, destinationPath, tempPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Request failed with status ${response.statusCode}`));
        return;
      }

      const contentType = response.headers["content-type"] || "";
      if (!contentType.includes("application/json")) {
        console.warn(`Unexpected content-type: ${contentType}`);
      }

      const output = fs.createWriteStream(tempPath);

      output.on("error", reject);
      response.on("error", reject);

      response.pipe(output);

      output.on("finish", () => {
        output.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }

          fs.rename(tempPath, destinationPath, (renameError) => {
            if (renameError) {
              reject(renameError);
              return;
            }

            resolve(destinationPath);
          });
        });
      });
    });

    request.on("error", reject);
    request.setTimeout(120000, () => {
      request.destroy(new Error("Request timed out after 120000ms"));
    });
  });
}

downloadJson(DATA_URL, OUTPUT_PATH, TEMP_OUTPUT_PATH)
  .then((savedPath) => {
    console.log(`Saved ${DATA_URL} to ${savedPath}`);
  })
  .catch((error) => {
    fs.rm(TEMP_OUTPUT_PATH, { force: true }, () => {
      fail(`Failed to download stats: ${error.message}`);
    });
  });
