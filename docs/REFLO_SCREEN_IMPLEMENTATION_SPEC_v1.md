# REFLO URL별 화면 구현 명세 v1

**문서 상태:** 작성 중  
**작성 시작일:** 2026-07-24  
**대상:** 현업 배포용 MVP  
**구현 범위:** 기존 디자이너 UI를 보존하면서 실제 인증·데이터·API·상태를 연결하기 위한 화면별 기준

## 0. 문서 역할

이 문서는 전체 화면 명세의 인덱스와 공통 작성 원칙을 관리한다. 상세 명세는 `docs/screens/` 아래에서 URL별 파일로 관리한다.

판단 우선순위는 다음과 같다.

1. [`REFLO_URL_SERVICE_BEHAVIOR_v1.md`](./REFLO_URL_SERVICE_BEHAVIOR_v1.md)의 제품 동작과 MVP 불변조건
2. [`REFLO_TECHNICAL_DECISIONS_v1.md`](./REFLO_TECHNICAL_DECISIONS_v1.md)의 확정·조건부 확정 기술 결정
3. 현재 `source-react`의 화면 디자인과 상호작용
4. 각 URL 상세 명세에서 확정한 구현 계약

현재 React 코드는 시각 디자인의 기준이지 제품 동작의 기준이 아니다. 하드코딩 데이터, 가짜 상태, 임시 URL, 동작하지 않는 버튼은 실제 구현으로 교체한다. 화면 구조·크기·색상·간격은 별도 사유가 없는 한 유지한다.

API 경로는 프론트엔드와 백엔드가 공유할 애플리케이션 계약이다. 인증 라이브러리나 백엔드 프레임워크를 나중에 변경하더라도 명세에 정의한 사용자 동작은 유지한다.

## 1. URL별 문서와 작성 상태

| 순서 | URL | 화면 | 상세 문서 | 상태 |
|---|---|---|---|---|
| 01 | `/` | 홈 | [`screens/01-home.md`](./screens/01-home.md) | 1차 작성 완료 |
| 02 | `/projects` | 프로젝트 목록 | [`screens/02-projects.md`](./screens/02-projects.md) | 1차 작성 완료 |
| 03 | `/projects/:projectId/process/setup` | 프로젝트 설정 | `screens/03-setup.md` | 작성 예정 |
| 04 | `/projects/:projectId/process/files` | 파일 업로드·검사 | `screens/04-files.md` | 작성 예정 |
| 05 | `/projects/:projectId/process/hypothesis` | 투자 의견·조사 질문 | `screens/05-hypothesis.md` | 작성 예정 |
| 06 | `/projects/:projectId/process/research-plan` | 자료 조사 계획 | `screens/06-research-plan.md` | 작성 예정 |
| 07 | `/projects/:projectId/process/validation` | 수집 결과 검증 | `screens/07-validation.md` | 작성 예정 |
| 08 | `/projects/:projectId/process/valuation` | PER 밸류에이션 | `screens/08-valuation.md` | 작성 예정 |
| 09 | `/projects/:projectId/process/report-outline` | 페이지 내용 설정 | `screens/09-report-outline.md` | 작성 예정 |
| 10 | `/projects/:projectId/report` | 보고서 편집·검증·내보내기 | `screens/10-report.md` | 작성 예정 |

아직 생성하지 않은 파일은 링크로 만들지 않는다. 각 URL 명세를 작성할 때 이 표의 경로와 상태를 함께 갱신한다.

## 2. URL 상세 명세의 공통 구성

각 화면 문서는 다음 항목을 같은 순서로 기록한다.

1. 화면 목적과 접근 권한
2. 사용자 상태별 화면
3. 기본 사용자 흐름과 URL 이동
4. 기존 디자인 재사용·변경·제거 판정
5. 목표 컴포넌트 구성
6. 버튼·입력·표·모달 등 UI 요소 계약
7. 화면 데이터와 클라이언트 상태
8. API 요청·응답·오류 계약
9. 저장 모델과 권한 규칙
10. 화면에 들어가는 기술과 들어가면 안 되는 기술
11. 로딩·빈 상태·오류·예외 처리
12. 현재 프로토타입과 목표 구현의 차이
13. 구현 순서, 완료 조건, 자동 테스트
14. 아직 필요한 제품·기술 결정

## 3. HTML·React 코드 기록 원칙

기존 React 코드를 문서에 통째로 복사하지 않는다. 코드와 문서가 따로 변경되어 불일치하는 문제를 막기 위해 UI 요소는 계약 표로 기록한다.

버튼과 입력 요소에는 필요한 경우 다음 정보를 적는다.

- 컴포넌트명
- 의미에 맞는 HTML 요소
- 표시 문구와 접근성 이름
- `type`, `name`, `autocomplete` 같은 핵심 속성
- 노출·활성·비활성 조건
- 클릭·입력·제출 이벤트
- 연결하는 상태와 API
- 검증 규칙과 오류 표시 위치

포커스 처리, 접근성 구조, 브라우저 기본 동작처럼 표만으로 오해하기 쉬운 부분에만 짧은 JSX 예시를 사용한다.

## 4. 화면 간 공통 불변조건

- 로그인은 Google 계정만 사용한다.
- 모든 프로젝트·파일·산출물은 검증된 로그인 세션의 사용자 소유권으로 서버에서 격리한다.
- 클라이언트가 전달한 사용자 ID나 프로젝트 소유권을 신뢰하지 않는다.
- 서버가 발급한 실제 `projectId`만 URL에 사용한다.
- 상위 단계 데이터 변경으로 하위 결과가 무효화되면 `재검증 필요` 상태를 표시한다.
- 화면에 보이는 버튼은 실제 동작을 갖거나 제거한다.
- 하드코딩 데이터는 API 응답 또는 명시적인 정적 카피로 구분한다.
- SpreadJS, PDF·Excel 워커, Temporal, Agent 코드는 실제 사용하는 URL에만 배치한다.
- 디자이너의 레이아웃과 시각 표현은 기능·접근성·요구사항 충돌이 없는 한 유지한다.
