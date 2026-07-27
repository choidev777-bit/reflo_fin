# REFLO

**Research, in one flow.**

REFLO는 국내 상장사 리서치를 프로젝트 설정, 원본 PDF·Excel 분석, 투자 가설 생성, 공식 자료 조사, Evidence 검증, PER 밸류에이션, 보고서 작성까지 한 흐름으로 연결하는 로컬 풀스택 애플리케이션입니다.

이 문서는 Windows에서 저장소를 처음 클론한 사람이 샘플 화면이 아니라 **실제 Google 로그인과 실제 OpenAI·OpenDART·ECOS·KRX API를 사용하는 전체 서비스**를 실행하는 방법을 설명합니다.

## 먼저 답: 클론하면 무엇이 자동으로 설치되나요?

`git clone`은 소스 코드만 내려받습니다. Docker Desktop, Node.js, 데이터베이스, API 키는 자동으로 설치되거나 발급되지 않습니다.

| 항목 | 클론만으로 준비됨 | 준비 방법 |
|---|---:|---|
| 소스 코드·`package-lock.json`·`.env.example` | 예 | Git이 내려받음 |
| Git | 아니요 | 사용자가 먼저 설치 |
| Node.js·npm | 아니요 | 사용자가 먼저 설치 |
| Docker Desktop·Docker Compose | 아니요 | 사용자가 먼저 설치하고 실행 |
| PostgreSQL·MinIO·Temporal·ClamAV | 클론 시점에는 아니요 | `npm run db:up`이 Docker 이미지로 자동 구성 |
| Python PDF/LLM worker·.NET Excel worker | 클론 시점에는 아니요 | `npm run db:up`이 이미지를 빌드하므로 호스트에 Python/.NET 설치 불필요 |
| DB 테이블 | 아니요 | `npm run db:migrate`로 생성 |
| 실제 외부 API 인증정보 | 아니요 | 저장소 소유자가 안전한 별도 경로로 전달하거나 각자 발급 |

즉, 사용자가 직접 설치할 핵심 도구는 **Git, Node.js, Docker Desktop**입니다. Docker Desktop이 실행 중이면 나머지 백엔드 인프라는 저장소의 Compose 설정이 구성합니다.

## 로컬 구성

```mermaid
flowchart LR
    Browser["브라우저<br/>localhost:3000"] --> Next["Next.js Web + API"]
    Next --> PG[("PostgreSQL")]
    Next --> MinIO[("MinIO")]
    Next --> Temporal["Temporal"]
    Temporal --> Control["Control worker"]
    Control --> PDF["PDF worker"]
    Control --> Excel["Excel worker"]
    Control --> LLM["LLM worker"]
    LLM --> OpenAI["OpenAI API"]
    Control --> Sources["OpenDART · KRX · ECOS · 공개 웹"]
```

Next.js가 화면과 `/api` 백엔드를 함께 제공합니다. 별도 웹 백엔드 프로세스를 하나 더 실행하지 않습니다. 장시간 작업은 Temporal control worker가 조정하고, PDF·Excel·LLM 처리는 Docker 컨테이너에서 실행합니다.

## 1. 사전 준비

이 가이드는 Windows 10/11, PowerShell, Docker Desktop의 Linux container 모드를 기준으로 합니다.

### 필수 설치

