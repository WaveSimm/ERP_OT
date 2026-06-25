"use client";

// 라우트 진입점 — 실제 화면은 _components/TransactionsView (페이지 겸 컴포넌트 분리).
//   me/dashboard 등에서 커스텀 props로 재사용하므로 컴포넌트는 비라우트 위치(_components)에 둠.
import { TransactionsView } from "../_components/TransactionsView";

export default function TransactionsPage() {
  return <TransactionsView />;
}
