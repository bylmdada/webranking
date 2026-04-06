# Google Search 加速索引工具

自動化工具，用於加速 Google Search 對網站的索引收錄。透過模擬瀏覽行為、Google Indexing API 提交和 IndexNow 通知，幫助新網站更快出現在搜尋結果中。

## 目標網站

| 網站 | 網址 | 說明 |
|------|------|------|
| changfu | https://www.changfu.me | 宜蘭縣長期照護及社會福祉推廣協會 |
| kingkitchen | https://kingkitchen.changfu.me | 皇廚企業社 - 商業廚房設備與排煙工程 |

## 功能模組

### 1. 直接訪問模擬（visit）
使用 Playwright 啟動 headless 瀏覽器，模擬真實使用者訪問網站：
- 隨機選取 User-Agent 和螢幕尺寸
- 自然捲動頁面、滑鼠移動
- 隨機點擊內部連結
- 每頁停留 30-90 秒
- `pages` 清單維持人工挑選，專供模擬瀏覽使用

### 2. Google 搜尋模擬（search）
模擬使用者在 Google 搜尋關鍵字並點擊結果：
- 逐字輸入搜尋關鍵字（模擬打字速度）
- 瀏覽搜尋結果前 3 頁
- 若找到目標網站則點擊進入並停留閱讀
- 每次最多 2-3 次搜尋，間隔 2-5 分鐘

### 3. Google Indexing API（indexing）
透過 Google 官方 API 直接通知 Google 索引頁面：
- 使用 Service Account 認證
- 只提交 `indexingApiPaths` 中明確標記的合格頁面
- 每日上限 200 次提交

> Google Indexing API 並不適合一般公司網站或所有靜態頁面。建議只對 Google 官方支援的頁型啟用，例如職缺或直播相關頁面。

### 4. IndexNow 通知（indexnow）
透過 IndexNow 協議通知 Bing、Yandex 等搜尋引擎：
- 優先從 sitemap 抓取 URL，失敗時才回退到 `pages` 清單
- 涵蓋 Bing、Yandex、Seznam、Naver 等

## 安裝步驟

### 1. 安裝相依套件

```bash
npm install
npx playwright install chromium
```

### 2. 設定環境變數

複製範本檔案：

```bash
cp .env.example .env
```

編輯 `.env` 填入設定值（詳見下方「環境變數設定」章節）。

### 3. 本機測試

```bash
# 執行全部模組
node index.js

# 演練全部模組（不開瀏覽器、不打外部 API）
node index.js --dry-run

# 只執行直接訪問
node index.js --visit-only

# 只執行 Google 搜尋
node index.js --search-only

# 只執行 Indexing API
node index.js --indexing-only

# 只執行 IndexNow
node index.js --indexnow-only
```

## 環境變數設定

| 變數 | 必要 | 說明 |
|------|------|------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | 選填 | Google Service Account JSON key（base64 編碼或原始 JSON） |
| `INDEXNOW_API_KEY` | 選填 | IndexNow API key（任意 UUID 字串） |
| `RUN_MODULES` | 選填 | 指定執行的模組，逗號分隔（預設：`visit,search,indexing,indexnow`） |
| `SIMULATION_PROFILE` | 選填 | 模擬速度設定，`default` 或 `ci`（預設：`default`） |
| `DRY_RUN` | 選填 | `true` 時只列出預計動作，不開瀏覽器、不呼叫外部 API |

> 未設定 `GOOGLE_SERVICE_ACCOUNT_KEY` 時，Indexing API 模組會自動跳過。
> 未設定 `INDEXNOW_API_KEY` 時，IndexNow 模組會自動跳過。

若只是驗證設定與流程是否串好，建議先執行 `npm run dry-run`。

## Google Indexing API 設定教學

### Step 1：建立 Google Cloud 專案

1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 建立新專案（或使用現有專案）

### Step 2：啟用 Indexing API

1. 進入 APIs & Services → Library
2. 搜尋「Web Search Indexing API」
3. 點擊 Enable 啟用

### Step 3：建立 Service Account

1. 進入 IAM & Admin → Service Accounts
2. 點擊「Create Service Account」
3. 填寫名稱，完成建立
4. 點進建立好的 Service Account → Keys → Add Key → Create new key → JSON
5. 下載 JSON key 檔案

### Step 4：將 key 加入環境變數

```bash
# 方法一：base64 編碼（推薦，適合 GitHub Secrets）
cat your-key-file.json | base64 | tr -d '\n'
# 將輸出結果填入 .env 的 GOOGLE_SERVICE_ACCOUNT_KEY

# 方法二：直接貼上 JSON 內容（僅限本機使用）
```

### Step 5：在 Search Console 授權

