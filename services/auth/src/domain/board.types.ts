// 게시판 도메인 공용 타입

export type BoardAudience = "ALL" | "DEPARTMENT" | "ROLE";

export interface AuthUserContext {
  id: string;
  role: string;
  departmentId?: string | null;
}

export interface BoardSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  writeRoles: string[];
  readAudience: BoardAudience;
  audienceTargetId: string | null;
  allowComments: boolean;
  allowAttachments: boolean;
  postPinnable: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface PostListItemDto {
  id: string;
  title: string;
  summary: string;
  isPinned: boolean;
  priority: number;
  publishedAt: Date;
  expiresAt: Date | null;
  viewCount: number;
  commentCount: number;
  attachmentCount: number;
  isRead: boolean;
  author: { id: string; name: string };
  publishingDepartment: { id: string; name: string } | null;
  board: { code: string; name: string };
}

export interface PostDetailDto extends Omit<PostListItemDto, "summary"> {
  content: string;
  attachments: AttachmentDto[];
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  isInline: boolean;
  url: string;
  uploadedAt: Date;
}

export interface CommentDto {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  content: string;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  children?: CommentDto[];
}

export interface FeedItemDto {
  id: string;
  title: string;
  summary: string;
  isPinned: boolean;
  priority: number;
  publishedAt: Date;
  isRead: boolean;
  boardCode: string;
  boardName: string;
  authorName: string;
}
