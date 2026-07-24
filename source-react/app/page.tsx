import { Suspense } from "react";
import { HomeScreen } from "./_phase1/HomeScreen";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="phase1-page-loading" aria-label="홈 불러오는 중" />}>
      <HomeScreen />
    </Suspense>
  );
}
