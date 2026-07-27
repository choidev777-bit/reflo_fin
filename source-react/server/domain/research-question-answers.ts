import {
  canonicalResearchNumericValue,
  type ResearchPlanQuestion,
  type ValidatedEvidence,
} from "./research-validation";

export type ResearchVerdict =
  | "positive"
  | "neutral"
  | "negative"
  | "indeterminate";

export type ResearchQuestionAnswer = {
  questionId: string;
  verdict: ResearchVerdict;
  oneLineAnswer: string;
  evidenceCandidateKeys: string[];
  caveat: string | null;
  policyVersion: "stance-balance-v1";
};

export type QuestionAnswerDecision = {
  question: ResearchPlanQuestion;
  verdict: ResearchVerdict;
  evidence: ValidatedEvidence[];
  readyForSynthesis: boolean;
  caveat: string | null;
  policyVersion: "stance-balance-v1";
};

export type StoredQuestionResult = {
  metricId: string;
  oneLineValue: string;
  stance: "supporting" | "contradicting" | "neutral";
  evidenceIds: string[];
};

export function decideStoredQuestionAnswer(input: {
  requiredMetricIds: string[];
  results: StoredQuestionResult[];
}): {
  verdict: ResearchVerdict;
  oneLineAnswer: string;
  evidenceIds: string[];
  caveat: string | null;
} {
  const covered = new Set(input.results.map((result) => result.metricId));
  const missing = input.requiredMetricIds.filter(
    (metricId) => !covered.has(metricId),
  );
  const evidenceIds = [
    ...new Set(input.results.flatMap((result) => result.evidenceIds)),
  ];
  if (input.results.length === 0) {
    return {
      verdict: "indeterminate",
      oneLineAnswer: "보고서에 반영할 검증 주장이 없습니다.",
      evidenceIds,
      caveat: "검증을 통과한 근거가 없습니다.",
    };
  }
  const supporting = input.results.filter(
    (result) => result.stance === "supporting",
  ).length;
  const contradicting = input.results.filter(
    (result) => result.stance === "contradicting",
  ).length;
  return {
    verdict:
      supporting > 0 && contradicting === 0
        ? "positive"
        : contradicting > 0 && supporting === 0
          ? "negative"
          : "neutral",
    oneLineAnswer: input.results
      .map((result) => result.oneLineValue)
      .join("; ")
      .slice(0, 500),
    evidenceIds,
    caveat:
      missing.length > 0 ? `보고서 제외 지표: ${missing.join(", ")}` : null,
  };
}

export function decideQuestionAnswers(input: {
  questions: ResearchPlanQuestion[];
  evidence: ValidatedEvidence[];
}): QuestionAnswerDecision[] {
  return input.questions
    .filter((question) => question.included)
    .map((question) => {
      const evidence = input.evidence.filter(
        (item) =>
          item.questionId === question.questionId &&
          item.machineStatus === "passed",
      );
      const covered = new Set(evidence.map((item) => item.metricId));
      const missing = question.metrics.filter((metric) => !covered.has(metric));
      const valuesByMetricPeriod = new Map<string, Set<string>>();
      for (const item of evidence) {
        const value = canonicalResearchNumericValue(item.valueNormalized);
        if (!value) continue;
        const metricPeriod = [
          item.metricId.trim(),
          item.period.trim(),
          item.scope.trim(),
        ].join("\u0000");
        const values = valuesByMetricPeriod.get(metricPeriod) ?? new Set();
        values.add(
          [value, item.unit?.trim() ?? "", item.currency?.trim() ?? ""].join(
            "\u0000",
          ),
        );
        valuesByMetricPeriod.set(metricPeriod, values);
      }
      const conflict = Array.from(valuesByMetricPeriod.values()).some(
        (values) => values.size > 1,
      );
      if (conflict || evidence.length === 0) {
        return {
          question,
          verdict: "indeterminate" as const,
          evidence,
          readyForSynthesis: false,
          caveat:
            conflict
              ? "같은 지표와 기간의 검증값이 충돌합니다."
              : "검증을 통과한 근거가 없습니다.",
          policyVersion: "stance-balance-v1" as const,
        };
      }
      const supporting = evidence.filter(
        (item) => item.stance === "supporting",
      ).length;
      const contradicting = evidence.filter(
        (item) => item.stance === "contradicting",
      ).length;
      const verdict =
        supporting > 0 && contradicting === 0
          ? ("positive" as const)
          : contradicting > 0 && supporting === 0
            ? ("negative" as const)
            : ("neutral" as const);
      return {
        question,
        verdict,
        evidence,
        readyForSynthesis: true,
        caveat:
          missing.length > 0
            ? `보고서 제외 지표: ${missing.join(", ")}`
            : null,
        policyVersion: "stance-balance-v1" as const,
      };
    });
}

