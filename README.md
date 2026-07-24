# REFLO

Node.js 22 이상이 필요합니다.

```powershell
cd D:\Reflo_fin\source-react
npm install
npm run dev
```

접속 주소: `http://localhost:3000`

- `source-react/`: 표준 Next.js 기반 REFLO UI
- `docs/`: 서비스 동작 및 기술 결정 문서
- `DESIGN.md`: 디자인 시스템 기준

주요 문서:

- [시스템 아키텍처](./docs/REFLO_SYSTEM_ARCHITECTURE_v1.md)
- [ERD](./docs/REFLO_ERD_v1.md)
- [API 명세](./docs/REFLO_API_SPEC_v1.md)
- [OpenAPI 단일 원본](./contracts/openapi/reflo-v1.yaml)
- [Worker JSON Schema](./contracts/schemas/README.md)
- [서비스 동작 명세](./docs/REFLO_URL_SERVICE_BEHAVIOR_v1.md)
- [기술 결정 사항](./docs/REFLO_TECHNICAL_DECISIONS_v1.md)
- [Hypothesis Agent canonical prompt](./docs/agents/HYPOTHESIS_AGENT_PROMPT_v2.md)
- [화면 구현 명세](./docs/REFLO_SCREEN_IMPLEMENTATION_SPEC_v1.md)
- [UI 구현 결정](./docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md)

현재 문맥과 작업 이력은 [REFLO_WORKLOG.md](./docs/REFLO_WORKLOG.md)에서 관리합니다.

## 라이선스

REFLO는 [GNU Affero General Public License v3.0](./LICENSE)에 따라 공개한다.

- 배포된 네트워크 서비스 사용자는 실행 중인 버전에 대응하는 전체 소스코드를 받을 수 있어야 한다.
- 배포 화면은 공개 저장소와 정확한 배포 commit을 확인할 수 있는 `소스 코드` 링크를 제공한다.
- PyMuPDF/MuPDF는 AGPL-3.0 조건으로 사용하며 저작권·라이선스 고지를 유지한다.
- API key, 비밀번호, 사용자 파일, 데이터베이스 내용과 운영 secret은 소스코드 공개 대상에 포함하지 않는다.

핵심 의존성 고지와 release 검사 기준은 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 따른다.
