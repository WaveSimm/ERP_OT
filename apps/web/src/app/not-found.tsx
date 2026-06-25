// app-router 404 — 레거시 pages `_error`(<Html> import) 폴백을 차단하고
//   빌드 시 /404 prerender 오류를 방지하기 위한 커스텀 not-found.
export default function NotFound() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "0.75rem" }}>
          페이지를 찾을 수 없습니다 (404)
        </h2>
        <a href="/home" style={{ color: "#2563eb", textDecoration: "underline" }}>홈으로 이동</a>
      </div>
    </div>
  );
}
