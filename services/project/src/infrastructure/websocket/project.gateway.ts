import { Server as SocketServer } from "socket.io";

export type ProjectEventName =
  | "project:created"
  | "project:updated"
  | "project:deleted"
  | "project:cloned"
  | "task:created"
  | "task:updated"
  | "task:deleted"
  | "segment:created"
  | "segment:updated"
  | "segment:deleted"
  | "cpm:completed"
  | "comment:created"
  | "comment:updated"
  | "comment:deleted"
  | "attachment:created"
  | "attachment:deleted"
  | "mention:created"
  | "activity:created"
  | "dashboard:new_critical_issue"
  | "dashboard:issue_resolved"
  | "dashboard:project_updated"
  | "dashboard:refresh_complete";

export class ProjectGateway {
  private io: SocketServer | null = null;

  setServer(io: SocketServer): void {
    this.io = io;

    io.on("connection", (socket) => {
      // 프로젝트 룸 구독
      socket.on("subscribe:project", (projectId: string) => {
        socket.join(`project:${projectId}`);
      });

      socket.on("unsubscribe:project", (projectId: string) => {
        socket.leave(`project:${projectId}`);
      });

      // 대시보드 룸 구독
      socket.on("subscribe:dashboard", () => {
        socket.join("dashboard:all");
      });

      // 개인 룸
      socket.on("subscribe:user", (userId: string) => {
        socket.join(`user:${userId}`);
      });
    });
  }

  emitToProject(projectId: string, event: ProjectEventName, data: Record<string, unknown>): void {
    this.io?.to(`project:${projectId}`).emit(event, data);
    // 대시보드도 주요 이벤트 수신
    this.io?.to("dashboard:all").emit(event, data);
  }

  emitToAll(event: ProjectEventName, data: Record<string, unknown>): void {
    this.io?.emit(event, data);
  }

  emitToUser(userId: string, event: ProjectEventName, data: Record<string, unknown>): void {
    this.io?.to(`user:${userId}`).emit(event, data);
  }
}
