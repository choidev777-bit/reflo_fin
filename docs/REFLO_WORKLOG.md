# REFLO 작업 문맥 및 기록

이 문서는 REFLO의 현재 구현 상태와 주요 결정을 다음 작업자에게 전달하기 위한 작업 로그다.  
새 작업이 끝날 때마다 아래 `작업 기록 템플릿`을 복사해 최신 기록을 위에 추가한다.

## 1. 프로젝트 목표

REFLO는 금융 리서치 업무를 다음 흐름으로 연결하는 서비스다.

1. 프로젝트와 분석 기준 설정
2. PDF·Excel 업로드 및 검사
3. 투자 의견과 조사 질문 설정
4. 자료 조사 계획 및 수집
5. 수집 결과와 원문 검증
6. Excel 기반 밸류에이션
7. 보고서 구성 및 생성

제품 동작과 기술 판단의 기준 문서는 다음 두 파일이다.

- [REFLO_URL_SERVICE_BEHAVIOR_v1.md](./REFLO_URL_SERVICE_BEHAVIOR_v1.md)
- [REFLO_TECHNICAL_DECISIONS_v1.md](./REFLO_TECHNICAL_DECISIONS_v1.md)

화면별 실제 구현 계약은 다음 문서에 URL 순서대로 누적한다.

- [REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md](./REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)

화면·스타일·문구를 변경할 때는 프로젝트 루트의 [DESIGN.md](../DESIGN.md)를 먼저 확인한다.

## 2. 협업 방향

- 디자이너가 만든 React UI와 CSS는 가능한 한 그대로 재사용한다.
- 현재 화면의 하드코딩 데이터는 실제 백엔드 데이터로 교체할 예정이다.
- 화면을 처음부터 다시 디자인하지 않는다.
- 각 URL별 컴포넌트, 버튼, 데이터 연결, 상태, API, 필요한 기술을 명세한 뒤 구현한다.
- 서비스 단계 수는 문서 기준의 7단계로 통일한다.
- Excel형 UI는 밸류에이션 화면에 SpreadJS React를 연결할 예정이다.
- SpreadJS는 표시·입력 UI만 담당하고, 권위 계산과 최종 XLSX 저장은 Aspose.Cells for .NET이 담당한다.

## 3. 현재 구현 상태

### 프론트엔드

- 위치: `D:\Reflo_fin\source-react`
- 실행 기반: 표준 Next.js App Router
- 주요 버전:
  - Next.js 16.2.6
  - React 19.2.6
  - TypeScript 5.9.3
  - Tailwind CSS 4.2.1
- 현재 UI는 대부분 하드코딩된 프로토타입이다.
- 백엔드 API와 실제 데이터 저장은 아직 구현되지 않았다.
- URL은 분리됐지만 여러 route 파일이 공통 대형 UI 컴포넌트를 다시 내보내는 구조다.
- 핵심 UI 파일인 `app/page.tsx`, `app/process.tsx`, `app/globals.css`가 매우 크므로 이후 단계별 분리가 필요하다.

### 현재 URL

| 화면 | URL |
|---|---|
| 홈 | `/` |
| 프로젝트 목록 | `/projects` |
| 1. 프로젝트 설정 | `/projects/:projectId/process/setup` |
| 2. 파일 업로드·검사 | `/projects/:projectId/process/files` |
| 3. 투자 의견·조사 질문 | `/projects/:projectId/process/hypothesis` |
| 4. 자료 조사 계획 | `/projects/:projectId/process/research-plan` |
| 5. 수집 결과 검증 | `/projects/:projectId/process/validation` |
| 6. PER 밸류에이션 | `/projects/:projectId/process/valuation` |
| 7. 페이지 내용 설정 | `/projects/:projectId/process/report-outline` |
| 보고서 | `/projects/:projectId/report` |

### 목표 백엔드 경계

기술 결정 문서 기준의 목표 구조는 다음과 같다.

- PostgreSQL: 프로젝트, 파일 메타데이터, Evidence, provenance
- S3 API 호환 객체 저장소: 원본 PDF·XLSX와 대형 파생 파일
- Temporal: 장시간·다단계 작업 오케스트레이션
- Python 격리 워커: PDF 분석·수정·렌더링·검증
- .NET 격리 워커: Aspose.Cells 기반 Excel 재계산·검증·저장
- SpreadJS React: 브라우저의 Excel 표시·입력 UI

