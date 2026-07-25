"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import styles from "./phase6.module.css";

function asDocument(text: string) {
  return {
    type: "doc",
    content: text
      .split(/\n{2,}/)
      .map((paragraph) => ({
        type: "paragraph",
        content: paragraph
          ? [{ type: "text", text: paragraph.replace(/\n/g, " ") }]
          : undefined,
      })),
  };
}

export function ReportTextEditor({
  value,
  editable,
  title = false,
  onFocus,
  onCommit,
}: {
  value: string;
  editable: boolean;
  title?: boolean;
  onFocus?: () => void;
  onCommit: (value: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        horizontalRule: false,
      }),
    ],
    content: asDocument(value),
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": title ? "보고서 제목 편집" : "보고서 문단 편집",
      },
    },
    onFocus,
    onBlur: ({ editor: currentEditor }) => {
      const next = currentEditor.getText({ blockSeparator: "\n\n" }).trim();
      if (next !== value.trim()) onCommit(next);
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.getText({ blockSeparator: "\n\n" }).trim();
    if (current !== value.trim()) {
      editor.commands.setContent(asDocument(value), {
        emitUpdate: false,
      });
    }
  }, [editor, value]);

  return (
    <div
      className={`${styles.editorSurface} ${title ? styles.editorSurfaceTitle : ""}`}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
