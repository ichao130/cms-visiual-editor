# CLAUDE.md

このリポジトリは、HTMLを出力するデスクトップCMS（製品名は **KUMITO**。コード上の仮名は `pcms`）の開発用です。
仕様の正本は企画・仕様書（Claude Docs）です。このファイルには、実装で迷わないための決定事項と約束事だけを書いています。仕様書と食い違う場合は、作業を止めて確認してください。

## プロダクトの要点

- WordPressのように使え、Shopifyのテーマエディタのように簡単に編集でき、出力は静的HTMLだけのCMS
- **PHPは一切使わない**。エンジン、テーマ、出力のどこにも登場させない
- **GUIで完結**させる。利用者にCLIやコードを書かせる機能は作らない
- **AIは下書きと提案だけ**を行う。AIの変更は必ず差分をプレビューで見せ、人が「適用／別の案／取り消し」を選ぶ
- 立ち位置は **案A：デスクトップアプリが本体で、クラウドは最小限**
  - クラウド（Firebase）に置くのは、アカウント、AIプロキシ、フォーム受信、課金、暗号化バックアップだけ
  - **サーバーの接続情報（FTPパスワードなど）はクラウドに送らない・保存しない**。各PCの中だけに置く
- 対応OS：macOS、Windows 10/11、Linux（デスクトップ基盤は Electron）

## 技術スタック

| 領域 | 採用 |
| --- | --- |
| 言語 | TypeScript（strict） |
| パッケージ管理 | pnpm workspaces（モノレポ） |
| デスクトップ | Electron、electron-builder、electron-updater |
| UI | React |
| エディタの記事本文 | ブロックエディタ（自作。HTMLを保存・出力。engine の `blocksToHtml`/`htmlToBlocks` で HTML⇄ブロック変換） |
| クラウド | Firebase（Authentication、Firestore、Cloud Storage、Cloud Functions、App Check）。重い処理だけ Cloud Run |
| 課金 | Stripe（Firebase拡張機能） |
| テスト | Vitest（ユニット）、Playwright（エディタ・Electronの操作） |
| CI | GitHub Actions（テスト、macOS／Windows／Linuxのビルド） |

新しい依存パッケージを追加するときは、理由を一言そえて提案してから入れること。

## リポジトリ構成

```
packages/
  engine/       テーマ解析・レンダラ・静的サイト生成。Node/Electron/DOMに依存しない純粋なTS
  editor-ui/    3カラムのテーマエディタ、管理画面（React）
  deploy/       FTP/FTPS/SFTP、Cloudflare Pages、Netlify、S3 への差分送信
  shared/       型定義（サイトデータ、テーマ、投稿タイプなど）
apps/
  desktop/      Electron本体（main / preload / renderer）
firebase/
  functions/    AIプロキシ、フォーム受信、課金のWebhook
  firestore.rules
  storage.rules
themes/
  sample-cafe/  動作確認用のサンプルテーマ
fixtures/
  html/         AIテーマ化・パーサ検証用のHTMLテンプレート集
docs/
  spec.md       仕様書の書き出し（参照用）
```

### 境界のルール

- `packages/engine` は **ブラウザでもNodeでも動くこと**。`fs`、`electron`、`window` を直接使わない。ファイルの読み書きは引数で渡されるインターフェース経由にする（将来のWeb更新＝案Bでも同じエンジンを使うため）
- `packages/editor-ui` は Electron の API を直接呼ばない。`window.pcms`（preloadで公開するAPI）だけを使う
- Electron固有の処理（ファイル保存、送信、鍵の保管、OSダイアログ）は `apps/desktop/src/main` に閉じ込める

## よく使うコマンド（リポジトリ作成時に整備する）

```
pnpm install
pnpm dev                 # Electronアプリを開発モードで起動
pnpm test                # 全パッケージのVitest
pnpm test:e2e            # Playwright
pnpm lint && pnpm typecheck
pnpm build               # 手元のOS向けにビルド
pnpm firebase:emu        # Firebaseエミュレーター起動
pnpm sftp:test           # Dockerでテスト用SFTPサーバーを起動
```

