import type { PrismaClient } from "@prisma/client";

/**
 * 자원-모델-분리 Phase 5 (2026-05-13): legacy Resource 테이블 폐기 후 이름 조회 헬퍼.
 * resourceIds 안에 auth_users.id / external_persons.id / equipment_resources.id 가 섞여 있을 수 있음.
 * 세 테이블 병렬 조회 후 단일 Map으로 반환.
 */
export async function resolveResourceNames(
  prisma: PrismaClient,
  resourceIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(resourceIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [authRows, externals, equipments] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM public.auth_users WHERE id = ANY(${ids})
    `,
    prisma.externalPerson.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.equipmentResource.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);

  const map = new Map<string, string>();
  for (const r of authRows) map.set(r.id, r.name);
  for (const r of externals) map.set(r.id, r.name);
  for (const r of equipments) map.set(r.id, r.name);
  return map;
}
