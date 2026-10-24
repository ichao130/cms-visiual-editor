import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

/**
 * Tiptap-based rich text editor for content bodies. Stores HTML. Inline images
 * go through the dedicated image fields / gallery (which resolve media paths),
 * so this toolbar focuses on text structure and links.
 */
export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || "",
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // Sync when the bound value changes elsewhere (e.g. switching content items).
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || "", false);
    }
  }, [value, editor]);

  if (!editor) return null;

  const toggleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("リンク先URL");
    if (url) editor.chain().focus().setLink({ href: url }).run();
  };

  const is = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs) ? " is-active" : "";

  return (
    <div className="pcms-rte">
      <div className="pcms-rte__toolbar">
        <button type="button" className={`pcms-rte__btn${is("bold")}`} onClick={() => editor.chain().focus().toggleBold().run()}>
          <b>B</b>
        </button>
        <button type="button" className={`pcms-rte__btn${is("italic")}`} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <i>I</i>
        </button>
        <span className="pcms-rte__sep" />
        <button type="button" className={`pcms-rte__btn${is("heading", { level: 2 })}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </button>
        <button type="button" className={`pcms-rte__btn${is("heading", { level: 3 })}`} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          H3
        </button>
        <span className="pcms-rte__sep" />
        <button type="button" className={`pcms-rte__btn${is("bulletList")}`} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          • リスト
        </button>
        <button type="button" className={`pcms-rte__btn${is("orderedList")}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1. リスト
        </button>
        <button type="button" className={`pcms-rte__btn${is("blockquote")}`} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          引用
        </button>
        <span className="pcms-rte__sep" />
        <button type="button" className={`pcms-rte__btn${is("link")}`} onClick={toggleLink}>
          リンク
        </button>
      </div>
      <EditorContent className="pcms-rte__content" editor={editor} />
    </div>
  );
}
