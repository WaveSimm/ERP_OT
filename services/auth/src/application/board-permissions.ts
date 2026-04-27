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
}

export function canRead(board: PermissionBoard, post: PermissionPost, user: AuthUserContext): boolean {
  if (post.isDeleted && user.role !== "ADMIN") return false;
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
