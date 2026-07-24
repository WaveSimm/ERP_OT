"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export default function PostMarkdownView({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-headings:font-bold prose-a:text-blue-600 prose-img:rounded-lg prose-pre:bg-gray-50 prose-pre:text-gray-800 prose-code:text-pink-600 prose-code:before:content-none prose-code:after:content-none dark:prose-invert dark:prose-a:text-blue-400 dark:prose-pre:bg-gray-800 dark:prose-pre:text-gray-200 dark:prose-code:text-pink-400">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
