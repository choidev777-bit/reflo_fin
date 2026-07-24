# REFLO UI

디자이너가 만든 REFLO 화면을 표준 Next.js App Router에서 실행하는 UI 프로젝트입니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```powershell
cd D:\Reflo_fin\source-react
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 검사

```powershell
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

전체 기준선을 한 번에 검사하려면 `npm run check`를 실행합니다.

의도한 UI 변경을 눈으로 확인한 뒤 스크린샷 기준선을 갱신할 때만
`npm run test:e2e:update`을 사용합니다.

Cloudflare Workers, Vinext, Wrangler, D1, Drizzle 또는 OpenAI Sites 런타임에 의존하지 않습니다.
