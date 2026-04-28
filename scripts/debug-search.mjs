// Debug: Show real embed_score, exact_bonus, trgm_score, final_score for a given query
import { execFileSync } from "node:child_process";

const QUERY = process.argv[2] || "메인보드";

const r = await fetch("http://localhost:11434/api/embed", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "bge-m3", input: QUERY }),
});
const d = await r.json();
const vec = d.embeddings[0];
const literal = `[${vec.join(",")}]`;

const sql = `
SELECT substr(p.title,1,30) AS title,
  ROUND((1 - (p.embedding <=> '${literal}'::vector))::numeric, 3) AS embed,
  (CASE WHEN p.title ILIKE '%${QUERY}%' THEN 0.30 ELSE 0 END
   + CASE WHEN p.content ILIKE '%${QUERY}%' THEN 0.15 ELSE 0 END) AS exact,
  ROUND(GREATEST(
    COALESCE(similarity(p.title,   '${QUERY}'), 0) * 0.20,
    COALESCE(similarity(p.content, '${QUERY}'), 0) * 0.10
  )::numeric, 3) AS trgm,
  ROUND((
    (1 - (p.embedding <=> '${literal}'::vector)) * 0.6
    + GREATEST(
        (CASE WHEN p.title ILIKE '%${QUERY}%' THEN 0.30 ELSE 0 END
         + CASE WHEN p.content ILIKE '%${QUERY}%' THEN 0.15 ELSE 0 END),
        GREATEST(
          COALESCE(similarity(p.title,   '${QUERY}'), 0) * 0.20,
          COALESCE(similarity(p.content, '${QUERY}'), 0) * 0.10
        )
      ) * 0.4
    + CASE WHEN ((CASE WHEN p.title ILIKE '%${QUERY}%' THEN 0.30 ELSE 0 END
         + CASE WHEN p.content ILIKE '%${QUERY}%' THEN 0.15 ELSE 0 END)) > 0
         THEN 0.20 ELSE 0 END
  )::numeric, 3) AS final
FROM public.board_posts p
WHERE p.embedding IS NOT NULL AND p.is_deleted = false
ORDER BY embed DESC LIMIT 8;
`;

const out = execFileSync(
  "docker",
  ["exec", "-i", "erp-ot-postgres", "psql", "-U", "erp_user", "-d", "erp_ot", "-c", sql],
  { encoding: "utf8" },
);
console.log(`[Query: ${QUERY}]`);
console.log(out);