백엔드 기술은 UI 디자인 코드와 분리한다.

## 4. 2026-07-24 작업 기록

### 2026-07-24 — `/` 홈 화면 구현 명세

#### 목표

- 두 기준 문서와 현재 React 디자인을 대조해 홈의 컴포넌트·버튼·데이터·API·상태·기술 위치를 확정한다.

#### 결과

- `REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md`를 만들고 `/` 홈 명세를 첫 항목으로 작성했다.
- 기존 헤더·히어로·모달 디자인은 재사용하고 인증 상태와 실제 프로젝트 생성만 연결하도록 정리했다.
- Google 로그인, 실제 `projectId`, 7단계 표시, 사용자 메뉴·로그아웃, 오류·보안·테스트 조건을 명시했다.
- 홈에서 사용하지 않는 SpreadJS, Temporal, PDF·Excel 워커, Agent는 로드하지 않도록 명시했다.
- 인증 라이브러리·세션 정책·CSRF 방식은 기술 결정 문서에 추가해야 할 미확정 항목으로 분리했다.

#### 다음 작업

- 같은 문서에 `/projects` 명세를 이어서 작성한다.

### 2026-07-24 — 개발 기준선 완료

#### 목표

- 이후 기능 구현에서 기존 UI가 깨지는지 빠르게 확인할 수 있는 로컬 품질 기준선을 만든다.

#### 변경

- React 렌더 중 ref 접근, effect 내 동기 상태 갱신, 전역 변수 변경으로 발생하던 ESLint 오류 7개를 제거했다.
- Playwright와 Chromium 기반 로컬 E2E 검사를 추가했다.
- 홈, 프로젝트 목록, 7개 process URL, 보고서까지 총 10개 URL 직접 진입을 검사한다.
- 홈의 새 프로젝트 생성과 프로젝트 목록의 이어하기를 실제 클릭해 URL 이동을 검사한다.
- 프로젝트 목록, PER 밸류에이션, 보고서 3개 대표 화면의 스크린샷 기준선을 저장했다.
- 브라우저 검사 중 발견한 보고서 표의 중복 React key 콘솔 오류를 수정했다.
- `npm run check`로 린트, 타입, 기존 테스트, 빌드, E2E를 한 번에 실행할 수 있게 했다.

#### 검증

- `npm run lint`: 오류 0개, 기존 경고 20개
- `npm run typecheck`: 통과
- `npm test`: 4개 통과
- `npm run build`: 통과
- `npm run test:e2e:update`: 15개 통과
- E2E는 로컬에서 4개 worker로 병렬 실행하며 약 18초가 걸렸다.

#### 남은 작업

- 경고 20개는 사용되지 않는 레거시 프로토타입 코드, `<img>` 최적화, 접근성 속성 문제다.
- 실제 API, 인증, DB, 파일 처리, SpreadJS 연결은 아직 구현되지 않았다.
- 다음 작업은 문서 기준의 URL별 화면·버튼·데이터·API 명세 확정이다.

#### Git

- React 린트 오류 제거: `43da66e`
- 브라우저에서 발견한 중복 key 수정: `63f7261`
- Playwright 기준선 추가: `4892525`

### 2026-07-24 — UI 기술 스택 정리

#### 목표

디자이너 UI는 보존하면서 생성 템플릿에 붙어 있던 불필요한 기술 스택을 제거하고, 표준 Next.js에서 실행되게 만든다.

#### 결정

- Vinext는 실험적 호환 계층이므로 제거했다.
- Cloudflare Workers, Wrangler, D1, OpenAI Sites 설정은 UI에 필요하지 않아 제거했다.
- Drizzle은 스키마와 실제 DB 사용이 없어 제거했다.
- D1은 SQLite 기반이며 REFLO 문서의 PostgreSQL 결정과 맞지 않는다.
- Cloudflare R2는 향후 S3 호환 객체 저장소 후보가 될 수 있지만 현재 UI 프로젝트에는 포함하지 않는다.

#### 제거한 항목