1. 前往 [Google Search Console](https://search.google.com/search-console)
2. 選擇網站資源 → 設定 → 使用者和權限 → 新增使用者
3. 輸入 Service Account 的 email（格式：`xxx@project.iam.gserviceaccount.com`）
4. 權限選擇「擁有者」
5. 對每個網站資源重複此步驟

## IndexNow 設定教學

1. 產生一組 API key（任意 UUID，例如：`a1b2c3d4e5f6`）
2. 將 key 填入 `.env` 的 `INDEXNOW_API_KEY`
3. 在每個網站的根目錄放置驗證檔案 `{你的key}.txt`，檔案內容為 key 本身
   - 例如：`https://www.changfu.me/a1b2c3d4e5f6.txt` 內容為 `a1b2c3d4e5f6`
   - 例如：`https://kingkitchen.changfu.me/a1b2c3d4e5f6.txt` 內容為 `a1b2c3d4e5f6`

## GitHub Actions 自動排程

本專案包含 GitHub Actions workflow（`.github/workflows/auto-visit.yml`），推上 GitHub 後會自動每 8 小時執行一次。

Workflow 會把 `visit`、`search`、`indexing`、`indexnow` 拆成獨立 job，避免長時間模擬流程拖垮整體排程；瀏覽型 job 會自動使用 `SIMULATION_PROFILE=ci` 縮短停留時間。

另外新增 `.github/workflows/dry-run.yml`，會在 PR、`main` push 或手動觸發時執行測試與全流程 dry-run，專門用來做安全驗證。

### 設定 GitHub Secrets

在 GitHub repo → Settings → Secrets and variables → Actions → New repository secret：

| Secret 名稱 | 值 |
|-------------|-----|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Service Account JSON 檔案的 base64 編碼內容 |
| `INDEXNOW_API_KEY` | 你的 IndexNow API key |

### 手動觸發

在 GitHub repo → Actions → Google Ranking Automation → Run workflow

## 專案結構

```
google-ranking/
├── .github/workflows/
│   └── auto-visit.yml      # GitHub Actions 排程設定
├── src/
│   ├── config.js            # 網站設定（頁面、關鍵字）
│   ├── runtime-config.js    # 執行速度設定（default / ci）
│   ├── url-resolver.js      # sitemap / 明確路徑解析
│   ├── utils.js             # 工具函式（UA 輪換、延遲、行為模擬）
│   ├── visit.js             # 直接訪問模擬
│   ├── search.js            # Google 搜尋模擬
│   ├── indexing-api.js      # Google Indexing API
│   └── indexnow.js          # IndexNow 通知
├── test/
│   └── url-resolver.test.js # URL 解析測試
├── index.js                 # 主程式入口
├── package.json
├── .env.example             # 環境變數範本
└── .gitignore
```

## 自然化策略

為避免被偵測為自動化流量，本工具採用以下策略：

- **UA 輪換**：只使用 Chromium 相容的真實 User-Agent，避免 UA 與實際瀏覽器引擎打架
- **螢幕尺寸變化**：每次加上隨機偏移量
- **延遲隨機化**：所有等待時間使用隨機區間，非固定值
- **自然捲動**：變速捲動，偶爾回滾
- **滑鼠移動**：曲線軌跡移動，非直線
- **IP 多樣性**：GitHub Actions 每次執行分配不同 IP

## 新增 / 修改目標網站

編輯 `src/config.js`，在 `sites` 陣列中新增或修改網站設定：

```js
{
  name: '網站名稱',
  baseUrl: 'https://your-site.com',
  sitemapUrl: 'https://your-site.com/sitemap.xml',
  indexingApiPaths: [],                  // 只有合格頁面才填，例如職缺頁
  pages: ['/', '/about', '/contact'],    // 要模擬訪問的頁面路徑
  keywords: ['關鍵字1', '關鍵字2'],        // Google 搜尋用的關鍵字
}
```

## 驗證索引成效

1. **Google Search Console**：數天後檢查索引狀態，確認頁面是否已被收錄
2. **搜尋驗證**：在 Google 搜尋 `site:www.changfu.me` 和 `site:kingkitchen.changfu.me`
3. **GitHub Actions Logs**：檢查每次執行的日誌輸出

## 注意事項

- Google Indexing API 只適合 Google 官方支援的特定頁型；一般公司站請以 sitemap、內部連結與外部連結為主
- Google 搜尋模擬可能遭遇 CAPTCHA 攔截，這是正常現象
- 如果 Cloudflare 阻擋了 headless 瀏覽器，需在 Cloudflare 設定白名單
- 建議同時透過社群媒體、目錄網站等建立真實外部連結，效果更佳
- 本工具僅供加速自有網站的搜尋引擎索引使用
