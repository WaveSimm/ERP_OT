// 게시판 등에서 쓰는 공용 아이콘 — heroicons/lucide outline 스타일.
// 이모지(📌👁📎💬) 대신 사용해 색(currentColor)·크기·굵기를 주변 텍스트와 통일한다.
// 크기는 className으로 조절(기본 w-3.5 h-3.5). 텍스트 라인에 자연스럽게 흐르도록 inline + baseline 보정.

interface IconProps {
  className?: string;
}

function svgProps(className: string) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    className: `inline align-[-0.125em] shrink-0 ${className}`,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.8,
    "aria-hidden": true as const,
  };
}

/** 고정핀 (기존 📌) */
export function PinIcon({ className = "w-3.5 h-3.5" }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 17v5" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
      />
    </svg>
  );
}

/** 조회수 (기존 👁) */
export function EyeIcon({ className = "w-3.5 h-3.5" }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

/** 첨부파일 (기존 📎) — 세로형 클립 */
export function PaperclipIcon({ className = "w-3.5 h-3.5" }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 8.5v7a4 4 0 0 1-8 0V7a2.5 2.5 0 0 1 5 0v8a1 1 0 0 1-2 0V8.5"
      />
    </svg>
  );
}

/** 검색 (기존 🔍) */
export function SearchIcon({ className = "w-3.5 h-3.5" }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

// ── 파일 종류 아이콘 (첨부파일 목록) ─────────────────────────────────
// 공통 문서 외곽(접힌 모서리) + 종류별 내부 표시. 전부 무채색 currentColor.
const DOC_BODY = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z";
const DOC_CORNER = "M14 2v4a1 1 0 0 0 1 1h5";

/** 파일 (첨부파일 공통 — 종류 구분 없이 하나로 통일) */
export function FileIcon({ className = "w-3.5 h-3.5" }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path strokeLinecap="round" strokeLinejoin="round" d={DOC_BODY} />
      <path strokeLinecap="round" strokeLinejoin="round" d={DOC_CORNER} />
    </svg>
  );
}

/** 댓글 (기존 💬) */
export function CommentIcon({ className = "w-3.5 h-3.5" }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z"
      />
    </svg>
  );
}
