#!/usr/bin/env node
/**
 * Backfill embeddings for board_posts (public schema) and work_logs (project schema).
 *
 * Uses docker exec + psql for DB access (no pg client needed) and global fetch for Ollama.
 *
 * Usage:
 *   node scripts/backfill-embeddings.mjs           # both
 *   node scripts/backfill-embeddings.mjs posts     # posts only
 *   node scripts/backfill-embeddings.mjs worklogs  # worklogs only
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PG_CONTAINER = process.env.PG_CONTAINER || "erp-ot-postgres";
const PG_USER = process.env.PG_USER || "erp_user";
const PG_DB = process.env.PG_DB || "erp_ot";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "bge-m3";
const MAX_INPUT_CHARS = 4000;

function psqlSelect(sql) {
  const out = execFileSync(
    "docker",
    ["exec", "-i", PG_CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB, "-At", "-c", sql],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  return out;
}

function psqlExecFile(sqlFilePath) {
  // Copy file into container then execute it
  const containerPath = `/tmp/backfill-${Date.now()}.sql`;
  execFileSync("docker", ["cp", sqlFilePath, `${PG_CONTAINER}:${containerPath}`], { stdio: "ignore" });
  try {
    execFileSync(
      "docker",
      ["exec", "-i", PG_CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB, "-v", "ON_ERROR_STOP=1", "-f", containerPath],
      { stdio: "ignore" },
    );
  } finally {
    execFileSync("docker", ["exec", "-i", PG_CONTAINER, "rm", "-f", containerPath], { stdio: "ignore" });
  }
}

async function embed(text) {
  const truncated = text.slice(0, MAX_INPUT_CHARS);
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: truncated }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.embeddings || !data.embeddings[0]) {
    throw new Error("No embedding in response");
  }
  return data.embeddings[0];
}

function toLiteral(vec) {
  return `[${vec.join(",")}]`;
}

function fetchPostText(id) {
  // base64-encode the text to avoid shell quoting issues
  const sql = `SELECT encode(convert_to(COALESCE(title,'') || E'\\n\\n' || COALESCE(content,''), 'UTF8'), 'base64') FROM public.board_posts WHERE id = '${id.replace(/'/g, "''")}';`;
  const b64 = psqlSelect(sql).trim();
  return Buffer.from(b64, "base64").toString("utf8");
}

function fetchWorkLogText(id) {
  const sql = `SELECT encode(convert_to(COALESCE(content,''), 'UTF8'), 'base64') FROM project.work_logs WHERE id = '${id.replace(/'/g, "''")}';`;
  const b64 = psqlSelect(sql).trim();
  return Buffer.from(b64, "base64").toString("utf8");
}

function updatePostEmbedding(id, vec) {
  const literal = toLiteral(vec);
  const tmpFile = join(tmpdir(), `bf-post-${id}.sql`);
  const sql = `UPDATE public.board_posts SET embedding = '${literal}'::vector, embedded_at = NOW() WHERE id = '${id.replace(/'/g, "''")}';\n`;
  writeFileSync(tmpFile, sql);
  try { psqlExecFile(tmpFile); } finally { unlinkSync(tmpFile); }
}

function updateWorkLogEmbedding(id, vec) {
  const literal = toLiteral(vec);
  const tmpFile = join(tmpdir(), `bf-wl-${id}.sql`);
  const sql = `UPDATE project.work_logs SET embedding = '${literal}'::vector, embedded_at = NOW() WHERE id = '${id.replace(/'/g, "''")}';\n`;
  writeFileSync(tmpFile, sql);
  try { psqlExecFile(tmpFile); } finally { unlinkSync(tmpFile); }
}

async function backfillPosts() {
  const idsRaw = psqlSelect(
    `SELECT id FROM public.board_posts WHERE embedding IS NULL AND is_deleted = false ORDER BY published_at DESC NULLS LAST LIMIT 1000;`,
  );
  const ids = idsRaw.split("\n").map((s) => s.trim()).filter(Boolean);
  console.log(`[posts] ${ids.length} rows to embed`);
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      const text = fetchPostText(id);
      if (!text) { fail++; console.log(`\n[posts] empty text ${id}`); continue; }
      const vec = await embed(text);
      updatePostEmbedding(id, vec);
      ok++;
      process.stdout.write(".");
    } catch (e) {
      fail++;
      console.log(`\n[posts] failed ${id}: ${e.message}`);
    }
  }
  console.log(`\n[posts] done — ok=${ok}, fail=${fail}`);
}

async function backfillWorkLogs() {
  const idsRaw = psqlSelect(
    `SELECT id FROM project.work_logs WHERE embedding IS NULL AND is_deleted = false ORDER BY worked_at DESC LIMIT 5000;`,
  );
  const ids = idsRaw.split("\n").map((s) => s.trim()).filter(Boolean);
  console.log(`[worklogs] ${ids.length} rows to embed`);
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      const text = fetchWorkLogText(id);
      if (!text) { fail++; console.log(`\n[worklogs] empty text ${id}`); continue; }
      const vec = await embed(text);
      updateWorkLogEmbedding(id, vec);
      ok++;
      process.stdout.write(".");
    } catch (e) {
      fail++;
      console.log(`\n[worklogs] failed ${id}: ${e.message}`);
    }
  }
  console.log(`\n[worklogs] done — ok=${ok}, fail=${fail}`);
}

async function main() {
  const target = process.argv[2] || "all";
  if (target === "all" || target === "posts") await backfillPosts();
  if (target === "all" || target === "worklogs") await backfillWorkLogs();
}

main().catch((e) => { console.error(e); process.exit(1); });