1. [Git for Windows](https://git-scm.com/install/windows)
2. [Node.js](https://nodejs.org/en/download) `22.13.0` 이상
3. [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)

Docker Desktop은 WSL 2 backend 사용을 권장합니다. 설치 후 Docker Desktop을 직접 실행하고 엔진 시작이 끝날 때까지 기다립니다. Docker Desktop에는 Docker Compose가 포함되어 있으므로 Compose를 따로 설치하지 않습니다.

PowerShell에서 다음 결과가 모두 나와야 합니다.

```powershell
git --version
node --version
npm --version
docker --version
docker compose version
docker info
```

`node --version`은 `v22.13.0` 이상이어야 합니다. `docker info`가 daemon 연결 오류를 내면 Docker Desktop이 아직 실행되지 않은 상태입니다.

### 사용 포트

다음 포트가 다른 프로그램에서 사용 중이면 시작이 실패합니다.

| 포트 | 용도 |
|---:|---|
| `3000` | REFLO 웹·API |
| `5432` | PostgreSQL |
| `9000` / `9001` | MinIO API / 관리 화면 |
| `7233` | Temporal |
| `3310` | ClamAV |
| `8091` | PDF worker |
| `8092` | Excel worker |
| `8093` | LLM worker |

## 2. 저장소 클론

```powershell
git clone https://github.com/choidev777-bit/reflo_fin.git
cd reflo_fin
```

## 3. 환경변수 파일 배치

클론에는 `source-react/.env.example`이 이미 포함됩니다. 이 파일은 변수 이름과 로컬 기본값을 보여주는 공개 템플릿이며, 실제 비밀값을 넣거나 별도로 전달할 파일이 아닙니다.

저장소 소유자에게 아래 두 파일을 보안 채널로 받아 `source-react` 바로 아래에 둡니다.

```text
source-react/
├─ .env.example
├─ .env.local
└─ .env.development.local
```

- `.env.local`: Docker Compose launcher와 DB migration이 직접 읽는 기준 파일
- `.env.development.local`: Next.js 개발 환경 전용 override
- `.env.example`: Git에 포함되는 빈 템플릿

중요:

- `.env.local`에는 `OPENAI_API_KEY`, `REFLO_WORKER_TOKEN`, `REFLO_DATABASE_URL`이 반드시 있어야 합니다.
- `REFLO_DATABASE_URL`을 `.env.development.local`에만 두면 웹 서버는 DB를 찾을 수 있어도 `npm run db:migrate`는 실패합니다. 두 파일을 전달한다면 `.env.local`에도 같은 로컬 DB URL을 넣습니다.
- 같은 변수를 두 파일에 서로 다른 값으로 넣지 않습니다. 개발 서버에서는 `.env.development.local` 값이 먼저 적용됩니다.
- 실제 API를 경험하려면 `REFLO_*_TEST_FIXTURE` 변수는 넣지 않거나 `0`으로 둡니다. `1`이면 실제 provider 대신 테스트 데이터가 사용됩니다.
- `.env.local`과 `.env.development.local`은 `.gitignore`에 포함되어 있습니다. 그래도 `git add -f`로 강제 커밋하지 마세요.

로컬 DB URL의 기본값은 다음과 같습니다.

```dotenv
REFLO_DATABASE_URL=postgresql://reflo:reflo_local@127.0.0.1:5432/reflo
```

### 실제 API 연결에 필요한 값

| 환경변수 | 역할 | 실제 서비스에 필요 |
|---|---|---:|
| `OPENAI_API_KEY` | 가설·조사·검증·보고서 LLM과 뉴스 검색 | 필수 |
| `OPENDART_API_KEY` | 기업 공시와 재무제표 수집 | 필수 |
| `ECOS_API_KEY` | 한국은행 ECOS 환율 수집 | 필수 |
| `KRX_API_KEY` | KOSPI·KOSDAQ·KONEX 일별 종가 수집 | 필수 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 실제 Google OAuth 로그인 | 필수 |
| `KIWOOM_APP_KEY`, `KIWOOM_APP_SECRET` | 키움 REST API 기업 목록 | 선택 |
| `REFLO_WORKER_TOKEN` | 웹과 내부 worker 간 인증 | 필수 |

키움 인증정보가 없으면 기업 검색은 공개 KRX KIND 목록으로 자동 대체됩니다. 이것은 정상 동작입니다. 다만 키움 REST API 자체까지 확인하려면 `KIWOOM_APP_KEY`와 `KIWOOM_APP_SECRET`을 추가해야 합니다.

API 키가 없다면 공식 페이지에서 발급합니다.

- [OpenAI API key](https://platform.openai.com/api-keys)
- [OpenDART 인증키 신청](https://opendart.fss.or.kr/uss/umt/EgovMberInsertView.do)
- [한국은행 ECOS Open API](https://ecos.bok.or.kr/api/)
- [KRX Open API 이용방법](https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO003.jsp)
- [키움 REST API](https://openapi2.kiwoom.com/main/home)
- [Google OAuth 웹 애플리케이션 설정](https://developers.google.com/identity/protocols/oauth2/web-server)

API 키는 발급 계정의 quota와 비용을 사용합니다. 가능하면 공유용 개인 키보다 사람별 또는 프로젝트별 키를 발급하고 사용 한도를 설정합니다.

### Google OAuth 설정 확인

전달받은 Google OAuth client에 다음 redirect URI가 정확히 등록되어 있어야 합니다.

```text
http://localhost:3000/api/auth/google/callback
```

Google OAuth 동의 화면이 `Testing` 상태라면 실행할 사람의 Google 계정도 test user로 등록해야 합니다. 브라우저도 `127.0.0.1` 대신 `http://localhost:3000`으로 접속합니다. `redirect_uri_mismatch`가 나오면 scheme, host, port, path가 위 값과 한 글자도 다르지 않은지 확인합니다.

## 4. 의존성 설치

```powershell
cd source-react
npm ci
```

`npm ci`는 `package-lock.json`에 고정된 버전을 그대로 설치합니다. PostgreSQL, Python, .NET은 호스트에 따로 설치하지 않습니다.

## 5. 백엔드 인프라 시작

Docker Desktop이 실행 중인 상태에서 다음 명령을 실행합니다.

```powershell
npm run db:up
```

명령 이름은 `db:up`이지만 DB만 시작하지 않습니다. 다음 8개 서비스를 내려받거나 빌드하고, 시작한 뒤 health check를 기다립니다.

- PostgreSQL
- MinIO
- Temporal 전용 PostgreSQL
- Temporal
- ClamAV
- PDF worker
- Excel worker
- LLM worker

첫 실행은 Docker 이미지 다운로드와 PDF·Excel·LLM worker 빌드 때문에 이후 실행보다 오래 걸립니다.

상태를 확인합니다.

```powershell
npm run compose:local -- ps
```

8개 서비스가 모두 `Up`이어야 하며, health check가 있는 서비스는 `healthy`여야 합니다.

worker endpoint도 확인할 수 있습니다.

```powershell
$urls = @(
  "http://127.0.0.1:9000/minio/health/live",
  "http://127.0.0.1:8091/health",
  "http://127.0.0.1:8092/health",
  "http://127.0.0.1:8093/health"
)

$urls | ForEach-Object {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $_
  "$_ -> HTTP $($response.StatusCode)"
}
```

모두 `HTTP 200`이면 객체 저장소와 worker가 준비된 상태입니다.

## 6. DB schema 생성

```powershell
npm run db:migrate
```

이 명령은 `infra/migrations`의 migration을 로컬 PostgreSQL에 순서대로 적용합니다. 새로 클론한 DB에는 반드시 한 번 실행해야 합니다. 이미 적용된 migration은 다시 실행되지 않습니다.

`REFLO_DATABASE_URL is required.`가 나오면 `.env.local`에 DB URL이 없는 것입니다. `.env.development.local`만 수정해서는 해결되지 않습니다.

## 7. 전체 애플리케이션 실행

```powershell
npm run dev:full
```

이 명령 하나가 다음 두 프로세스를 함께 실행합니다.

1. Next.js 웹·API 개발 서버
2. Temporal workflow control worker

터미널을 닫지 말고 브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다. 코드 변경은 Next.js 개발 서버에 자동 반영됩니다.

`npm run dev`만 실행하면 화면과 API는 뜨지만 Temporal control worker가 없으므로 파일 분석, 가설 생성, 조사, 보고서 같은 비동기 작업이 진행되지 않습니다. 전체 서비스를 확인할 때는 반드시 `npm run dev:full`을 사용합니다.

## 8. 실제 서비스 확인

단순히 홈 화면이 보이는 것만으로는 외부 API와 worker 연결을 확인할 수 없습니다. 다음 흐름을 끝까지 실행합니다.

1. Google 계정으로 로그인합니다.
2. 새 프로젝트를 만들고 기업과 기준 기간을 설정합니다.
3. `show_example` 폴더의 대덕전자 PDF와 Excel을 업로드합니다.
4. 파일 분석이 완료되고 PDF·Excel 구조가 표시되는지 확인합니다.
5. 투자 가설을 입력하고 질문 자동 생성을 실행합니다. 이 단계에서 OpenAI API를 사용합니다.
6. 조사 계획에 DART·KRX·ECOS·NEWS 출처가 포함되어 있는지 확인하고 조사를 실행합니다.
7. STEP 05에서 실제 출처와 Evidence가 표시되는지 확인합니다.
8. 밸류에이션, 보고서 개요, 보고서 생성과 export까지 진행합니다.

실제 provider를 사용 중인지 판단할 때는 다음을 확인합니다.

- 테스트 fixture 환경변수가 `1`이 아님
- 출처가 `example.com` fixture가 아니라 OpenDART·KRX·ECOS·원문 URL로 표시됨
- LLM worker log에 fixture 응답이 아닌 실제 호출 결과가 기록됨
- KRX 종가에 거래일, 종가, source API ID가 존재함

## 종료·재시작·업데이트

웹과 control worker만 종료하려면 `npm run dev:full`을 실행한 터미널에서 `Ctrl+C`를 누릅니다.

Docker 서비스까지 중지하되 DB와 업로드 파일을 보존하려면:

```powershell
npm run db:down
```

다시 시작하려면:

```powershell
npm run db:up
npm run dev:full
```

새 코드를 받은 뒤에는 다음 순서로 갱신합니다.

```powershell
git pull
cd source-react
npm ci
npm run db:up
npm run db:migrate
npm run dev:full
```

`db:up`은 `--build`를 포함하므로 worker 코드가 바뀌었을 때 Docker 이미지를 다시 빌드합니다.

## 문제 해결

### Docker 명령을 찾지 못함

Docker Desktop을 설치한 뒤 PowerShell을 새로 열고 Docker Desktop을 실행합니다.

```powershell
docker info
```

### `OPENAI_API_KEY is missing from source-react/.env.local`

Compose launcher는 보안을 위해 LLM worker의 키를 `.env.development.local`이나 현재 shell에서 가져오지 않고 `source-react/.env.local`에서만 읽습니다. 키를 `.env.local`에 넣고 다시 실행합니다.

### `REFLO_WORKER_TOKEN is required`

`.env.local`에 충분히 긴 임의의 `REFLO_WORKER_TOKEN`을 넣습니다. 웹 서버와 Excel worker가 같은 값을 사용해야 합니다.

### 포트가 이미 사용 중임

어떤 프로세스가 포트를 사용하는지 확인합니다.

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object LocalPort -In 3000,5432,9000,9001,7233,3310,8091,8092,8093 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

기존 PostgreSQL, MinIO 또는 개발 서버를 종료한 뒤 `npm run db:up`을 다시 실행합니다.

### Google 로그인 후 홈으로 돌아오거나 `redirect_uri_mismatch`

- Google OAuth client에 `http://localhost:3000/api/auth/google/callback`을 등록합니다.
- OAuth 앱이 Testing 상태면 해당 Google 계정을 test user로 추가합니다.
- `http://localhost:3000`으로 접속했는지 확인합니다.
- `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`이 같은 OAuth client에서 발급됐는지 확인합니다.

### KRX 데이터가 `unavailable`

KRX Data Marketplace에서 인증키뿐 아니라 다음 서비스 활용 신청이 승인됐는지 확인합니다.

- 유가증권 일별매매정보
- 코스닥 일별매매정보
- 코넥스 일별매매정보

키 만료, 권한, quota도 함께 확인합니다.

### DART·ECOS·OpenAI 요청 실패

provider의 키 상태, quota, 결제 또는 승인 상태를 먼저 확인합니다. 컨테이너 log는 다음처럼 봅니다.

```powershell
npm run compose:local -- logs -f llm-worker
npm run compose:local -- logs -f pdf-worker
npm run compose:local -- logs -f excel-worker
```

전체 서비스 log:

```powershell
npm run compose:local -- logs -f
```

### 로컬 데이터를 완전히 초기화하고 싶음

다음 명령은 PostgreSQL DB, MinIO 파일, Temporal 이력, ClamAV volume을 모두 삭제합니다. 복구할 수 없는 로컬 초기화가 필요할 때만 실행합니다.

```powershell
npm run compose:local -- down -v
npm run db:up
npm run db:migrate
```

## 개발 검증

```powershell
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

전체 검사는 다음 명령으로 실행합니다.

```powershell
npm run check
```

E2E 검사는 실제 외부 API 비용과 불안정성에 의존하지 않도록 test fixture를 사용합니다. 따라서 `npm run check` 통과와 실제 API 연결 확인은 별도입니다. 실제 연결은 위의 **실제 서비스 확인** 흐름으로 검증합니다.

## 비밀정보 전달 원칙

- 실제 `.env.local`과 `.env.development.local`을 GitHub, 이슈, PR, 메신저 공개 채널에 올리지 않습니다.
- 가능하면 비밀번호 관리자나 만료되는 암호화 링크로 전달합니다.
- 전달 대상별 API 키를 발급하고 quota·비용 한도를 둡니다.
- 협업 종료 후 전달한 키를 폐기하거나 회전합니다.
- `.env.example`에는 실제 키를 절대 넣지 않습니다.

## 로컬 풀스택과 프로덕션 배포의 차이

이 절차는 실제 API와 실제 worker를 사용하는 **완전한 로컬 서비스 환경**을 만듭니다. 하지만 GitHub clone만으로 공개 프로덕션 서비스가 배포되는 것은 아닙니다.

공개 운영에는 별도로 도메인·HTTPS, 관리형 DB와 객체 저장소, secret manager, backup, monitoring, 접근 제어, CI/CD, provider별 운영 약관과 비용 관리가 필요합니다.

## 라이선스

이 프로젝트는 [GNU Affero General Public License v3.0](./LICENSE)을 따릅니다.