function numericTokens(value: string): string[] {
  return (value.match(/[-+]?\d[\d,.]*%?/g) ?? []).map((token) =>
    token.replaceAll(",", "").replace(/%$/, "").replace(/^\+/, ""),
  );
}

export function validateQuestionAnswer(
  answer: ResearchQuestionAnswer,
  decision: QuestionAnswerDecision,
): ResearchQuestionAnswer {
  const normalizedAnswer = answer.oneLineAnswer.trim();
  // verdict는 서버의 decideQuestionAnswers가 근거로부터 결정하는 정책 권위다.
  // 워커/활동이 계산한 verdict가 어긋나도 파이프라인을 실패시키지 않고 서버 값으로
  // 확정한다(아래 return에서 decision.verdict 사용). 한 줄 답변·근거·숫자는 계속 검증한다.
  if (
    answer.questionId !== decision.question.questionId ||
    answer.policyVersion !== decision.policyVersion
  ) {
    throw new Error("QUESTION_ANSWER_POLICY_MISMATCH");
  }
  if (
    normalizedAnswer.length === 0 ||
    normalizedAnswer.length > 500 ||
    /[\r\n]/.test(normalizedAnswer)
  ) {
    throw new Error("QUESTION_ANSWER_FORMAT_INVALID");
  }
  const allowedKeys = new Set(
    decision.evidence.map((item) => item.candidateKey),
  );
  if (
    answer.evidenceCandidateKeys.length === 0 ||
    answer.evidenceCandidateKeys.some((key) => !allowedKeys.has(key))
  ) {
    throw new Error("QUESTION_ANSWER_EVIDENCE_INVALID");
  }
  const referenced = decision.evidence.filter((item) =>
    answer.evidenceCandidateKeys.includes(item.candidateKey),
  );
  const allowedNumbers = new Set(
    referenced.flatMap((item) =>
      numericTokens(
        [
          item.quoteExact,
          item.oneLineValue,
          item.valueOriginal ?? "",
          item.valueNormalized ?? "",
        ].join(" "),
      ),
    ),
  );
  if (
    numericTokens(answer.oneLineAnswer).some(
      (token) => !allowedNumbers.has(token),
    )
  ) {
    throw new Error("QUESTION_ANSWER_NUMBER_UNSUPPORTED");
  }
  return {
    ...answer,
    verdict: decision.verdict,
    oneLineAnswer: normalizedAnswer,
    evidenceCandidateKeys: [...new Set(answer.evidenceCandidateKeys)],
    caveat: decision.caveat,
  };
}

export function indeterminateQuestionAnswer(
  decision: QuestionAnswerDecision,
): ResearchQuestionAnswer {
  return {
    questionId: decision.question.questionId,
    verdict: "indeterminate",
    oneLineAnswer: "필수 근거가 부족하거나 충돌해 현재 판단할 수 없습니다.",
    evidenceCandidateKeys: decision.evidence.map((item) => item.candidateKey),
    caveat: decision.caveat,
    policyVersion: decision.policyVersion,
  };
}

export function validateQuestionAnswerSet(input: {
  questions: ResearchPlanQuestion[];
  evidence: ValidatedEvidence[];
  answers: ResearchQuestionAnswer[];
}): ResearchQuestionAnswer[] {
  const candidateKeys = new Set<string>();
  for (const item of input.evidence) {
    if (candidateKeys.has(item.candidateKey)) {
      throw new Error("EVIDENCE_CANDIDATE_KEY_CONFLICT");
    }
    candidateKeys.add(item.candidateKey);
  }
  const decisions = decideQuestionAnswers({
    questions: input.questions,
    evidence: input.evidence,
  });
  const answerByQuestion = new Map<string, ResearchQuestionAnswer>();
  for (const answer of input.answers) {
    if (answerByQuestion.has(answer.questionId)) {
      throw new Error("QUESTION_ANSWER_DUPLICATE");
    }
    answerByQuestion.set(answer.questionId, answer);
  }
  return decisions.map((decision) => {
    // 서버의 decideQuestionAnswers가 근거로부터 verdict·판단가능여부를 정하는 정책
    // 권위다. 워커는 스키마상 indeterminate 답변을 표현할 수 없으므로, indeterminate로
    // 판정된 질문은 워커 답변과 무관하게 정규 indeterminate 답변으로 확정한다.
    // 판단 가능한 질문만 워커의 한 줄 답변(prose)을 검증해 사용한다.
    if (!decision.readyForSynthesis) {
      return indeterminateQuestionAnswer(decision);
    }
    const answer = answerByQuestion.get(decision.question.questionId);
    if (!answer) {
      throw new Error("QUESTION_ANSWER_SET_MISMATCH");
    }
    return validateQuestionAnswer(answer, decision);
  });
}