- Vinext와 Vite 관련 패키지·설정
- Cloudflare Vite 플러그인, Workers 타입, Wrangler, Worker 진입점
- OpenAI Sites 호스팅 설정과 빌드 플러그인
- Drizzle ORM, Drizzle Kit, D1 예제와 빈 DB 스키마
- 중복 pnpm 설정
- Vinext로 생성된 `static-html` 정적 배포본
- Sites 전용 설치·빌드·검증 스크립트
- 사용되지 않던 ChatGPT 호스팅 인증 helper

#### 보존한 항목

- `source-react/app/`의 React UI
- 전체 CSS와 시각 디자인
- UI 컴포넌트
- `source-react/public/`의 이미지와 다운로드 샘플
- 서비스 문서와 디자인 시스템
- 분리된 URL 구조

#### Git 기록

| 목적 | 커밋·태그 |
|---|---|
| 정리 전 원본 체크포인트 | `00b3aab` |
| 정리 전 태그 | `before-stack-cleanup` |
| 표준 Next.js 정리 완료 | `7c78d7c` |

정리 작업 전체를 되돌리려면 다음 명령을 사용한다.

```powershell
cd D:\Reflo_fin
git revert 7c78d7c
```

#### 검증 결과

- `npm run typecheck`: 통과
- `npm test`: 4개 테스트 통과
- `npm run build`: 통과
- Next.js가 홈, 프로젝트, 7개 process URL, 보고서 URL을 모두 인식함
- 브라우저에서 전체 URL의 대표 문구와 화면 렌더링 확인
- 브라우저 콘솔 오류 없음
- Vinext·Cloudflare·Wrangler·Drizzle 런타임 참조 없음

#### 당시 알려진 문제

- 기존 하드코딩 UI에는 ESLint 오류 7개와 경고가 남아 있었다. 오류 7개는 위 개발 기준선 작업에서 해결했다.
- 타입검사와 프로덕션 빌드는 통과하므로 현재 실행에는 영향을 주지 않는다.
- 아직 실제 API, 인증, DB, 파일 업로드, 작업 진행 상태, SpreadJS가 연결되지 않았다.
- 대형 단일 컴포넌트를 단계별 컴포넌트로 나누기 전에는 기능 추가 시 충돌 위험이 높다.

## 5. 로컬 실행

```powershell
cd D:\Reflo_fin\source-react
npm ci
npm run dev
```

브라우저에서 `http://localhost:3000`을 연다.

프로덕션 빌드 확인:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run start
```

## 6. 다음 우선 작업

1. 문서 기준으로 URL별 화면 명세서를 작성한다.
2. 각 화면의 컴포넌트, 버튼, 입력값, 출력값, 상태와 이동 조건을 확정한다.
3. 현재 하드코딩 데이터와 실제 API 데이터의 교체 지점을 표시한다.
4. `app/page.tsx`와 `app/process.tsx`를 디자인 변화 없이 단계별 컴포넌트로 분리한다.
5. 프로젝트·파일·작업·Evidence·보고서 데이터 모델과 API 계약을 설계한다.
6. 밸류에이션 화면의 가짜 Excel 영역을 SpreadJS로 교체한다.
7. Python PDF 워커, .NET Excel 워커, Temporal 연결을 별도 백엔드 작업으로 진행한다.

## 7. 작업 기록 규칙

- 최신 작업을 `4. 작업 기록` 바로 아래에 추가한다.
- 채팅 전문을 복사하지 않고 결정과 결과만 적는다.
- 변경 파일, 검증 명령, 미해결 문제, Git 커밋을 반드시 남긴다.
- UI 변경은 적용한 디자인 기준을 함께 기록한다.
- 기술 결정을 변경하면 관련 기준 문서의 결정 ID도 함께 적는다.

## 8. 작업 기록 템플릿

```markdown
### YYYY-MM-DD — 작업 제목

#### 목표

- 이번 작업에서 해결하려는 문제

#### 결정

- 선택한 방향과 이유

#### 변경

- 변경한 파일과 사용자에게 보이는 결과

#### 검증

- 실행한 명령
- 확인한 URL 또는 시나리오
- 결과

#### 남은 작업

- 아직 해결하지 않은 문제

#### Git

- 커밋: `해시`
```
