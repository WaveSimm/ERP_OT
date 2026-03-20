import { GroupType } from "@prisma/client";

export class GroupEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public type: GroupType,
    public parentGroupId: string | null,
    public sortOrder: number,
    public children: GroupEntity[] = [],
  ) {}

  /** 루트 그룹 여부 */
  get isRoot(): boolean {
    return this.parentGroupId === null;
  }

  /** 주어진 그룹이 이 그룹의 하위에 있는지 (순환 참조 방지용) */
  isAncestorOf(candidateId: string, allGroups: GroupEntity[]): boolean {
    const children = allGroups.filter((g) => g.parentGroupId === this.id);
    for (const child of children) {
      if (child.id === candidateId) return true;
      if (child.isAncestorOf(candidateId, allGroups)) return true;
    }
    return false;
  }
}
