# REFLO 로컬 실행 패키지

REFLO 웹 화면의 정적 실행본과 React 원본 프로젝트가 함께 들어 있습니다.

## 가장 간단한 실행 방법

저장소를 클론한 뒤 `static-html` 폴더로 이동합니다.

### macOS

`start-local.command`를 더블클릭하면 로컬 서버와 브라우저가 자동으로 열립니다.

처음 실행할 때 macOS가 차단하면 파일을 우클릭하고 **열기**를 선택하세요. 터미널에서 실행하려면 다음 명령을 사용합니다.

```bash
cd static-html
./start-local.command
```

### Windows

`start-local.bat`를 더블클릭하면 로컬 서버와 브라우저가 자동으로 열립니다.

기존 로컬 서버가 기본 포트를 사용 중이면 다음 빈 포트를 자동으로 선택합니다. 실제 접속 주소는 명령 프롬프트 창에 표시됩니다.

### 공통 준비 사항

macOS에서는 Python 3 또는 Ruby가 필요합니다. Windows 실행 파일은 운영체제에 포함된 PowerShell을 사용합니다. 실행 후 브라우저가 자동으로 열리지 않으면 명령 프롬프트에 표시된 주소로 접속합니다. 기본 주소는 다음과 같습니다.

```text
http://127.0.0.1:8081/
```

서버가 실행된 터미널 또는 명령 프롬프트 창을 닫으면 로컬 서버도 종료됩니다.

## 폴더 구성

- `static-html/`: 별도 빌드 없이 실행 가능한 정적 웹 파일
- `source-react/`: 화면과 기능을 수정할 수 있는 React 원본 프로젝트

## React 원본 실행

Node.js 22 이상이 필요합니다.

```bash
cd source-react
npm install
npm run dev
```
