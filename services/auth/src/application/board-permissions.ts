import type { AuthUserContext, BoardAudience } from "../domain/board.types";

export interface PermissionBoard {
  writeRoles: string[];
  readAudience: BoardAudience;
  audienceTargetId: string | null;
  allowComments: boolean;
}

export interface PermissionPost {
  authorId: string;
  isDeleted: boolean;
  // 보안 일괄패치 PDCA Layer 4 (NEW-3): post 단위 부서 타겟팅
  targetDepartmentId?: string | null;
}

export function canRead(board: PermissionBoard, post: PermissionPost, user: AuthUserContext): boolean {
  if (post.isDeleted && user.role !== "ADMIN") return false;

  // 보안 일괄패치 PDCA Layer 4 (NEW-3): post.targetDepartmentId가 설정되면 해당 부서 + ADMIN + 작성자만 읽기
  if (post.targetDepartmentId) {
    if (user.role === "ADMIN") return true;
    if (post.authorId === user.id) return true; // 작성자 본인은 항상 읽기
    if (user.departmentId === post.targetDepartmentId) return true;
    return false;
  }

  switch (board.readAudience) {
    case "ALL":
      return true;
    case "DEPARTMENT":
      return user.role === "ADMIN" || (!!user.departmentId && user.departmentId === board.audienceTargetId);
    case "ROLE":
      return user.role === "ADMIN" || user.role === board.audienceTargetId;
  }
}

export function canWrite(board: PermissionBoard, user: AuthUserContext): boolean {
  return board.writeRoles.includes(user.role);
}

export function canEdit(post: PermissionPost, user: AuthUserContext): boolean {
  if (post.isDeleted && user.role !== "ADMIN") return false;
  return user.role === "ADMIN" || post.authorId === user.id;
}

export function canDelete(post: PermissionPost, user: AuthUserContext): boolean {
  return canEdit(post, user);
}

export function canPin(post: PermissionPost, user: AuthUserContext): boolean {
  return user.role === "ADMIN" || post.authorId === user.id;
}

export function canComment(board: PermissionBoard, user: AuthUserContext): boolean {
  return board.allowComments && user.role !== "VIEWER";
}
