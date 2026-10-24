/**
 * Minimal i18n. CLAUDE.md requires UI copy to go through keys so an English UI
 * can be added later. For now there is a single Japanese dictionary; a richer
 * setup (locale switching, pluralization) can replace this without touching
 * call sites.
 */
const ja = {
  "app.title": "テーマエディタ",
  "toolbar.page": "ページ",
  "toolbar.undo": "元に戻す",
  "toolbar.redo": "やり直す",
  "toolbar.save": "下書きを保存",
  "toolbar.saved": "保存しました",
  "toolbar.unsaved": "未保存の変更",
  "sections.title": "セクション",
  "sections.show": "表示",
  "sections.hide": "非表示",
  "sections.up": "上へ",
  "sections.down": "下へ",
  "settings.title": "設定",
  "settings.empty": "左のセクションを選ぶと、ここで編集できます。",
  "settings.hidden": "このセクションは非表示です。",
  "repeat.add": "項目を追加",
  "repeat.remove": "削除",
  "repeat.item": "項目",
  "preview.title": "プレビュー",
  "content.title": "コンテンツ",
  "content.field.title": "タイトル",
  "content.field.date": "日付",
  "content.field.body": "本文",
  "content.outline": "このページ",
  "content.outline.hint": "右の欄で内容を編集します。",
  "media.title": "メディア",
  "media.import": "画像を取り込む",
  "media.importing": "取り込み中…",
  "media.empty": "まだ画像がありません。「画像を取り込む」から追加してください。",
  "media.close": "閉じる",
  "media.pick": "画像を選択",
  "media.change": "画像を変更",
  "media.clear": "クリア",
} as const;

export type MessageKey = keyof typeof ja;

export function t(key: MessageKey): string {
  return ja[key];
}
