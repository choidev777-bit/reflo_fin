# REFLO Third-Party Notices

REFLO 자체 소스는 GNU Affero General Public License v3.0으로 배포한다. 이 문서는 핵심 기술 결정에 포함된 third-party software의 라이선스 기준을 기록한다.

| 구성요소 | 용도 | 라이선스 |
|---|---|---|
| PyMuPDF / MuPDF | PDF 분석·패치 자산 생성 | GNU AGPL v3.0 |
| pikepdf | PDF 객체·리소스 보존과 수정 | MPL-2.0 |
| qpdf | PDF 구조 처리·검사 | Apache-2.0 |
| PDFium / pypdfium2 | 독립 PDF 렌더링 검증 | Apache-2.0 / BSD-3-Clause 및 포함된 third-party 고지 |
| OpenCV | 시각 회귀검사 | Apache-2.0 |
| PDF.js | 브라우저 PDF viewer | Apache-2.0 |
| ClosedXML | XLSX 분석·재계산·저장 | MIT |
| React | 브라우저 UI | MIT |
| Next.js | 웹 애플리케이션 framework | MIT |

## 배포 규칙

1. release build는 실제 lockfile과 container image에 포함된 모든 직접·전이 의존성의 이름, version, license와 copyright notice를 생성한다.
2. 생성 결과와 이 문서가 다르면 release를 차단하고 이 문서를 갱신한다.
3. 각 라이선스 원문과 필수 notice를 배포 artifact 또는 공개 소스 저장소에서 접근 가능하게 한다.
4. PyMuPDF/MuPDF를 사용하는 네트워크 서비스는 화면에서 REFLO 공개 저장소와 정확한 배포 commit의 대응 소스를 제공한다.
5. MPL 적용 파일을 수정했다면 해당 수정 파일의 Source Code Form 제공 의무를 확인한다.
6. API key, 비밀번호, session secret, 사용자 파일과 데이터베이스 내용은 공개 소스나 notice에 포함하지 않는다.

이 목록은 법률 자문을 대신하지 않는다. 정확한 배포 고지는 실제 package lock과 container image를 기준으로 생성한다.
