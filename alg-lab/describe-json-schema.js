#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const inputPath = path.resolve(process.argv[2] || path.join(__dirname, "getStats.json"));
const ARRAY_SAMPLE_LIMIT = 100;
const RECORD_THRESHOLD = 10;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function schemaKey(schema) {
  if (schema.type === "array") {
    return `array<${schemaKey(schema.items)}>`;
  }

  if (schema.type === "object") {
    return `object:${Object.entries(schema.properties)
      .map(([key, value]) => `${key}${value.optional ? "?" : ""}:${schemaKey(value.schema)}`)
      .sort()
      .join(",")}`;
  }

  if (schema.type === "record") {
    return `record<${schemaKey(schema.values)}>`;
  }

  if (schema.type === "union") {
    return `union:${schema.options.map(schemaKey).sort().join("|")}`;
  }

  return schema.type;
}

function mergeSchemas(schemas) {
  const expanded = [];
  for (const schema of schemas) {
    if (schema.type === "union") {
      expanded.push(...schema.options);
      continue;
    }
    expanded.push(schema);
  }

  const deduped = [];
  const seen = new Set();

  for (const schema of expanded) {
    const key = schemaKey(schema);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(schema);
  }

  if (deduped.length === 1) {
    return deduped[0];
  }

  if (deduped.every((schema) => schema.type === "array")) {
    return {
      type: "array",
      items: mergeSchemas(deduped.map((schema) => schema.items)),
    };
  }

  if (deduped.every((schema) => schema.type === "object")) {
    return mergeObjectSchemas(deduped);
  }

  return {
    type: "union",
    options: deduped.sort((a, b) => schemaKey(a).localeCompare(schemaKey(b))),
  };
}

function mergeObjectSchemas(schemas) {
  const propertyNames = new Set();
  for (const schema of schemas) {
    for (const key of Object.keys(schema.properties)) {
      propertyNames.add(key);
    }
  }

  const properties = {};
  for (const key of propertyNames) {
    const present = schemas.filter((schema) => Object.prototype.hasOwnProperty.call(schema.properties, key));
    properties[key] = {
      optional: present.length < schemas.length,
      schema: mergeSchemas(present.map((schema) => schema.properties[key].schema)),
    };
  }

  return {
    type: "object",
    properties,
  };
}

function inferSchema(value) {
  if (value === null) return { type: "null" };

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: "array", items: { type: "unknown" } };
    }

    const items = value.slice(0, ARRAY_SAMPLE_LIMIT).map(inferSchema);
    return {
      type: "array",
      items: mergeSchemas(items),
    };
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return { type: "object", properties: {} };
    }

    const propertySchemas = {};
    for (const [key, child] of entries) {
      propertySchemas[key] = {
        optional: false,
        schema: inferSchema(child),
      };
    }

    const childSchemas = Object.values(propertySchemas).map((property) => property.schema);
    const allChildObjects = childSchemas.every(
      (schema) => schema.type === "object" || schema.type === "record"
    );

    if (entries.length >= RECORD_THRESHOLD && allChildObjects) {
      return {
        type: "record",
        values: mergeSchemas(
          childSchemas.map((schema) =>
            schema.type === "record" ? schema.values : schema
          )
        ),
      };
    }

    return {
      type: "object",
      properties: propertySchemas,
    };
  }

  return { type: typeof value };
}

function formatSchema(schema, indent = 0) {
  const pad = "  ".repeat(indent);

  if (schema.type === "array") {
    const item = formatSchema(schema.items, indent);
    return `array<${item}>`;
  }

  if (schema.type === "record") {
    const valueSchema = formatSchema(schema.values, indent + 1);
    if (valueSchema.startsWith("{")) {
      return `record<string, ${valueSchema}>`;
    }
    return `record<string, ${valueSchema}>`;
  }

  if (schema.type === "union") {
    return schema.options.map((option) => formatSchema(option, indent)).join(" | ");
  }

  if (schema.type === "object") {
    const keys = Object.keys(schema.properties);
    if (keys.length === 0) return "{}";

    const lines = keys.map((key) => {
      const property = schema.properties[key];
      const valueSchema = formatSchema(property.schema, indent + 1);
      return `${"  ".repeat(indent + 1)}${key}${property.optional ? "?" : ""}: ${valueSchema};`;
    });

    return `{\n${lines.join("\n")}\n${pad}}`;
  }

  return schema.type;
}

function main() {
  const data = readJson(inputPath);
  const schema = inferSchema(data);

  console.log(`File: ${inputPath}`);
  console.log(formatSchema(schema));
}

main();