作業を終える前に、`pnpm lint`、`pnpm typecheck`、関係するテストを必ず通すこと。

## テーマ仕様（初版）

テーマは「普通のHTMLに `data-*` 属性を足したもの」。設定ファイルがなくても動くこと。

```
my-theme/
  theme.json       任意。テーマ名、色・フォント・余白のプリセット
  layout.html      任意。共通のヘッダー・フッター（中身は data-slot="content" に入る）
  templates/       index.html / page.html / post.html / archive.html / <投稿タイプ>.html など
  sections/        任意。再利用できるセクション
  assets/          CSS、JS、画像
```

| 属性 | 役割 |
| --- | --- |
| `data-section` | エディタで並び替え・追加・非表示できる単位 |
| `data-field` | 編集できる項目。型は要素から自動判定（h1〜p=text、img=image、a=link、子要素を持つdiv=richtext） |
| `data-type` | 型の明示（text / richtext / image / link / color / number / select） |
| `data-label` | エディタに表示する項目名 |
| `data-loop` | 投稿などの繰り返し（`data-loop="posts" data-limit="3"`、`data-loop="menu"`） |
| `data-repeat` | 運用者が増減できる繰り返し（FAQ、スライドなど） |
| `data-if` | 値が空なら要素ごと出さない |
| `data-slot` | layout.html で各ページの中身が入る場所 |

- 投稿やカスタムフィールドの値は `data-field="post.title"`、`data-field="post.price"` のように参照する
- 繰り返しや条件分岐で属性だけでは足りない場合に限り、Liquid風の最小限の記法を検討する（導入前に相談）
- テーマ取り込み（実装済み）：WordPress/Shopify/HTML などのテンプレートを貼り付け・アップロードすると、PHP・テンプレート記法（{{ }} / {% %} / <% %>）・スクリプト・イベント属性を除去し、本文を抽出して `data-*` 付きのセクションに最適化する（engine の `importThemeHtml`、テーマ画面の「取り込み」）。保存先は作業コピーのセクションで、テーマ元ファイルには触れない。WordPressブロックテーマ（block.json/PHPを伴う完全なテーマ）の取り込みは引き続き「拡張」フェーズ

## サイトデータの保存形式

テーマのファイルは**絶対に書き換えない**。運用者の変更はすべてサイト側に保存する。

```
<site>/
  site.json               サイト名、ロゴ、OGP既定値、パーマリンク形式、確認タグなど
  settings.json           ページごとのセクション構成と値、テーマ設定（色・フォント）
  content-types.json      カスタム投稿タイプとカスタムフィールドの定義
  content/<タイプ>/<スラッグ>.md   投稿。フィールドは先頭のメタ情報（YAML）
  media/                  画像など（取り込み時に圧縮・WebP化）
  redirects.json          URL変更時に自動追加
  .pcms/history/          変更履歴・公開履歴（ロールバック用）
```

- JSON と Markdown だけで完結させ、利用者がいつでも持ち出せる状態を保つ
- スキーマを変えるときは、`shared` の型と移行処理（バージョン番号付き）を同時に用意する

## 静的生成とデプロイ

- 生成は**差分**で行う。変更されたページと、影響を受けるページ（一覧、関連記事、サイトマップなど）だけを作り直す
- 毎回出力するもの：`sitemap.xml`、`robots.txt`、RSS、404ページ、構造化データ（パンくず・記事・店舗/会社情報）
- 公開の流れ：公開前チェック → 前回公開との差分表示 → 差分だけ送信 → 公開履歴に記録
- 送信の途中で失敗したら、自動で直前の状態に戻す。履歴からは1クリックでロールバックできること
- 削除するのは「前回このアプリが公開したファイル」だけ。サーバー上の、このアプリが置いていないファイルには触れない

## カスタム投稿・カスタムフィールド

- 投稿タイプ、分類（カテゴリ・タグ・独自分類）、フィールドはすべてGUIから定義する
- フィールドの型：テキスト、長文、リッチテキスト、数値、日付・日時、画像、ギャラリー、リンク、ファイル、選択肢（単一・複数）、チェック、繰り返しグループ、関連付け
- 各フィールドに、必須、初期値、説明、表示条件を設定できる
- テーマに専用テンプレートがない投稿タイプは、汎用テンプレートで表示する

