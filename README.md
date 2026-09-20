# 網站 SEO 檢查與索引通知工具

管理希望增加自然曝光與點擊的網址，從 sitemap 與手動清單檢查頁面 SEO，輸出可追蹤的問題報告。預設只執行 `audit`，不產生模擬搜尋點擊。

目前追蹤：長福協會 `https://www.changfu.me`、皇廚 `https://kingkitchen.changfu.me`、好揪民宿 `https://howchillyilan.com/`、好好民宿 `https://haohaoday.com/`。

## 安裝與執行

```bash
npm ci
npx playwright install chromium
cp .env.example .env   # 已有 .env 時請勿覆蓋
npm test
npm run audit
```

報告位於 `reports/seo-audit.md` 與 `reports/seo-audit.json`，每次執行覆寫。檢查包含 HTTP 狀態、標題、摘要、重複標題／摘要、canonical、meta／HTTP noindex、H1、社群分享預覽與 JSON-LD 語法。

只解析伺服器回傳的 HTML，不執行目標網站 JavaScript，不載入追蹤碼或圖片；因此不代表完整的 Google rendering 結果。robots.txt 回應保存在 JSON，規則需另行確認；JSON-LD 語法正確也不代表符合 rich result 資格。

## 自行新增網址

```bash
npm run sites -- add https://your-site.com/ https://your-site.com/service
npm run sites -- list
npm run audit
```

新增網址保存在 `targets.json`，也能直接編輯這個 JSON 陣列；刪除其中的項目即可移除額外追蹤網址。內建兩站及其頁面仍在 `src/config.js` 管理。網址必須為完整 HTTP(S) 網址，不含帳密；片段會移除，相同網址自動去重。

同來源網址合併為一個網站，新網站預設讀取 `/sitemap.xml`。如 sitemap 位於其他位置，可在 `src/config.js` 宣告 `sitemapUrl`。手動新增頁面會與 sitemap 合併，不會因 sitemap 存在而被忽略。新增整站會自動涵蓋 sitemap 子頁；只移除一個手動子頁不會將它從 sitemap 中排除。

每站一次最多檢查 100 個網址，超出會在報告標示。sitemap 支援標準未加命名空間前綴的 `<loc>`、XML entity、CDATA 與同來源 sitemap index，最多讀取 50 份、每份 5 MB；失敗會明確警告並回退至手動清單。為保留轉址診斷與避免跨來源抓取，不自動跟隨轉址；請設定最終 canonical 網址。

## 模組與環境變數

| 變數 | 用途 |
| --- | --- |
| `RUN_MODULES` | 逗號分隔，預設 `audit`；可選 `audit,visit,search,indexing,indexnow` |
| `DRY_RUN` | `true` 時不開瀏覽器、不發外部請求、不產生報告 |
| `INDEXNOW_API_KEY` | IndexNow 驗證 key，8–128 個英數或連字號 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Service Account 原始 JSON 或 base64 |
| `SIMULATION_PROFILE` | 舊模擬模組使用 `default` 或 `ci` |

CLI 的 `--audit-only`、`--indexnow-only` 等單模組選項優先於 `RUN_MODULES`。未知模組／參數會報錯。

```bash
npm run dry-run
RUN_MODULES=audit,visit,search,indexing,indexnow npm run dry-run
npm run indexnow -- --dry-run
```

原有 `visit` 與 `search` 保留手動相容入口，預設與自動排程不執行。Google 將自動查詢列入 [machine-generated traffic 政策](https://developers.google.com/search/docs/essentials/spam-policies#machine-generated-traffic)，不應把模擬點擊當成自然流量成效。

## 索引通知

一般網站使用 sitemap 與 Search Console。Google [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart) 只支援 `JobPosting` 或 `VideoObject` 內的 `BroadcastEvent`；因此所有站的 `indexingApiPaths` 預設留空。只有確認符合資格的個別頁面才手動加入，新增網址不會自動啟用此 API。

IndexNow：在每站根目錄放置 `{INDEXNOW_API_KEY}.txt`，內容為相同 key，再執行 `npm run indexnow`。程式先讀取並比對驗證檔，再依每批 10,000 個 URL 提交通知；HTTP 202 表示 key 驗證待完成，HTTP 200 也僅代表已接收，均不保證收錄。參考 [IndexNow 官方文件](https://www.indexnow.org/documentation)。建議在頁面新增、修改或刪除後觸發通知。

dry-run 只列出明確設定的頁面，不查 sitemap、key 檔或 API 權限。正式提交仍需各網站的有效驗證設定。

## GitHub Actions

- `auto-visit.yml`：每 8 小時執行 SEO audit，報告上傳為 `seo-audit` artifact，保留 30 天。讀取錯誤／HTTP 4xx、5xx 會使 job 失敗；SEO 建議寫入報告。
- 手動觸發預設只執行 audit；勾選 `submit_indexing` 才額外執行 IndexNow 與 Indexing API，使用 `INDEXNOW_API_KEY`、`GOOGLE_SERVICE_ACCOUNT_KEY` Secrets；缺少 key 會跳過。
- `dry-run.yml`：PR、main push 及手動觸發時跑測試與全模組 dry-run。
- workflow 變更需推上遠端後才會生效。

## 如何衡量曝光與點擊率

在 Search Console 加入並驗證每個網站、提交其 sitemap。優先修正報告中的讀取失敗、noindex 與 canonical 問題，再針對高曝光低 CTR 的頁面改寫獨特標題／摘要，讓內容符合使用者搜尋意圖。SEO 設定須修改各網站原始碼，此專案負責追蹤與通知。

以相同期間（例如前後各 28 天）的曝光、點擊、CTR、平均排名觀察成效；CTR = 點擊 ÷ 曝光。這個工具尚未串接 Search Console 成效資料，不會宣稱加入網址或通知成功就代表排名／點擊提升。