## お問い合わせフォーム

- 静的サイトからの送信は、Firebase の Cloud Functions で受け取る（PHP は使わない）
- 機能：GUIのフォームビルダー、通知メール（複数宛先）、自動返信、完了ページ、受信一覧、CSV書き出し
- スパム対策：Cloudflare Turnstile または reCAPTCHA、ハニーポット、送信回数の制限
- 個人情報：同意チェック、保存期間の設定、「保存せずメール転送だけ」の設定。受信データはサイトの所有者以外が読めないこと

## AI

- AIの呼び出しは必ず Firebase Functions のプロキシ経由。**APIキーをアプリに埋め込まない**
- 利用者は「利用枠の購入」と「自前のAPIキー登録」のどちらも選べる。自前キーは `safeStorage` で暗号化してPC内に保存する
- ユーザーごとの利用量を記録し、上限を超えたら止める
- AIに渡すのは、その操作に必要な部分だけ。サーバー接続情報や、フォームの受信データは渡さない
- AIの出力は必ず検証してから使う（属性名、型、HTMLとして壊れていないか）。不正なら適用しない

## セキュリティ（Electron）

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` を守る
- renderer から呼べるのは preload で公開した最小限の API だけ。任意のパスを読む、任意のコマンドを実行する、といった汎用APIは作らない
- プレビューに表示するサイトやテーマのHTMLは**信頼しないコンテンツ**として扱う。エディタ本体とは別の、権限のない表示領域で描画する
- サーバー接続情報は `safeStorage`（OSのキーチェーン等）で暗号化して保存する。ログやエラーレポートに出さない
- Firestore と Storage のセキュリティルールは、機能を追加するたびにエミュレーター上のテストで検証する

## コーディング規約

- UIの文言は日本語。コード上の識別子・コメントは英語でよい
- 文言は i18n のキー経由で書く（将来の英語UIのため）
- エラーは利用者向けの日本語メッセージと、開発者向けの詳細を分けて持つ
- エンジンの変更には、入力HTMLと期待する出力HTMLの組（スナップショットテスト）を必ず追加する
- 1つの変更は1つの目的に絞る。仕様にない機能を勝手に足さない

## 開発の順番（MVP）

1. **検証**：テーマ形式の確定、`engine` のパーサとレンダラ、`themes/sample-cafe` を1サイトとして生成、テスト用SFTPへ公開
2. **エディタ**：3カラムのテーマエディタ（セクション一覧・ライブプレビュー・設定パネル）、元に戻す／やり直す、下書き保存
3. **コンテンツ**：記事、固定ページ、カスタム投稿・カスタムフィールド、メディア、メニュー
4. **公開**：差分デプロイ、公開履歴とロールバック、SEOの自動出力、公開前チェック
5. **クラウド**：Firebase のアカウント、AIプロキシ、フォーム受信、暗号化バックアップ
6. **AI**：HTMLのテーマ化、自然言語での編集、文章とSEOの下書き、エラー診断
7. **配布**：署名、自動アップデート、3OS向けビルド

MVPの完了条件：自社の運用代行案件で、1サイトを実際にこのアプリだけで運用できること。

### MVPでは作らないもの

ブラウザ版エディタ（案B）、WordPressブロックテーマ（PHP付きの完全なテーマ）の取り込み、テーマストア、サイトの多言語化、コメント、会員機能、EC、複数PC間の同期、スマホアプリ

※HTML/テンプレートの取り込み（WP/Shopify/HTMLの貼り付け→最適化）はオーナー判断で前倒し実装済み。上記は「PHPを伴う完全なWPテーマ」の取り込みを指す。

## 未決事項（実装で必要になったら確認する）

- 料金体系
- フォーム受信の保存期間の初期値と、プライバシーポリシーのひな形
- おまかせ公開先（Firebase Hosting）で多数のサイトを収容する方式
- （決定済み）記事本文＝自作ブロックエディタ（HTML保存・出力）。Tiptap はビジュアルエディタのインライン編集で引き続き使用
